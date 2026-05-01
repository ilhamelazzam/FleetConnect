from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.dependencies import CurrentActiveUser, DbSession
from app.schemas.notification import (
    NotificationCreate,
    NotificationFilter,
    NotificationListRead,
    NotificationRead,
)
from app.services.notification_service import (
    create_notification,
    delete_notification,
    list_notifications,
    list_unread_notifications,
    mark_notification_read,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListRead)
def read_notifications(
    db: DbSession,
    current_user: CurrentActiveUser,
    notification_filter: Annotated[NotificationFilter, Query(alias="filter")] = "all",
    unread_only: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> NotificationListRead:
    items, total, unread_count = list_notifications(
        db,
        current_user,
        notification_filter=notification_filter,
        unread_only=unread_only,
        limit=limit,
        offset=offset,
    )
    return NotificationListRead(
        total=total,
        unread_count=unread_count,
        offset=offset,
        limit=limit,
        items=items,
    )


@router.get("/unread", response_model=list[NotificationRead])
def read_unread_notifications(
    db: DbSession,
    current_user: CurrentActiveUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[NotificationRead]:
    return list_unread_notifications(db, current_user, limit=limit)


@router.post("", response_model=NotificationRead, status_code=status.HTTP_201_CREATED)
def create_new_notification(
    payload: NotificationCreate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> NotificationRead:
    return create_notification(db, payload, current_user)


@router.put("/{notification_id}/read", response_model=NotificationRead)
def mark_existing_notification_read(
    notification_id: int,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> NotificationRead:
    return mark_notification_read(db, notification_id, current_user)


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_notification(
    notification_id: int,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> Response:
    delete_notification(db, notification_id, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
