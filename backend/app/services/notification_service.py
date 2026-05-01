from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.roles import ADMIN_ROLE, normalize_role
from app.models.fleet_access import ComplianceAlert, FleetResource
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    NotificationCreate,
    NotificationFilter,
    NotificationPriority,
    NotificationRead,
    NotificationType,
)
from app.services.cdr_analytics_service import list_cdr_recommendations
from app.services.customer_churn_service import list_customer_churn_recommendations
from app.services.mobile_fleet_service import list_mobile_fleet_recommendations

ALERT_TYPES = {"alert", "warning"}
SYSTEM_TYPES = {"info", "success"}


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_priority(priority: str | None) -> NotificationPriority:
    if priority in {"low", "medium", "high", "critical"}:
        return priority  # type: ignore[return-value]
    return "medium"


def _normalize_type(notification_type: str | None) -> NotificationType:
    if notification_type in {"alert", "info", "success", "warning", "ai"}:
        return notification_type  # type: ignore[return-value]
    return "info"


def _priority_from_risk_level(risk_level: str | None) -> NotificationPriority:
    normalized = (risk_level or "").strip().lower()
    if normalized in {"critique", "critical"}:
        return "critical"
    if normalized in {"eleve", "elevee", "high", "moderate"}:
        return "high"
    if normalized in {"moyen", "medium", "warning"}:
        return "medium"
    return "low"


def _priority_from_cdr_severity(severity: str | None) -> NotificationPriority:
    normalized = (severity or "").strip().lower()
    if normalized == "critique":
        return "critical"
    if normalized == "eleve":
        return "high"
    if normalized == "moyen":
        return "medium"
    return "low"


def _build_notification_read(notification: Notification) -> NotificationRead:
    is_read = notification.read_at is not None
    return NotificationRead(
        id=notification.id,
        type=_normalize_type(notification.notification_type),
        title=notification.title,
        message=notification.message,
        timestamp=notification.created_at,
        is_read=is_read,
        status="read" if is_read else "unread",
        priority=_normalize_priority(notification.priority),
        link_url=notification.link_url,
        ai_recommendation=notification.ai_recommendation,
        action_suggeree=notification.suggested_action,
        recipient_user_id=notification.recipient_user_id,
        actor_user_id=notification.actor_user_id,
        related_resource_id=notification.related_resource_id,
        related_compliance_alert_id=notification.related_compliance_alert_id,
        source_type=notification.source_type,
        source_id=notification.source_id,
        metadata_json=notification.metadata_json or {},
    )


def _find_existing_by_source(
    db: Session,
    *,
    recipient_user_id: int,
    source_key: str | None,
) -> Notification | None:
    if not source_key:
        return None
    return db.scalar(
        select(Notification).where(
            Notification.recipient_user_id == recipient_user_id,
            Notification.source_key == source_key,
        )
    )


