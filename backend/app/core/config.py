from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        enable_decoding=False,
    )

    app_name: str = "FleetConnect API"
    app_env: str = "development"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    log_level: str = "INFO"
    auto_create_tables: bool = False

    db_name: str = "flotte_telephonique"
    db_user: str = "postgres"
    db_password: str = "change-me"
    db_host: str = "localhost"
    db_port: int = 5432
    db_schema: str = "public"
    database_url: str | None = None
    cdr_analytics_csv_path: str | None = None
    mobile_fleet_csv_path: str | None = None
    customer_churn_input_csv_path: str | None = None
    customer_churn_output_csv_path: str | None = None

    secret_key: str = "change-me-before-production"
    refresh_secret_key: str | None = None
    password_reset_secret_key: str | None = None
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_minutes: int = 60 * 24 * 7
    password_reset_code_expire_minutes: int = 15
    frontend_url: str = "http://localhost:5173"
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str = "BC SKILLS FleetConnect"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: int = 20
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://127.0.0.1:8000/api/v1/auth/google/callback"
    microsoft_client_id: str | None = None
    microsoft_client_secret: str | None = None
    microsoft_redirect_uri: str = "http://127.0.0.1:8000/api/v1/auth/microsoft/callback"
    microsoft_tenant_id: str = "common"
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    trusted_hosts: list[str] = Field(
        default_factory=lambda: ["localhost", "127.0.0.1", "*.localhost"]
    )
    https_redirect: bool = False
    security_headers_enabled: bool = True
    default_page_size: int = 50
    max_page_size: int = 100
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 300

    default_admin_name: str = "Admin BC Skills"
    default_admin_email: str = "admin@bcskills.ma"
    default_admin_password: str = "Admin123!"

    @field_validator("cors_origins", "trusted_hosts", mode="before")
    @classmethod
    def parse_csv_lists(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        if self.smtp_use_tls and self.smtp_use_ssl:
            raise ValueError("SMTP TLS and SSL cannot both be enabled.")
        if self.app_env.lower() == "production":
            if "*" in self.cors_origins:
                raise ValueError("Wildcard CORS origins are not allowed in production.")
            if self.secret_key == "change-me-before-production":
                raise ValueError("SECRET_KEY must be changed in production.")
            if self.refresh_secret_key == "change-me-before-production":
                raise ValueError("REFRESH_SECRET_KEY must be changed in production.")
        return self

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.database_url:
            return self.database_url

        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() == "development"

    @property
    def is_sqlite(self) -> bool:
        return self.sqlalchemy_database_uri.startswith("sqlite")

    @property
    def effective_refresh_secret_key(self) -> str:
        return self.refresh_secret_key or self.secret_key

    @property
    def effective_password_reset_secret_key(self) -> str:
        return self.password_reset_secret_key or self.secret_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
