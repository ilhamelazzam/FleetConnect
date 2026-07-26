from typing import Any, Literal

from pydantic import BaseModel, Field, RootModel, model_validator


HealthStatus = Literal["ok", "degraded", "error"]
HealthServiceStatus = Literal["ok", "degraded", "error", "missing", "unavailable"]


class HealthCheckResponse(BaseModel):
    status: HealthServiceStatus
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class HealthChecksResponse(RootModel[dict[str, HealthCheckResponse]]):
    root: dict[str, HealthCheckResponse]

    def __getitem__(self, key: str) -> HealthCheckResponse:
        return self.root[key]

    def get(self, key: str, default: HealthCheckResponse | None = None) -> HealthCheckResponse | None:
        return self.root.get(key, default)

    def items(self):
        return self.root.items()


class HealthResponse(BaseModel):
    status: HealthStatus
    app_name: str
    environment: str
    version: str
    timestamp: str
    services: HealthChecksResponse
    checks: HealthChecksResponse | None = None

    @model_validator(mode="after")
    def populate_legacy_checks(self) -> "HealthResponse":
        if self.checks is None:
            self.checks = self.services
        return self
