import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application configurations. Loads values from environment variables
    or a .env file.
    """
    # MySQL Asynchronous URL
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "mysql+aiomysql://intune:z~JP%3Blybdp%2CTWAs.@localhost:3306/intune_db"
    )
    
    # Fernet encryption key for credentials.
    # Needs to be a 32-byte URL-safe base64-encoded key.
    # You can generate one using: cryptography.fernet.Fernet.generate_key()
    ENCRYPTION_KEY: str = os.getenv(
        "ENCRYPTION_KEY",
        "3zR_6qU3Fk9JTk9nZ3A0dmQ5NnF3ZThydHl1aW9wYXM="  # Example fallback key for development
    )

    # Feature Flags
    ENABLE_SSO: bool = os.getenv("ENABLE_SSO", "False").lower() in ("true", "1", "yes")
    ENABLE_DRIFT_DETECTION: bool = os.getenv("ENABLE_DRIFT_DETECTION", "True").lower() in ("true", "1", "yes")

    # SSO Configuration (Entra ID)
    SSO_CLIENT_ID: str = os.getenv("SSO_CLIENT_ID", "")
    SSO_TENANT_ID: str = os.getenv("SSO_TENANT_ID", "common")
    SSO_CLIENT_SECRET: str = os.getenv("SSO_CLIENT_SECRET", "")
    SSO_REDIRECT_URI: str = os.getenv("SSO_REDIRECT_URI", "http://localhost:8000/api/v1/auth/sso/callback")

    # Alerting Configuration
    ALERT_SENDER_EMAIL: str = os.getenv("ALERT_SENDER_EMAIL", "")
    TEAMS_WEBHOOK_URL: str = os.getenv("TEAMS_WEBHOOK_URL", "")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
