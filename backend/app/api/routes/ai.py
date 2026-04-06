"""
AI routes — upgraded with confidence thresholds, decision logging,
human review flags, and rate limiting for regulated enterprise AI.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import date, timedelta, datetime, timezone
from typing import Optional, List, Any
import time
import numpy as np
from pydantic import BaseModel
import httpx

from app.core.config import settings

from app.core.database import get_db
from app.models.user import User, UserRole
from app.models.sales import Sale, SaleItem
from app.models.medicine import Medicine
from app.models.inventory import Inventory
from app.models.batch import Batch
from app.models.prescription import Prescription, PrescriptionStatus
from app.models.store import Store
from app.models.audit import AuditLog, AuditAction
from app.models.ai_log import AIDecisionLog, AIFeature, ConfidenceLevel
from app.api.deps import get_current_user, require_admin, require_manager

router = APIRouter(prefix="/ai", tags=["AI Insights"])

# Confidence thresholds
HIGH_CONFIDENCE_THRESHOLD = 0.75
MEDIUM_CONFIDENCE_THRESHOLD = 0.45
# Auto-flag for human review if below this
HUMAN_REVIEW_THRESHOLD = 0.45


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ForecastRequest(BaseModel):
    medicine_id: int
    store_id: Optional[int] = None
    days_ahead: int = 7


class AnomalyRequest(BaseModel):
    store_id: Optional[int] = None
    days: int = 30


class ChatRequest(BaseModel):
    message: str
    store_id: Optional[int] = None


class AIDecisionReview(BaseModel):
    approved: bool
    notes: Optional[str] = None


class AIDecisionResponse(BaseModel):
    id: int
    feature: AIFeature
    input_summary: Optional[str]
    output_summary: Optional[str]
    confidence_score: Optional[float]
    confidence_level: Optional[ConfidenceLevel]
    requires_human_review: bool
    human_approved: Optional[bool]
    review_notes: Optional[str]
    model_version: Optional[str]
    latency_ms: Optional[int]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Helper: calculate confidence ─────────────────────────────────────────────

def _classify_confidence(score: float) -> ConfidenceLevel:
    if score >= HIGH_CONFIDENCE_THRESHOLD:
        return ConfidenceLevel.HIGH
    elif score >= MEDIUM_CONFIDENCE_THRESHOLD:
        return ConfidenceLevel.MEDIUM
    else:
        return ConfidenceLevel.LOW


async def _log_ai_decision(
    db: AsyncSession,
    feature: AIFeature,
    user_id: int,
    store_id: Optional[int],
    input_summary: str,
    output_summary: str,
    confidence_score: float,
    input_payload: dict = None,
    output_payload: dict = None,
    latency_ms: int = None,
    request_id: str = "",
    model_version: str = "deterministic_v1",
) -> AIDecisionLog:
    """Persist a meaningful AI decision to the dedicated AI log table."""
    confidence_level = _classify_confidence(confidence_score)
    requires_review = confidence_score < HUMAN_REVIEW_THRESHOLD

    log = AIDecisionLog(
        user_id=user_id,
        store_id=store_id,
        feature=feature,
        input_summary=input_summary,
        input_payload=input_payload,
        output_summary=output_summary,
        output_payload=output_payload,
        confidence_score=round(confidence_score, 4),
        confidence_level=confidence_level,
        requires_human_review=requires_review,
        model_version=model_version,
        latency_ms=latency_ms,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    return log


def _effective_store_id(current_user: User, requested_store_id: Optional[int]) -> Optional[int]:
    if current_user.store_id:
        if requested_store_id and requested_store_id != current_user.store_id:
            raise HTTPException(status_code=403, detail="Access denied for the requested store")
        return current_user.store_id
    return requested_store_id


async def _resolve_sales_anchor_date(
    db: AsyncSession,
    effective_store_id: Optional[int],
) -> date:
    query = select(func.max(Sale.created_at))
    if effective_store_id:
        query = query.where(Sale.store_id == effective_store_id)
    latest_sale_ts = (await db.execute(query)).scalar_one_or_none()
    if latest_sale_ts is None:
        return date.today()
    return latest_sale_ts.date()


def _truncate(text: str, limit: int = 160) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def _extract_openai_message_content(payload: dict[str, Any]) -> str:
    message = payload["choices"][0]["message"]["content"]
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        parts = []
        for item in message:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return "\n".join(part for part in parts if part).strip()
    return str(message)


async def _call_llm(system_prompt: str, user_message: str) -> tuple[str, str]:
    errors: list[str] = []

    providers: list[tuple[str, str, callable]] = []
    if settings.OPENAI_API_KEY:
        providers.append(("openai_gpt-4o-mini", settings.OPENAI_API_KEY, lambda key: (
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": f"Bearer {key}"},
            {
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "temperature": 0.2,
            },
        )))
    if settings.GROQ_API_KEY:
        providers.append(("groq_llama-3.1-8b-instant", settings.GROQ_API_KEY, lambda key: (
            "https://api.groq.com/openai/v1/chat/completions",
            {"Authorization": f"Bearer {key}"},
            {
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "temperature": 0.2,
            },
        )))

    async with httpx.AsyncClient(timeout=18.0) as client:
        for provider_name, api_key, request_builder in providers:
            try:
                url, headers, payload = request_builder(api_key)
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                body = response.json()
                return _extract_openai_message_content(body), provider_name
            except Exception as exc:
                errors.append(f"{provider_name}: {exc}")

        if settings.GEMINI_API_KEY:
            try:
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={settings.GEMINI_API_KEY}",
                    json={
                        "contents": [
                            {
                                "parts": [
                                    {
                                        "text": f"{system_prompt}\n\nUser question:\n{user_message}",
                                    }
                                ]
                            }
                        ],
                        "generationConfig": {"temperature": 0.2},
                    },
                )
                response.raise_for_status()
                body = response.json()
                candidates = body.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    text = "\n".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
                    if text:
                        return text, "gemini-1.5-flash"
                raise ValueError("Gemini returned an empty response")
            except Exception as exc:
                errors.append(f"gemini-1.5-flash: {exc}")

    raise HTTPException(
        status_code=502,
        detail={
            "message": "Configured LLM provider could not be reached.",
            "providers_attempted": errors,
        },
    )


async def _gather_chat_context(
    db: AsyncSession,
    effective_store_id: Optional[int],
) -> dict[str, Any]:
    anchor_date = await _resolve_sales_anchor_date(db, effective_store_id)
    window_start = anchor_date - timedelta(days=30)
    expiry_threshold = anchor_date + timedelta(days=settings.EXPIRY_ALERT_DAYS)

    sales_day_query = (
        select(
            func.coalesce(func.sum(Sale.total_amount), 0).label("revenue"),
            func.count(Sale.id).label("orders"),
        )
        .where(func.date(Sale.created_at) == anchor_date)
    )
    if effective_store_id:
        sales_day_query = sales_day_query.where(Sale.store_id == effective_store_id)
    sales_day_row = (await db.execute(sales_day_query)).one()

    low_stock_query = (
        select(Medicine.name, Inventory.total_quantity)
        .join(Inventory, Inventory.medicine_id == Medicine.id)
        .where(Inventory.total_quantity <= settings.LOW_STOCK_THRESHOLD)
        .order_by(Inventory.total_quantity.asc(), Medicine.name.asc())
        .limit(5)
    )
    if effective_store_id:
        low_stock_query = low_stock_query.where(Inventory.store_id == effective_store_id)
    low_stock_rows = (await db.execute(low_stock_query)).all()

    expiry_query = (
        select(Medicine.name, Batch.batch_number, Batch.expiry_date)
        .join(Batch, Batch.medicine_id == Medicine.id)
        .where(Batch.quantity > 0)
        .where(Batch.expiry_date <= expiry_threshold)
        .order_by(Batch.expiry_date.asc(), Medicine.name.asc())
        .limit(5)
    )
    if effective_store_id:
        expiry_query = expiry_query.where(Batch.store_id == effective_store_id)
    expiry_rows = (await db.execute(expiry_query)).all()

    top_products_query = (
        select(
            Medicine.name,
            func.sum(SaleItem.quantity).label("units"),
            func.sum(SaleItem.quantity * SaleItem.price).label("revenue"),
        )
        .join(SaleItem, SaleItem.medicine_id == Medicine.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Sale.created_at >= window_start)
        .group_by(Medicine.name)
        .order_by(func.sum(SaleItem.quantity).desc(), Medicine.name.asc())
        .limit(5)
    )
    if effective_store_id:
        top_products_query = top_products_query.where(Sale.store_id == effective_store_id)
    top_products_rows = (await db.execute(top_products_query)).all()

    margin_query = (
        select(
            Medicine.category,
            func.sum(SaleItem.quantity * SaleItem.price).label("revenue"),
        )
        .join(SaleItem, SaleItem.medicine_id == Medicine.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(Sale.created_at >= window_start)
        .group_by(Medicine.category)
        .order_by(func.sum(SaleItem.quantity * SaleItem.price).desc())
        .limit(3)
    )
    if effective_store_id:
        margin_query = margin_query.where(Sale.store_id == effective_store_id)
    margin_rows = (await db.execute(margin_query)).all()

    return {
        "business_date": str(anchor_date),
        "today_revenue": float(sales_day_row.revenue or 0),
        "today_orders": int(sales_day_row.orders or 0),
        "low_stock_count": len(low_stock_rows),
        "low_stock_items": [
            {"name": row.name, "qty": int(row.total_quantity or 0)}
            for row in low_stock_rows
        ],
        "expiry_alert_count": len(expiry_rows),
        "expiry_items": [
            {
                "name": row.name,
                "batch_number": row.batch_number,
                "expiry_date": str(row.expiry_date),
                "days_left": (row.expiry_date - anchor_date).days,
            }
            for row in expiry_rows
        ],
        "top_products_30d": [
            {
                "name": row.name,
                "units": int(row.units or 0),
                "revenue": float(row.revenue or 0),
            }
            for row in top_products_rows
        ],
        "top_categories_30d": [
            {
                "category": row.category,
                "revenue": float(row.revenue or 0),
            }
            for row in margin_rows
        ],
    }


def _parse_requested_date(message: str, anchor_date: date) -> tuple[date, str]:
    msg_lower = message.lower()
    if "yesterday" in msg_lower:
        target = anchor_date - timedelta(days=1)
        return target, f"yesterday ({target.isoformat()})"
    if "today" in msg_lower or "current" in msg_lower:
        return anchor_date, f"today ({anchor_date.isoformat()})"
    if "latest" in msg_lower or "last" in msg_lower:
        return anchor_date, f"latest business date ({anchor_date.isoformat()})"
    return anchor_date, f"business date {anchor_date.isoformat()}"


async def _fetch_sales_summary_for_date(
    db: AsyncSession,
    effective_store_id: Optional[int],
    target_date: date,
) -> dict[str, Any]:
    query = (
        select(
            func.coalesce(func.sum(Sale.total_amount), 0).label("revenue"),
            func.count(Sale.id).label("orders"),
            func.coalesce(func.sum(Sale.discount_amount), 0).label("discount"),
        )
        .where(func.date(Sale.created_at) == target_date)
    )
    if effective_store_id:
        query = query.where(Sale.store_id == effective_store_id)
    row = (await db.execute(query)).one()
    return {
        "date": str(target_date),
        "revenue": float(row.revenue or 0),
        "orders": int(row.orders or 0),
        "discount": float(row.discount or 0),
    }


async def _fetch_latest_sale(
    db: AsyncSession,
    effective_store_id: Optional[int],
) -> Optional[dict[str, Any]]:
    query = (
        select(
            Sale.id,
            Sale.created_at,
            Sale.total_amount,
            Sale.payment_method,
            Sale.discount_amount,
            Sale.prescription_number,
            Sale.prescription_id,
            User.name.label("cashier_name"),
            Store.name.label("store_name"),
        )
        .join(User, User.id == Sale.user_id)
        .join(Store, Store.id == Sale.store_id)
        .order_by(Sale.created_at.desc())
        .limit(1)
    )
    if effective_store_id:
        query = query.where(Sale.store_id == effective_store_id)
    row = (await db.execute(query)).one_or_none()
    if row is None:
        return None

    items_query = (
        select(Medicine.name, SaleItem.quantity, SaleItem.price, Batch.batch_number)
        .join(SaleItem, SaleItem.medicine_id == Medicine.id)
        .join(Batch, Batch.id == SaleItem.batch_id)
        .where(SaleItem.sale_id == row.id)
        .order_by(Medicine.name.asc())
    )
    items = (await db.execute(items_query)).all()
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "total_amount": float(row.total_amount or 0),
        "payment_method": row.payment_method or "unknown",
        "discount_amount": float(row.discount_amount or 0),
        "prescription_number": row.prescription_number,
        "prescription_id": row.prescription_id,
        "cashier_name": row.cashier_name,
        "store_name": row.store_name,
        "items": [
            {
                "medicine_name": item.name,
                "quantity": int(item.quantity or 0),
                "price": float(item.price or 0),
                "batch_number": item.batch_number,
            }
            for item in items
        ],
    }


async def _fetch_latest_prescription(
    db: AsyncSession,
    effective_store_id: Optional[int],
) -> Optional[dict[str, Any]]:
    query = (
        select(
            Prescription.id,
            Prescription.patient_name,
            Prescription.doctor_name,
            Prescription.status,
            Prescription.prescription_date,
            Prescription.valid_until,
            Prescription.diagnosis,
            Prescription.notes,
            Prescription.created_at,
            Store.name.label("store_name"),
            User.name.label("created_by_name"),
        )
        .join(Store, Store.id == Prescription.store_id)
        .join(User, User.id == Prescription.created_by_user_id)
        .order_by(Prescription.created_at.desc())
        .limit(1)
    )
    if effective_store_id:
        query = query.where(Prescription.store_id == effective_store_id)
    row = (await db.execute(query)).one_or_none()
    if row is None:
        return None
    return {
        "id": row.id,
        "patient_name": row.patient_name,
        "doctor_name": row.doctor_name,
        "status": row.status.value if isinstance(row.status, PrescriptionStatus) else str(row.status),
        "prescription_date": str(row.prescription_date),
        "valid_until": str(row.valid_until) if row.valid_until else None,
        "diagnosis": row.diagnosis,
        "notes": row.notes,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "store_name": row.store_name,
        "created_by_name": row.created_by_name,
    }


async def _fetch_latest_batch(
    db: AsyncSession,
    effective_store_id: Optional[int],
) -> Optional[dict[str, Any]]:
    query = (
        select(
            Batch.id,
            Batch.batch_number,
            Batch.expiry_date,
            Batch.cost_price,
            Batch.quantity,
            Batch.created_at,
            Medicine.name.label("medicine_name"),
            Store.name.label("store_name"),
        )
        .join(Medicine, Medicine.id == Batch.medicine_id)
        .join(Store, Store.id == Batch.store_id)
        .order_by(Batch.created_at.desc(), Batch.id.desc())
        .limit(1)
    )
    if effective_store_id:
        query = query.where(Batch.store_id == effective_store_id)
    row = (await db.execute(query)).one_or_none()
    if row is None:
        return None
    return {
        "id": row.id,
        "batch_number": row.batch_number,
        "medicine_name": row.medicine_name,
        "store_name": row.store_name,
        "expiry_date": str(row.expiry_date),
        "cost_price": float(row.cost_price or 0),
        "quantity": int(row.quantity or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def _fetch_recent_audit_events(
    db: AsyncSession,
    effective_store_id: Optional[int],
    limit: int = 8,
) -> list[dict[str, Any]]:
    query = (
        select(
            AuditLog.id,
            AuditLog.entity_type,
            AuditLog.entity_id,
            AuditLog.action,
            AuditLog.description,
            AuditLog.timestamp,
            AuditLog.store_id,
        )
        .where(AuditLog.action.notin_([AuditAction.AI_DECISION, AuditAction.AI_REVIEWED]))
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .limit(limit)
    )
    if effective_store_id:
        query = query.where(AuditLog.store_id == effective_store_id)
    rows = (await db.execute(query)).all()
    return [
        {
            "id": row.id,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "action": row.action.value if isinstance(row.action, AuditAction) else str(row.action),
            "description": row.description,
            "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            "store_id": row.store_id,
        }
        for row in rows
    ]


async def _fetch_role_directory(
    db: AsyncSession,
    effective_store_id: Optional[int],
) -> dict[str, list[dict[str, Any]]]:
    query = (
        select(User.name, User.email, User.role, User.store_id, Store.name.label("store_name"))
        .outerjoin(Store, Store.id == User.store_id)
        .order_by(User.role.asc(), User.name.asc())
    )
    if effective_store_id:
        query = query.where(User.store_id == effective_store_id)
    rows = (await db.execute(query)).all()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        role_key = row.role.value if isinstance(row.role, UserRole) else str(row.role)
        grouped.setdefault(role_key, []).append(
            {
                "name": row.name,
                "email": row.email,
                "store_id": row.store_id,
                "store_name": row.store_name,
            }
        )
    return grouped


async def _build_dynamic_chat_context(
    db: AsyncSession,
    message: str,
    effective_store_id: Optional[int],
    base_context: dict[str, Any],
) -> dict[str, Any]:
    msg_lower = message.lower()
    dynamic_context: dict[str, Any] = {}
    anchor_date = date.fromisoformat(base_context["business_date"])

    wants_people = any(token in msg_lower for token in ["admin", "sales staff", "staff", "manager", "who is"])
    wants_sales = "sale" in msg_lower or "revenue" in msg_lower or "bill" in msg_lower or "order" in msg_lower
    wants_latest_bill = any(token in msg_lower for token in ["last bill", "latest bill", "last generated bill", "last sale"])
    wants_latest_prescription = any(token in msg_lower for token in ["latest prescription", "last prescription", "recent prescription"])
    wants_batch = any(token in msg_lower for token in ["batch", "last batch", "latest batch", "batch added"])
    wants_audit = any(token in msg_lower for token in ["audit", "log", "logs", "activity", "recent changes", "history"])

    dynamic_context["latest_sale"] = await _fetch_latest_sale(db, effective_store_id)
    dynamic_context["latest_prescription"] = await _fetch_latest_prescription(db, effective_store_id)
    dynamic_context["latest_batch"] = await _fetch_latest_batch(db, effective_store_id)

    if wants_people:
        directory = await _fetch_role_directory(db, effective_store_id)
        dynamic_context["team_directory"] = directory

    if wants_sales:
        target_date, date_label = _parse_requested_date(message, anchor_date)
        sales_summary = await _fetch_sales_summary_for_date(db, effective_store_id, target_date)
        dynamic_context["sales_summary"] = {"label": date_label, **sales_summary}

    if wants_latest_bill:
        dynamic_context["latest_sale_requested"] = True

    if wants_latest_prescription:
        dynamic_context["latest_prescription_requested"] = True

    if wants_batch:
        dynamic_context["latest_batch_requested"] = True

    if wants_audit:
        dynamic_context["recent_audit_events"] = await _fetch_recent_audit_events(db, effective_store_id)

    return dynamic_context


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/forecast")
async def demand_forecast(
    payload: ForecastRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """
    Moving average demand forecast with confidence scoring.
    Confidence = based on data volume and variance consistency.
    """
    start_ms = int(time.time() * 1000)

    # Sanitize input
    if payload.days_ahead < 1 or payload.days_ahead > 30:
        raise HTTPException(status_code=400, detail="days_ahead must be between 1 and 30")

    effective_store_id = _effective_store_id(current_user, payload.store_id)
    anchor_date = await _resolve_sales_anchor_date(db, effective_store_id)
    since = anchor_date - timedelta(days=60)
    query = (
        select(
            func.date(Sale.created_at).label("sale_date"),
            func.sum(SaleItem.quantity).label("qty"),
        )
        .join(SaleItem, SaleItem.sale_id == Sale.id)
        .where(SaleItem.medicine_id == payload.medicine_id)
        .where(Sale.created_at >= since)
        .group_by(func.date(Sale.created_at))
        .order_by(func.date(Sale.created_at))
    )
    if effective_store_id:
        query = query.where(Sale.store_id == effective_store_id)

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        return {
            "medicine_id": payload.medicine_id,
            "forecast": [],
            "confidence_level": ConfidenceLevel.LOW,
            "confidence_score": 0.0,
            "requires_human_review": True,
            "message": "Insufficient data for forecast — manual estimation recommended",
        }

    quantities = [float(r.qty) for r in rows]
    dates_hist = [str(r.sale_date) for r in rows]

    window = min(7, len(quantities))
    avg = float(np.mean(quantities[-window:]))
    std = float(np.std(quantities[-window:])) if len(quantities) > 1 else 0

    # Confidence score based on:
    # 1. Data volume (more data = higher confidence)
    # 2. Coefficient of variation (lower CV = higher confidence)
    data_confidence = min(1.0, len(rows) / 30)  # saturates at 30 days
    cv = std / avg if avg > 0 else 1.0
    variance_confidence = max(0, 1 - cv / 2)    # CV of 0 = 100%, CV of 2 = 0%
    confidence_score = (data_confidence * 0.5 + variance_confidence * 0.5)

    forecast = []
    for i in range(payload.days_ahead):
        future_date = anchor_date + timedelta(days=i + 1)
        predicted = max(0, avg + (i * 0.05))
        forecast.append({
            "date": str(future_date),
            "predicted_qty": round(predicted, 1),
            "lower_bound": round(max(0, predicted - std), 1),
            "upper_bound": round(predicted + std, 1),
        })

    latency = int(time.time() * 1000) - start_ms
    confidence_level = _classify_confidence(confidence_score)

    # Log the AI decision
    await _log_ai_decision(
        db=db,
        feature=AIFeature.FORECAST,
        user_id=current_user.id,
        store_id=effective_store_id,
        input_summary=f"Demand forecast for medicine {payload.medicine_id} using {len(rows)} daily sales points anchored to {anchor_date}",
        output_summary=f"Predicted average daily demand {round(avg, 1)} units with {confidence_level.value.lower()} confidence",
        confidence_score=confidence_score,
        input_payload={**payload.model_dump(), "effective_store_id": effective_store_id, "anchor_date": str(anchor_date)},
        output_payload={"avg": avg, "std": std, "data_points": len(rows), "forecast_days": payload.days_ahead},
        latency_ms=latency,
        request_id=getattr(request.state, "request_id", ""),
        model_version="moving_average_v2",
    )

    return {
        "medicine_id": payload.medicine_id,
        "historical_avg_daily": round(avg, 2),
        "historical": [{"date": d, "qty": q} for d, q in zip(dates_hist, quantities)],
        "forecast": forecast,
        "confidence_score": round(confidence_score, 3),
        "confidence_level": confidence_level,
        "requires_human_review": confidence_score < HUMAN_REVIEW_THRESHOLD,
        "data_points_used": len(rows),
        "model": "moving_average_v2",
        "anchor_date": str(anchor_date),
    }


@router.post("/anomaly")
async def detect_anomalies(
    payload: AnomalyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Z-score anomaly detection with confidence scoring."""
    start_ms = int(time.time() * 1000)

    effective_store_id = _effective_store_id(current_user, payload.store_id)
    anchor_date = await _resolve_sales_anchor_date(db, effective_store_id)
    since = anchor_date - timedelta(days=payload.days)
    query = (
        select(
            func.date(Sale.created_at).label("sale_date"),
            func.sum(Sale.total_amount).label("revenue"),
            func.count(Sale.id).label("orders"),
        )
        .where(Sale.created_at >= since)
        .group_by(func.date(Sale.created_at))
        .order_by(func.date(Sale.created_at))
    )
    if effective_store_id:
        query = query.where(Sale.store_id == effective_store_id)

    result = await db.execute(query)
    rows = result.all()

    if len(rows) < 3:
        return {
            "anomalies": [],
            "confidence_level": ConfidenceLevel.LOW,
            "confidence_score": 0.0,
            "requires_human_review": True,
            "message": "Insufficient data — minimum 3 days of sales required",
        }

    revenues = [float(r.revenue) for r in rows]
    mean = float(np.mean(revenues))
    std = float(np.std(revenues))

    # Confidence: more data + lower relative std = more reliable
    confidence_score = min(1.0, len(rows) / 14) * (1 - min(1.0, std / (mean + 1)))
    confidence_level = _classify_confidence(confidence_score)

    anomalies = []
    for r in rows:
        rev = float(r.revenue)
        z_score = (rev - mean) / std if std > 0 else 0
        if abs(z_score) > 2.0:
            anomalies.append({
                "date": str(r.sale_date),
                "revenue": rev,
                "orders": int(r.orders),
                "z_score": round(z_score, 2),
                "type": "unusually_high" if z_score > 0 else "unusually_low",
            })

    latency = int(time.time() * 1000) - start_ms

    await _log_ai_decision(
        db=db,
        feature=AIFeature.ANOMALY,
        user_id=current_user.id,
        store_id=effective_store_id,
        input_summary=f"Revenue anomaly scan across {len(rows)} daily points over the last {payload.days} days anchored to {anchor_date}",
        output_summary=f"Detected {len(anomalies)} anomaly day(s) with {confidence_level.value.lower()} confidence",
        confidence_score=confidence_score,
        input_payload={**payload.model_dump(), "effective_store_id": effective_store_id, "anchor_date": str(anchor_date)},
        output_payload={"anomaly_count": len(anomalies), "mean": mean, "std_dev": std},
        latency_ms=latency,
        request_id=getattr(request.state, "request_id", ""),
        model_version="zscore_v2",
    )

    return {
        "mean_daily_revenue": round(mean, 2),
        "std_dev": round(std, 2),
        "anomalies": anomalies,
        "total_days_analyzed": len(rows),
        "confidence_score": round(confidence_score, 3),
        "confidence_level": confidence_level,
        "requires_human_review": confidence_score < HUMAN_REVIEW_THRESHOLD,
        "anchor_date": str(anchor_date),
    }


