from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User, UserRole

security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = None
    if credentials:
        token = credentials.credentials
    elif "access_token" in request.cookies:
        # Strip 'Bearer ' if present in the cookie
        cookie_val = request.cookies["access_token"]
        token = cookie_val.replace("Bearer ", "") if cookie_val.startswith("Bearer ") else cookie_val

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_roles(*roles: UserRole):
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[r.value for r in roles]}",
            )
        return current_user
    return role_checker


# Convenience role dependencies
require_super_admin = require_roles(UserRole.SUPER_ADMIN)
require_admin = require_roles(UserRole.SUPER_ADMIN, UserRole.REGIONAL_ADMIN)
require_manager = require_roles(UserRole.SUPER_ADMIN, UserRole.REGIONAL_ADMIN, UserRole.STORE_MANAGER)
require_inventory = require_roles(
    UserRole.SUPER_ADMIN, UserRole.REGIONAL_ADMIN,
    UserRole.STORE_MANAGER, UserRole.INVENTORY_SUPERVISOR
)
require_any = get_current_user
