from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
AI_INPUT_DIR = PROJECT_ROOT / "ai" / "data" / "input"
AI_OUTPUT_DIR = PROJECT_ROOT / "ai" / "data" / "output"

DEFAULT_DEVELOPMENT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://192.168.0.131:5173",
    "http://192.168.0.131:5174",
]
DEFAULT_TRUSTED_HOSTS = ["localhost", "127.0.0.1", "*.localhost", "192.168.0.131"]
PRIVATE_NETWORK_CORS_REGEX = (
    r"^https?://(?:localhost|127\.0\.0\.1|"
    r"192\.168(?:\.\d{1,3}){2}|"
    r"10(?:\.\d{1,3}){3}|"
    r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(:\d+)?$"
)


@dataclass(frozen=True, slots=True)
class ResolvedDataSource:
    key: str
    preferred_name: str
    configured_path: Path | None
    searched_paths: tuple[Path, ...]
    path: Path | None
    optional: bool = True

    @property
    def exists(self) -> bool:
        return self.path is not None and self.path.exists()

    @property
    def label(self) -> str:
        if self.path is not None:
            return self.path.name
        return self.preferred_name


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
    mobile_fleet_advanced_kpi_csv_path: str | None = None
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
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = Field(
        default="llama3.2:3b",
        validation_alias=AliasChoices("OLLAMA_CHAT_MODEL", "OLLAMA_MODEL"),
    )
    ollama_vision_model: str = Field(
        default="llava",
        validation_alias=AliasChoices("OLLAMA_VISION_MODEL", "OLLAMA_VISION_MODEL_NAME"),
    )
    ollama_timeout_seconds: int = 8
    ollama_vision_timeout_seconds: int = 120
    ollama_vision_retry_count: int = 0
    image_preprocess_max_side: int = 1600
    image_max_upload_bytes: int = 10 * 1024 * 1024
    image_analysis_default_mode: str = "quick"
    image_analysis_max_side: int = 1024
    image_analysis_ocr_timeout_seconds: int = 20
    image_analysis_llm_timeout_seconds: int = 45
    image_analysis_vision_timeout_seconds: int = Field(
        default=120,
        validation_alias=AliasChoices(
            "IMAGE_ANALYSIS_VISION_TIMEOUT_SECONDS",
            "IMAGE_VISION_TIMEOUT_SECONDS",
        ),
    )
    image_ocr_languages: list[str] = Field(default_factory=lambda: ["fr", "en"])
    voice_max_upload_bytes: int = 12 * 1024 * 1024
    voice_stt_enabled: bool = True
    voice_stt_provider: str = Field(
        default="auto",
        validation_alias=AliasChoices("VOICE_STT_PROVIDER", "VOICE_TRANSCRIPTION_PROVIDER"),
    )
    voice_stt_model: str = Field(
        default="base",
        validation_alias=AliasChoices("VOICE_STT_MODEL", "VOICE_TRANSCRIPTION_MODEL_SIZE"),
    )
    voice_stt_language: str = Field(
        default="fr",
        validation_alias=AliasChoices("VOICE_STT_LANGUAGE", "VOICE_TRANSCRIPTION_LANGUAGE"),
    )
    voice_stt_device: str = Field(
        default="auto",
        validation_alias=AliasChoices("VOICE_STT_DEVICE", "VOICE_TRANSCRIPTION_DEVICE"),
    )
    voice_stt_compute_type: str = Field(
        default="int8",
        validation_alias=AliasChoices(
            "VOICE_STT_COMPUTE_TYPE",
            "VOICE_TRANSCRIPTION_COMPUTE_TYPE",
        ),
    )
    voice_stt_preload: bool = False
    voice_tts_voice: str = "fr-FR-DeniseNeural"
    voice_tts_rate: str = "+0%"
    voice_tts_volume: str = "+0%"
    voice_tts_pitch: str = "+0Hz"
    voice_tts_max_chars: int = 4000
    microsoft_client_id: str | None = None
    microsoft_client_secret: str | None = None
    microsoft_redirect_uri: str = "http://127.0.0.1:8000/api/v1/auth/microsoft/callback"
    microsoft_tenant_id: str = "common"
    cors_origins: list[str] = Field(
        default_factory=lambda: DEFAULT_DEVELOPMENT_CORS_ORIGINS.copy()
    )
    trusted_hosts: list[str] = Field(
        default_factory=lambda: DEFAULT_TRUSTED_HOSTS.copy()
    )
    https_redirect: bool = False
    security_headers_enabled: bool = True
    default_page_size: int = 50
    max_page_size: int = 100
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: int = 300
    company_registration_upload_dir: str = str(BACKEND_DIR / "uploads" / "company-registration")
    company_registration_max_upload_bytes: int = 5 * 1024 * 1024

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
        normalized_frontend_url = self.frontend_url.rstrip("/")
        if normalized_frontend_url and normalized_frontend_url not in self.cors_origins:
            self.cors_origins = [*self.cors_origins, normalized_frontend_url]

        if self.smtp_use_tls and self.smtp_use_ssl:
            raise ValueError("SMTP TLS and SSL cannot both be enabled.")
        if self.app_env.lower() == "production":
            if "*" in self.cors_origins:
                raise ValueError("Wildcard CORS origins are not allowed in production.")
            if self.secret_key == "change-me-before-production":
                raise ValueError("SECRET_KEY must be changed in production.")
            if self.refresh_secret_key == "change-me-before-production":
                raise ValueError("REFRESH_SECRET_KEY must be changed in production.")
        self.voice_stt_provider = self.voice_stt_provider.strip().lower() or "auto"
        self.voice_stt_model = self.voice_stt_model.strip() or "base"
        self.voice_stt_language = self.voice_stt_language.strip() or "fr"
        self.voice_stt_device = self.voice_stt_device.strip() or "auto"
        self.voice_stt_compute_type = self.voice_stt_compute_type.strip() or "int8"
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
    def cors_allow_origin_regex(self) -> str | None:
        if not self.is_development:
            return None
        return PRIVATE_NETWORK_CORS_REGEX

    @property
    def is_sqlite(self) -> bool:
        return self.sqlalchemy_database_uri.startswith("sqlite")

    @property
    def effective_refresh_secret_key(self) -> str:
        return self.refresh_secret_key or self.secret_key

    @property
    def effective_password_reset_secret_key(self) -> str:
        return self.password_reset_secret_key or self.secret_key

    @property
    def project_root(self) -> Path:
        return PROJECT_ROOT

    @property
    def ai_input_dir(self) -> Path:
        return AI_INPUT_DIR

    @property
    def ai_output_dir(self) -> Path:
        return AI_OUTPUT_DIR

    @property
    def voice_transcription_model_size(self) -> str:
        return self.voice_stt_model

    @property
    def voice_transcription_device(self) -> str:
        return self.voice_stt_device

    @property
    def voice_transcription_compute_type(self) -> str:
        return self.voice_stt_compute_type

    def resolve_path(self, raw_path: str | Path | None) -> Path | None:
        if raw_path is None:
            return None

        normalized = str(raw_path).strip()
        if not normalized:
            return None

        candidate = Path(normalized)
        if not candidate.is_absolute():
            candidate = self.project_root / candidate
        return candidate.resolve()

    def _resolve_data_source(
        self,
        *,
        key: str,
        configured_path: str | None,
        preferred_name: str,
        candidate_paths: tuple[Path, ...],
        optional: bool = True,
    ) -> ResolvedDataSource:
        normalized_configured_path = self.resolve_path(configured_path)
        searched_paths = [normalized_configured_path] if normalized_configured_path else list(candidate_paths)

        deduplicated_paths: list[Path] = []
        seen_paths: set[Path] = set()
        for candidate_path in searched_paths:
            resolved_candidate = candidate_path.resolve()
            if resolved_candidate in seen_paths:
                continue
            seen_paths.add(resolved_candidate)
            deduplicated_paths.append(resolved_candidate)

        selected_path = next((candidate for candidate in deduplicated_paths if candidate.exists()), None)
        return ResolvedDataSource(
            key=key,
            preferred_name=preferred_name,
            configured_path=normalized_configured_path,
            searched_paths=tuple(deduplicated_paths),
            path=selected_path,
            optional=optional,
        )

    def resolve_cdr_analytics_source(self) -> ResolvedDataSource:
        return self._resolve_data_source(
            key="cdr_analytics",
            configured_path=self.cdr_analytics_csv_path,
            preferred_name="telecom_cdr_fraud_fleetconnect_enriched.csv",
            candidate_paths=(
                self.ai_output_dir / "telecom_cdr_fraud_fleetconnect_enriched.csv",
                self.ai_output_dir / "telecom_cdr_fraud_output_maroc.csv",
            ),
        )

    def resolve_mobile_fleet_source(self) -> ResolvedDataSource:
        return self._resolve_data_source(
            key="mobile_fleet",
            configured_path=self.mobile_fleet_csv_path,
            preferred_name="mobile_fleet_xgboost_output.csv",
            candidate_paths=(
                self.ai_output_dir / "mobile_fleet_xgboost_output.csv",
                self.ai_output_dir / "fleetconnect_ai_output.csv",
                self.ai_output_dir / "mobile_fleet_project_ready.csv",
            ),
        )

    def resolve_mobile_fleet_advanced_kpi_source(self) -> ResolvedDataSource:
        return self._resolve_data_source(
            key="mobile_fleet_advanced_kpi",
            configured_path=self.mobile_fleet_advanced_kpi_csv_path,
            preferred_name="fleetconnect_advanced_kpi.csv",
            candidate_paths=(self.ai_output_dir / "fleetconnect_advanced_kpi.csv",),
        )

    def resolve_customer_churn_input_source(self) -> ResolvedDataSource:
        return self._resolve_data_source(
            key="customer_churn_input",
            configured_path=self.customer_churn_input_csv_path,
            preferred_name="WA_Fn-UseC_-Telco-Customer-Churn.csv",
            candidate_paths=(self.ai_input_dir / "WA_Fn-UseC_-Telco-Customer-Churn.csv",),
        )

    def resolve_customer_churn_output_source(self) -> ResolvedDataSource:
        return self._resolve_data_source(
            key="customer_churn_output",
            configured_path=self.customer_churn_output_csv_path,
            preferred_name="fleet_ai_results_morocco.csv",
            candidate_paths=(self.ai_output_dir / "fleet_ai_results_morocco.csv",),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