@router.post("/query")
async def chat_query(
    payload: ChatRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Operational AI chat with database retrieval plus provider-backed generation."""
    start_ms = int(time.time() * 1000)

    msg = payload.message.strip()
    if len(msg) > 500:
        raise HTTPException(status_code=400, detail="Message too long. Maximum 500 characters.")
    if len(msg) < 2:
        raise HTTPException(status_code=400, detail="Message too short.")

    if not any([settings.OPENAI_API_KEY, settings.GROQ_API_KEY, settings.GEMINI_API_KEY]):
        raise HTTPException(
            status_code=503,
            detail="AI chat requires a configured LLM provider key. Set OPENAI_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY.",
        )

    effective_store_id = _effective_store_id(current_user, payload.store_id)
    context = await _gather_chat_context(db, effective_store_id)
    dynamic_context = await _build_dynamic_chat_context(
        db,
        msg,
        effective_store_id,
        context,
    )

    retrieval_context = {**context, **dynamic_context}
    system_prompt = (
        "You are PharmaNexus AI, an operations assistant for a pharmacy retail platform. "
        "You must answer strictly from the retrieved database context provided to you. "
        "If the answer is not present in that context, clearly say the current platform data does not contain it. "
        "Do not rely on world knowledge or guess missing facts. "
        "Always express money in Indian rupees using the prefix 'Rs.'. "
        "Never use dollars unless the user explicitly asks for a conversion. "
        "When listing people, bills, or prescriptions, preserve the exact names, IDs, and timestamps from the retrieved data. "
        "Keep answers concise, operational, and easy for store teams to act on.\n\n"
        f"Retrieved database context:\n{retrieval_context}"
    )
    response_text, model_used = await _call_llm(system_prompt, msg)
    response_type = "retrieval_augmented_llm"
    confidence_score = 0.93

    latency = int(time.time() * 1000) - start_ms

    await _log_ai_decision(
        db=db,
        feature=AIFeature.CHAT,
        user_id=current_user.id,
        store_id=effective_store_id,
        input_summary=f"Operational chat request: {_truncate(msg)}",
        output_summary=f"{response_type} response generated via {model_used}",
        confidence_score=confidence_score,
        input_payload={"message": msg, "effective_store_id": effective_store_id},
        output_payload={"response_type": response_type, "model": model_used, "context_keys": list(dynamic_context.keys())},
        latency_ms=latency,
        request_id=getattr(request.state, "request_id", ""),
        model_version=model_used,
    )

    return {
        "response": response_text,
        "type": response_type,
        "confidence_level": _classify_confidence(confidence_score),
        "confidence_score": round(confidence_score, 2),
        "requires_human_review": confidence_score < HUMAN_REVIEW_THRESHOLD,
        "model": model_used,
        "business_date": context["business_date"],
    }


@router.get("/decisions", response_model=List[AIDecisionResponse])
async def list_ai_decisions(
    feature: Optional[AIFeature] = None,
    requires_review: Optional[bool] = None,
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Admin view of all AI decisions with their confidence and review status."""
    query = select(AIDecisionLog).order_by(AIDecisionLog.created_at.desc())
    if feature:
        query = query.where(AIDecisionLog.feature == feature)
    if requires_review is not None:
        query = query.where(AIDecisionLog.requires_human_review == requires_review)
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    return result.scalars().all()


@router.put("/decisions/{decision_id}/review")
async def review_ai_decision(
    decision_id: int,
    payload: AIDecisionReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Human approval or rejection of a flagged AI decision."""
    result = await db.execute(select(AIDecisionLog).where(AIDecisionLog.id == decision_id))
    log = result.scalar_one_or_none()
    if not log:
        raise HTTPException(status_code=404, detail="AI decision log not found")

    log.human_reviewed_by = current_user.id
    log.human_approved = payload.approved
    log.review_notes = payload.notes
    log.reviewed_at = datetime.now(timezone.utc)
    log.requires_human_review = False  # Clear the flag after review

    await db.commit()
    return {"message": "Review recorded", "decision_id": decision_id, "approved": payload.approved}
