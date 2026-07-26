from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.chat import (
    ChatContextMessage,
    ExecutiveReportImageContext,
    ExecutiveReportResponse,
    ExplainabilityResponse,
)

ReportType = Literal[
    "executive",
    "anomalies",
    "fraud",
    "equipment",
    "workflow",
    "cost_optimization",
    "live",
    "complete",
]


class ReportExportImage(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    src: str = Field(min_length=1)
    caption: str | None = Field(default=None, max_length=400)


class ReportGenerateRequest(BaseModel):
    report_type: ReportType = "executive"
    conversation_id: str | None = Field(default=None, max_length=120)
    history: list[ChatContextMessage] = Field(default_factory=list)
    image_analyses: list[ExecutiveReportImageContext] = Field(default_factory=list)
    executive_report: ExecutiveReportResponse | None = None
    explainability: ExplainabilityResponse | None = None
    images: list[ReportExportImage] = Field(default_factory=list)


class ReportGenerateResponse(BaseModel):
    report_id: str
    pdf_url: str
    generated_at: str
    report_type: ReportType
    fleet_health_score: int = Field(ge=0, le=100)

