from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://pharma:pharma123@localhost:5432/pharmanexus"
    SECRET_KEY: str = "pharmanexus-super-secret-key-change-in-production-2024"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # AI API Keys (optional)
    OPENAI_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None

    # App settings
    APP_NAME: str = "PharmaNexus"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://localhost:3001"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"
    MAX_UPLOAD_SIZE_MB: int = 5

    # Low stock threshold
    LOW_STOCK_THRESHOLD: int = 20
    # Expiry alert days
    EXPIRY_ALERT_DAYS: int = 30

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
