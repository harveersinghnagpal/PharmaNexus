"""
AI routes — upgraded with confidence thresholds, decision logging,
human review flags, and rate limiting for regulated enterprise AI.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import date, timedelta, datetime, timezone
from typing import Optional, List
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
from app.models.ai_log import AIDecisionLog, AIFeature, ConfidenceLevel
from app.api.deps import get_current_user, require_admin, require_manager
from app.events import bus, DomainEvent, AI_DECISION_MADE

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
) -> AIDecisionLog:
    """Log an AI decision and emit event bus notification."""
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
        latency_ms=latency_ms,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    # Emit event for audit trail
    await bus.publish(DomainEvent(
        event_type=AI_DECISION_MADE,
        payload={
            "log_id": log.id,
            "feature": feature.value,
            "user_id": user_id,
            "store_id": store_id,
            "confidence_score": confidence_score,
            "confidence_level": confidence_level.value,
            "requires_human_review": requires_review,
        },
        source_service="ai_service",
        request_id=request_id,
    ))

    return log


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

    since = date.today() - timedelta(days=60)
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
    if payload.store_id:
        query = query.where(Sale.store_id == payload.store_id)

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
        future_date = date.today() + timedelta(days=i + 1)
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
        store_id=payload.store_id,
        input_summary=f"Forecast for medicine_id={payload.medicine_id}, {payload.days_ahead} days, {len(rows)} data points",
        output_summary=f"Avg daily demand: {round(avg, 1)} units, confidence: {confidence_level.value}",
        confidence_score=confidence_score,
        input_payload=payload.model_dump(),
        output_payload={"avg": avg, "std": std, "data_points": len(rows)},
        latency_ms=latency,
        request_id=request.headers.get("x-request-id", ""),
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
        "model": "moving_average_v1",
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

    since = date.today() - timedelta(days=payload.days)
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
    if payload.store_id:
        query = query.where(Sale.store_id == payload.store_id)

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
        store_id=payload.store_id,
        input_summary=f"Anomaly detection over {payload.days} days",
        output_summary=f"Found {len(anomalies)} anomalies from {len(rows)} data points",
        confidence_score=confidence_score,
        input_payload=payload.model_dump(),
        output_payload={"anomaly_count": len(anomalies)},
        latency_ms=latency,
        request_id=request.headers.get("x-request-id", ""),
    )

    return {
        "mean_daily_revenue": round(mean, 2),
        "std_dev": round(std, 2),
        "anomalies": anomalies,
        "total_days_analyzed": len(rows),
        "confidence_score": round(confidence_score, 3),
        "confidence_level": confidence_level,
        "requires_human_review": confidence_score < HUMAN_REVIEW_THRESHOLD,
    }


@router.post("/query")
async def chat_query(
    payload: ChatRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Rule-based chat query with input sanitization and decision logging."""
    start_ms = int(time.time() * 1000)

    # Input sanitization
    msg = payload.message.strip()
    if len(msg) > 500:
        raise HTTPException(status_code=400, detail="Message too long. Maximum 500 characters.")
    if len(msg) < 2:
        raise HTTPException(status_code=400, detail="Message too short.")
    msg_lower = msg.lower()

    # Gather context
    context = {}
    low_stock_result = await db.execute(
        select(func.count(Inventory.id)).where(Inventory.total_quantity <= 20)
    )
    context["low_stock_count"] = low_stock_result.scalar() or 0

    today = date.today()
    rev_result = await db.execute(
        select(func.sum(Sale.total_amount)).where(func.date(Sale.created_at) == today)
    )
    context["today_revenue"] = float(rev_result.scalar() or 0)

    top_result = await db.execute(
        select(Medicine.name, func.sum(SaleItem.quantity).label("qty"))
        .join(SaleItem, SaleItem.medicine_id == Medicine.id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(func.date(Sale.created_at) == today)
        .group_by(Medicine.name)
        .order_by(func.sum(SaleItem.quantity).desc())
        .limit(1)
    )
    top_row = top_result.first()
    context["top_medicine_today"] = top_row.name if top_row else "N/A"

    # Fetch super admins for context
    super_admins_result = await db.execute(
        select(User.name).where(User.role == UserRole.SUPER_ADMIN)
    )
    super_admins = super_admins_result.scalars().all()
    context["super_admins"] = ", ".join(super_admins) if super_admins else "None"

    response_text = ""
    response_type = "general"
    confidence_score = 1.0
    model_used = "rule_based_v1"

    if settings.GROQ_API_KEY:
        system_prompt = (
            f"You are PharmaNexus AI, a professional and highly concise assistant for a pharmacy operations platform. "
            f"You ONLY answer based strictly on the relevant data provided in this prompt. "
            f"If the user asks a question whose answer is NOT found in the context below, you MUST reply: "
            f"'I can only answer questions related to the PharmaNexus platform's current data.' "
            f"Do not invent names, figures, or external facts. Hallucination is strictly prohibited.\n\n"
            f"Here is real-time context about the pharmacy today:\n"
            f"- Low stock medicine count: {context.get('low_stock_count', 0)}\n"
            f"- Today's revenue: Rs. {context.get('today_revenue', 0.0):,.2f}\n"
            f"- Best selling medicine today: {context.get('top_medicine_today', 'N/A')}\n"
            f"- System Super Admins: {context.get('super_admins', 'Unknown')}\n\n"
            f"Rule: Keep answers extremely brief, professional, and use bullet points if listing items."
        )
        try:
            async with httpx.AsyncClient() as client:
                ai_resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                    json={
                        "model": "llama-3.1-8b-instant",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": msg}
                        ],
                        "temperature": 0.3
                    },
                    timeout=10.0
                )
            ai_resp.raise_for_status()
            data = ai_resp.json()
            response_text = data["choices"][0]["message"]["content"]
            response_type = "llm_generated"
            confidence_score = 0.95
            model_used = "groq_llama3-8b"
        except Exception as e:
            error_detail = str(e)
            if hasattr(e, "response") and hasattr(e.response, "text"):
                error_detail += f" - Content: {e.response.text}"
            response_text = f"API Error: Could not connect to Groq LLM. Contact admin. ({error_detail})"
            confidence_score = 0.1
    else:
        # Fallback rule matching
        if any(w in msg_lower for w in ["low stock", "running out", "shortage", "stock alert"]):
            response_text = f"⚠️ Currently **{context['low_stock_count']} medicines** are running low (below 20 units). Check Inventory → Low Stock alerts."
            response_type = "inventory_alert"
        elif any(w in msg_lower for w in ["revenue", "sales today", "today's sales", "earning", "income"]):
            response_text = f"💰 Today's total revenue is **₹{context['today_revenue']:,.2f}**."
            response_type = "sales_info"
        elif any(w in msg_lower for w in ["top medicine", "best selling", "popular"]):
            response_text = f"🏆 Today's best-seller is **{context['top_medicine_today']}**. See Analytics → Top Products."
            response_type = "sales_info"
        else:
            confidence_score = 0.3
            response_text = (
                f"I'm PharmaNexus AI 🤖 (Rule-based fallback active).\n\n"
                f"Stats: Revenue today = ₹{context['today_revenue']:,.2f} | Low stock alerts = {context['low_stock_count']}"
            )

    latency = int(time.time() * 1000) - start_ms

    await _log_ai_decision(
        db=db,
        feature=AIFeature.CHAT,
        user_id=current_user.id,
        store_id=payload.store_id,
        input_summary=f"Chat query: '{msg[:100]}'",
        output_summary=f"Response type: {response_type}",
        confidence_score=confidence_score,
        input_payload={"message": msg, "store_id": payload.store_id},
        output_payload={"response_type": response_type},
        latency_ms=latency,
        request_id=request.headers.get("x-request-id", ""),
    )

    return {
        "response": response_text,
        "type": response_type,
        "confidence_level": _classify_confidence(confidence_score),
        "confidence_score": round(confidence_score, 2),
        "requires_human_review": confidence_score < HUMAN_REVIEW_THRESHOLD,
        "model": model_used,
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