def enqueue_notification(
    db: Session,
    *,
    recipient_user_id: int,
    notification_type: NotificationType,
    title: str,
    message: str,
    priority: NotificationPriority = "medium",
    actor_user_id: int | None = None,
    related_resource_id: int | None = None,
    related_compliance_alert_id: int | None = None,
    link_url: str | None = None,
    ai_recommendation: str | None = None,
    suggested_action: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    source_key: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> Notification:
    existing_notification = _find_existing_by_source(
        db,
        recipient_user_id=recipient_user_id,
        source_key=source_key,
    )
    if existing_notification is not None:
        if existing_notification.is_deleted:
            existing_notification.is_deleted = False
            existing_notification.read_at = None
            existing_notification.updated_at = datetime.now(UTC)
            db.add(existing_notification)
        return existing_notification

    notification = Notification(
        recipient_user_id=recipient_user_id,
        actor_user_id=actor_user_id,
        related_resource_id=related_resource_id,
        related_compliance_alert_id=related_compliance_alert_id,
        notification_type=notification_type,
        title=title.strip(),
        message=message.strip(),
        priority=priority,
        link_url=_clean_text(link_url),
        ai_recommendation=_clean_text(ai_recommendation),
        suggested_action=_clean_text(suggested_action),
        source_type=_clean_text(source_type),
        source_id=_clean_text(source_id),
        source_key=_clean_text(source_key),
        metadata_json=metadata_json or {},
    )
    db.add(notification)
    return notification


def create_notification(
    db: Session,
    payload: NotificationCreate,
    current_user: User,
) -> NotificationRead:
    recipient_user_id = payload.recipient_user_id or current_user.id
    if recipient_user_id != current_user.id and normalize_role(current_user.role) != ADMIN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can create notifications for another user",
        )
    if db.get(User, recipient_user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")

    notification = enqueue_notification(
        db,
        recipient_user_id=recipient_user_id,
        actor_user_id=current_user.id,
        notification_type=payload.type,
        title=payload.title,
        message=payload.message,
        priority=payload.priority,
        related_resource_id=payload.related_resource_id,
        related_compliance_alert_id=payload.related_compliance_alert_id,
        link_url=payload.link_url,
        ai_recommendation=payload.ai_recommendation,
        suggested_action=payload.action_suggeree,
        source_type=payload.source_type or "manual",
        source_id=payload.source_id,
        source_key=payload.source_key,
        metadata_json=payload.metadata_json,
    )
    db.commit()
    db.refresh(notification)
    return _build_notification_read(notification)


def _sync_mobile_budget_notifications(db: Session, current_user: User) -> None:
    try:
        recommendations = list_mobile_fleet_recommendations(limit=3)["items"]
    except Exception:
        return

    for item in recommendations:
        enqueue_notification(
            db,
            recipient_user_id=current_user.id,
            notification_type="warning" if item["risk_level"] != "Critique" else "alert",
            title=item["title"],
            message=item["description"],
            priority=_priority_from_risk_level(item["risk_level"]),
            link_url="/consommations",
            ai_recommendation=item.get("ai_recommendation") or item.get("recommendation"),
            suggested_action=item.get("suggested_action"),
            source_type="mobile_budget_risk",
            source_id=str(item["fleet_row_id"]),
            source_key=f"mobile-budget:{item['fleet_row_id']}",
            metadata_json={
                "budget_risk_score": item["budget_risk_score"],
                "estimated_price_mad": item["estimated_price_mad"],
            },
        )


def _sync_cdr_fraud_notifications(db: Session, current_user: User) -> None:
    try:
        recommendations = list_cdr_recommendations(limit=3)["items"]
    except Exception:
        return

    for item in recommendations:
        enqueue_notification(
            db,
            recipient_user_id=current_user.id,
            notification_type="alert",
            title=item["title"],
            message=item["description"],
            priority=_priority_from_cdr_severity(item["severity"]),
            link_url=f"/anomalies/{item['cdr_row_id']}",
            ai_recommendation=item.get("ai_recommendation") or item.get("recommendation"),
            suggested_action=item.get("suggested_action"),
            source_type="cdr_fraud_alert",
            source_id=str(item["cdr_row_id"]),
            source_key=f"cdr-fraud:{item['cdr_row_id']}",
            metadata_json={
                "fraud_risk_score_100": item["fraud_risk_score_100"],
                "call_cost_mad": item["call_cost_mad"],
            },
        )


def _sync_churn_ai_notifications(db: Session, current_user: User) -> None:
    try:
        recommendations = list_customer_churn_recommendations(limit=3)["items"]
    except Exception:
        return

    for item in recommendations:
        enqueue_notification(
            db,
            recipient_user_id=current_user.id,
            notification_type="ai",
            title=item["title"],
            message=item["description"],
            priority=_priority_from_risk_level(item["risk_level"]),
            link_url="/recommandations",
            ai_recommendation=item.get("ai_recommendation") or item.get("recommendation"),
            suggested_action=item.get("suggested_action"),
            source_type="customer_churn_recommendation",
            source_id=str(item["customer_row_id"]),
            source_key=f"customer-churn:{item['customer_row_id']}",
            metadata_json={
                "risk_score_100": item["risk_score_100"],
                "risk_proba": item["risk_proba"],
            },
        )


def _compliance_alert_statement(current_user: User):
    statement = select(ComplianceAlert).where(ComplianceAlert.status.in_(("open", "acknowledged")))
    if normalize_role(current_user.role) == ADMIN_ROLE:
        return statement
    return statement.where(ComplianceAlert.user_id == current_user.id)


def _sync_compliance_notifications(db: Session, current_user: User) -> None:
    alerts = list(
        db.scalars(
            _compliance_alert_statement(current_user)
            .order_by(ComplianceAlert.created_at.desc(), ComplianceAlert.id.desc())
            .limit(5)
        )
    )
    resource_ids = {alert.resource_id for alert in alerts}
    resources = {
        resource.id: resource
        for resource in db.scalars(select(FleetResource).where(FleetResource.id.in_(resource_ids)))
    } if resource_ids else {}

    for alert in alerts:
        resource = resources.get(alert.resource_id)
        target_recipient_id = (
            current_user.id if normalize_role(current_user.role) == ADMIN_ROLE else alert.user_id
        )
        enqueue_notification(
            db,
            recipient_user_id=target_recipient_id,
            notification_type="alert" if alert.severity == "critical" else "warning",
            title=alert.title,
            message=alert.description,
            priority=_priority_from_risk_level(alert.severity),
            related_resource_id=alert.resource_id,
            related_compliance_alert_id=alert.id,
            link_url="/acces-flotte",
            ai_recommendation=alert.recommended_action,
            suggested_action=alert.recommended_action,
            source_type="resource_compliance_alert",
            source_id=str(alert.id),
            source_key=f"resource-compliance:{alert.id}",
            metadata_json={
                "resource_label": resource.label if resource else None,
                "severity": alert.severity,
            },
        )


def sync_smart_notifications(db: Session, current_user: User) -> None:
    _sync_mobile_budget_notifications(db, current_user)
    _sync_cdr_fraud_notifications(db, current_user)
    _sync_churn_ai_notifications(db, current_user)
    _sync_compliance_notifications(db, current_user)
    db.commit()


def _filtered_statement(current_user: User, notification_filter: NotificationFilter | None):
    statement = select(Notification).where(
        Notification.recipient_user_id == current_user.id,
        Notification.is_deleted.is_(False),
    )
    if notification_filter == "alerts":
        statement = statement.where(Notification.notification_type.in_(ALERT_TYPES))
    elif notification_filter == "ai":
        statement = statement.where(Notification.notification_type == "ai")
    elif notification_filter == "system":
        statement = statement.where(Notification.notification_type.in_(SYSTEM_TYPES))
    return statement


def list_notifications(
    db: Session,
    current_user: User,
    *,
    notification_filter: NotificationFilter | None = "all",
    unread_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[NotificationRead], int, int]:
    sync_smart_notifications(db, current_user)
    statement = _filtered_statement(current_user, notification_filter)
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    unread_count = (
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.recipient_user_id == current_user.id,
                Notification.is_deleted.is_(False),
                Notification.read_at.is_(None),
            )
        )
        or 0
    )
    notifications = list(
        db.scalars(
            statement.order_by(
                Notification.read_at.is_not(None),
                Notification.created_at.desc(),
                Notification.id.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
    )
    return (
        [_build_notification_read(notification) for notification in notifications],
        total,
        unread_count,
    )


def list_unread_notifications(
    db: Session,
    current_user: User,
    *,
    limit: int = 50,
) -> list[NotificationRead]:
    notifications, _, _ = list_notifications(
        db,
        current_user,
        unread_only=True,
        limit=limit,
        offset=0,
    )
    return notifications


def mark_notification_read(
    db: Session,
    notification_id: int,
    current_user: User,
) -> NotificationRead:
    notification = db.get(Notification, notification_id)
    if notification is None or notification.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if notification.recipient_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Notification access denied",
        )

    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        db.add(notification)
        db.commit()
        db.refresh(notification)
    return _build_notification_read(notification)


def delete_notification(db: Session, notification_id: int, current_user: User) -> None:
    notification = db.get(Notification, notification_id)
    if notification is None or notification.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    if notification.recipient_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Notification access denied",
        )
    notification.is_deleted = True
    db.add(notification)
    db.commit()


