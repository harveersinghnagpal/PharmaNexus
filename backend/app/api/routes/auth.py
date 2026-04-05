from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.config import settings
from app.core.security import verify_password, create_access_token
from app.models.user import User
from app.models.audit import AuditAction
from app.schemas.user import LoginRequest, TokenResponse, UserResponse
from app.api.deps import get_current_user
from app.events import bus, DomainEvent, USER_LOGIN
from app.services.audit_service import write_audit_log

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    
    # Emit audit event asynchronously without waiting for it to finish mapping
    await bus.publish(DomainEvent(
        event_type=USER_LOGIN,
        payload={
            "user_id": user.id,
            "role": user.role.value,
            "email": user.email,
            "ip_address": request.client.host if request.client else None,
        },
        source_service="auth_service",
        request_id=getattr(request.state, "request_id", ""),
    ))
    
    # Set HttpOnly cookie
    response.set_cookie(
        key="access_token",
        value=f"Bearer {token}",
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
        max_age=86400, # 24 hours
        secure=settings.COOKIE_SECURE,
    )
    
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await write_audit_log(
        db=db,
        entity_type="User",
        entity_id=str(current_user.id),
        action=AuditAction.LOGOUT,
        user_id=current_user.id,
        description=f"User {current_user.email} ({current_user.role.value}) logged out",
        ip_address=request.client.host if request.client else None,
        request_id=getattr(request.state, "request_id", None),
    )
    await db.commit()

    response.delete_cookie(
        key="access_token",
        httponly=True,
        samesite=settings.COOKIE_SAMESITE,
    )
    return {"message": "Logged out successfully"}
