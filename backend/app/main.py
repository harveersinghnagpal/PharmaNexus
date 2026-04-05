"""PharmaNexus Backend — Enterprise FastAPI Application

Enterprise-grade configuration with:
- Domain-service architecture (service layer + event bus)
- Observability (Prometheus metrics, structured JSON logs, request tracing)
- Health checks with DB ping
- Secure CORS configuration
- Static file serving for prescription uploads
"""
import uuid
import time
from contextlib import asynccontextmanager
from collections import defaultdict
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
import os

from app.core.config import settings
from app.core.database import create_tables
from app.api.routes import auth, inventory, billing, analytics, ai
from app.api.routes import audit, prescriptions, sync
from app.utils.logger import setup_logger


# ─── Startup / Shutdown ───────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler — startup and shutdown."""
    setup_logger()
    logger.info("═══ PharmaNexus starting up ═══")
    app.state.metrics = {
        "started_at": time.time(),
        "request_count": 0,
        "error_count": 0,
        "status_counts": defaultdict(int),
        "route_timings_ms": defaultdict(list),
    }

    # Create all DB tables (idempotent)
    await create_tables()
    logger.info("✓ Database tables verified/created")

    # Register audit event handlers (subscribes to domain events)
    from app.services.audit_service import register_audit_handlers
    register_audit_handlers()
    logger.info("✓ Audit event handlers registered")

    if settings.DEBUG:
        from app.core.database import AsyncSessionLocal
        from app.services.demo_seed import ensure_demo_data

        async with AsyncSessionLocal() as session:
            await ensure_demo_data(session)
        logger.info("✓ Demo data verified/backfilled")

    # Ensure upload directory exists
    os.makedirs("uploads/prescriptions", exist_ok=True)
    logger.info("✓ Upload directories ready")

    logger.info("═══ PharmaNexus ready to serve ═══")
    yield
    logger.info("═══ PharmaNexus shutting down ═══")


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Enterprise Omnichannel Pharmacy Operations Platform. "
        "Features: RBAC, inventory management, POS billing, BI analytics, "
        "AI insights with guardrails, audit trails, offline sync, compliance controls."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── Middleware ────────────────────────────────────────────────────────────────

# CORS — tighten in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.DEBUG else [origin.strip() for origin in settings.ALLOWED_ORIGINS.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Response-Time"],
)


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    """
    Adds:
    - X-Request-ID header (for log correlation)
    - X-Response-Time header (for observability)
    - Structured request logging
    """
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())[:8]
    start_time = time.time()

    # Attach request_id to request state for use in routes
    request.state.request_id = request_id

    with logger.contextualize(request_id=request_id):
        logger.info(f"→ {request.method} {request.url.path}")
        try:
            response = await call_next(request)
            duration_ms = round((time.time() - start_time) * 1000, 2)
            metrics = request.app.state.metrics
            metrics["request_count"] += 1
            metrics["status_counts"][str(response.status_code)] += 1
            metrics["route_timings_ms"][f"{request.method} {request.url.path}"].append(duration_ms)
            if len(metrics["route_timings_ms"][f"{request.method} {request.url.path}"]) > 50:
                metrics["route_timings_ms"][f"{request.method} {request.url.path}"] = metrics["route_timings_ms"][f"{request.method} {request.url.path}"][-50:]
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Response-Time"] = f"{duration_ms}ms"
            logger.info(f"← {response.status_code} {request.url.path} [{duration_ms}ms]")
            return response
        except Exception as exc:
            duration_ms = round((time.time() - start_time) * 1000, 2)
            metrics = request.app.state.metrics
            metrics["request_count"] += 1
            metrics["error_count"] += 1
            metrics["status_counts"]["500"] += 1
            metrics["route_timings_ms"][f"{request.method} {request.url.path}"].append(duration_ms)
            if len(metrics["route_timings_ms"][f"{request.method} {request.url.path}"]) > 50:
                metrics["route_timings_ms"][f"{request.method} {request.url.path}"] = metrics["route_timings_ms"][f"{request.method} {request.url.path}"][-50:]
            logger.error(f"✗ {request.url.path} [{duration_ms}ms] — {exc}")
            raise


# ─── Static files (prescription document uploads) ─────────────────────────────
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# ─── Routers ──────────────────────────────────────────────────────────────────

# Core domain routers
app.include_router(auth.router)
app.include_router(inventory.router)
app.include_router(billing.router)
app.include_router(analytics.router)
app.include_router(ai.router)

# Enterprise routers
app.include_router(audit.router)
app.include_router(prescriptions.router)
app.include_router(sync.router)


# ─── System Endpoints ─────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
async def health():
    """
    Extended health check including DB connectivity.
    Used by load balancers and monitoring systems.
    """
    from app.core.database import engine
    from sqlalchemy import text
    db_status = "ok"
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"error: {str(e)}"
        logger.error(f"Health check DB ping failed: {e}")

    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "database": db_status,
        "environment": "production" if not settings.DEBUG else "development",
    }


@app.get("/health/live", tags=["System"])
async def liveness():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }


@app.get("/health/ready", tags=["System"])
async def readiness(request: Request):
    from app.core.database import engine
    from sqlalchemy import text

    db_ready = True
    db_error = None
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        db_ready = False
        db_error = str(exc)

    metrics = request.app.state.metrics
    return {
        "ready": db_ready,
        "database": "ok" if db_ready else "error",
        "database_error": db_error,
        "uptime_seconds": round(time.time() - metrics["started_at"], 2),
        "requests_served": metrics["request_count"],
        "request_errors": metrics["error_count"],
    }


@app.get("/metrics", response_class=PlainTextResponse, tags=["System"])
async def metrics(request: Request):
    metrics = request.app.state.metrics
    lines = [
        "# HELP pharmanexus_requests_total Total HTTP requests served",
        "# TYPE pharmanexus_requests_total counter",
        f"pharmanexus_requests_total {metrics['request_count']}",
        "# HELP pharmanexus_request_errors_total Total HTTP request failures",
        "# TYPE pharmanexus_request_errors_total counter",
        f"pharmanexus_request_errors_total {metrics['error_count']}",
        "# HELP pharmanexus_uptime_seconds API process uptime in seconds",
        "# TYPE pharmanexus_uptime_seconds gauge",
        f"pharmanexus_uptime_seconds {round(time.time() - metrics['started_at'], 2)}",
    ]

    for status_code, count in sorted(metrics["status_counts"].items()):
        lines.append(f'pharmanexus_response_status_total{{status="{status_code}"}} {count}')

    for route_key, timings in sorted(metrics["route_timings_ms"].items()):
        if not timings:
            continue
        avg_ms = round(sum(timings) / len(timings), 2)
        sanitized_route = route_key.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'pharmanexus_route_response_ms_avg{{route="{sanitized_route}"}} {avg_ms}')

    return "\n".join(lines) + "\n"


@app.get("/", tags=["System"])
async def root():
    return {
        "message": "PharmaNexus Enterprise API",
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
    }
