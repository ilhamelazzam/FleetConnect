from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

NotificationType = Literal["alert", "info", "success", "warning", "ai"]
NotificationPriority = Literal["low", "medium", "high", "critical"]
NotificationFilter = Literal["all", "alerts", "ai", "system"]


class NotificationCreate(BaseModel):
    recipient_user_id: int | None = Field(default=None, gt=0)
    type: NotificationType = "info"
    title: str = Field(min_length=1, max_length=180)
    message: str = Field(min_length=1, max_length=2000)
    priority: NotificationPriority = "medium"
    link_url: str | None = Field(default=None, max_length=255)
    ai_recommendation: str | None = Field(default=None, max_length=2000)
    action_suggeree: str | None = Field(default=None, max_length=2000)
    related_resource_id: int | None = Field(default=None, gt=0)
    related_compliance_alert_id: int | None = Field(default=None, gt=0)
    source_type: str | None = Field(default=None, max_length=80)
    source_id: str | None = Field(default=None, max_length=120)
    source_key: str | None = Field(default=None, max_length=160)
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class NotificationRead(BaseModel):
    id: int
    type: NotificationType
    title: str
    message: str
    timestamp: datetime
    is_read: bool
    status: Literal["read", "unread"]
    priority: NotificationPriority
    link_url: str | None
    ai_recommendation: str | None
    action_suggeree: str | None
    recipient_user_id: int
    actor_user_id: int | None
    related_resource_id: int | None
    related_compliance_alert_id: int | None
    source_type: str | None
    source_id: str | None
    metadata_json: dict[str, Any]


class NotificationListRead(BaseModel):
    total: int
    unread_count: int
    offset: int
    limit: int
    items: list[NotificationRead]
