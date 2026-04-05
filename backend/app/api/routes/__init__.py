from app.api.routes.auth import router as auth_router
from app.api.routes.inventory import router as inventory_router
from app.api.routes.billing import router as billing_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.ai import router as ai_router

__all__ = [auth_router, inventory_router, billing_router, analytics_router, ai_router]