def notify_resource_created(db: Session, *, actor: User, resource: FleetResource) -> None:
    enqueue_notification(
        db,
        recipient_user_id=actor.id,
        actor_user_id=actor.id,
        related_resource_id=resource.id,
        notification_type="success",
        title="Nouvelle ressource ajoutee",
        message=f"{resource.label} ({resource.identifier}) est disponible dans Acces flotte.",
        priority="medium",
        link_url="/acces-flotte",
        suggested_action=(
            "Verifier les profils autorises et attribuer la ressource au bon utilisateur."
        ),
        source_type="resource_created",
        source_id=str(resource.id),
        source_key=f"resource-created:{resource.id}",
    )


def notify_resource_assignment(
    db: Session,
    *,
    actor: User,
    target_user: User,
    resource: FleetResource,
    assignment_id: int,
) -> None:
    enqueue_notification(
        db,
        recipient_user_id=target_user.id,
        actor_user_id=actor.id,
        related_resource_id=resource.id,
        notification_type="info",
        title="Ressource attribuee",
        message=f"{resource.label} vous a ete attribuee par {actor.full_name}.",
        priority="medium",
        link_url="/acces-flotte",
        suggested_action=(
            "Consulter les regles d'usage et confirmer que la ressource correspond au besoin."
        ),
        source_type="resource_assignment",
        source_id=str(assignment_id),
        source_key=f"resource-assignment:{assignment_id}:target",
    )
    if actor.id != target_user.id:
        enqueue_notification(
            db,
            recipient_user_id=actor.id,
            actor_user_id=actor.id,
            related_resource_id=resource.id,
            notification_type="success",
            title="Attribution effectuee",
            message=f"{resource.label} est maintenant attribuee a {target_user.full_name}.",
            priority="low",
            link_url="/acces-flotte",
            source_type="resource_assignment",
            source_id=str(assignment_id),
            source_key=f"resource-assignment:{assignment_id}:actor",
        )


def notify_compliance_alert(
    db: Session,
    *,
    actor: User,
    target_user: User,
    resource: FleetResource,
    alert: ComplianceAlert,
) -> None:
    priority = "critical" if alert.severity == "critical" else "high"
    for recipient_id in {actor.id, target_user.id}:
        enqueue_notification(
            db,
            recipient_user_id=recipient_id,
            actor_user_id=actor.id,
            related_resource_id=resource.id,
            related_compliance_alert_id=alert.id,
            notification_type="alert" if alert.severity == "critical" else "warning",
            title=alert.title,
            message=alert.description,
            priority=priority,
            link_url="/acces-flotte",
            ai_recommendation=alert.recommended_action,
            suggested_action=alert.recommended_action,
            source_type="resource_compliance_alert",
            source_id=str(alert.id),
            source_key=f"resource-compliance:{alert.id}:{recipient_id}",
        )
