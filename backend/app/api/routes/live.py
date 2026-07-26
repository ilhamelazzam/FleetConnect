from __future__ import annotations

import logging
from jose import JWTError
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.config import get_settings
from app.core.dependencies import CurrentActiveUser
from app.core.security import ACCESS_TOKEN_TYPE, decode_token
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.live import LiveMonitoringSnapshotResponse, LiveMonitoringStatusResponse
from app.services.live_monitoring_service import (
    connect_live_monitoring_client,
    disconnect_live_monitoring_client,
    ensure_live_monitoring_started,
    get_live_monitoring_snapshot,
    get_live_monitoring_status,
)

router = APIRouter(prefix="/live", tags=["live"])
LIVE_LOGGER = logging.getLogger("app.live")
settings = get_settings()


def _resolve_websocket_user(token: str | None) -> User | None:
    if not token:
        return None

    try:
        payload = decode_token(token)
        subject = payload.get("sub")
        token_type = payload.get("type")
        if subject is None or token_type != ACCESS_TOKEN_TYPE:
            return None
        user_id = int(subject)
    except (JWTError, ValueError):
        return None

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            return None
        return user
    finally:
        db.close()


@router.get("/status", response_model=LiveMonitoringStatusResponse)
async def live_status(_: CurrentActiveUser) -> LiveMonitoringStatusResponse:
    await ensure_live_monitoring_started()
    return get_live_monitoring_status()


@router.get("/kpis", response_model=LiveMonitoringSnapshotResponse)
async def live_kpis(_: CurrentActiveUser) -> LiveMonitoringSnapshotResponse:
    await ensure_live_monitoring_started()
    return get_live_monitoring_snapshot()


@router.websocket("/stream")
async def live_stream(
    websocket: WebSocket,
    token: str | None = Query(default=None),
) -> None:
    user = _resolve_websocket_user(token)
    if user is None:
        if settings.is_development:
            LIVE_LOGGER.warning(
                "event=WEBSOCKET_CONNECTED status=rejected client=%s",
                websocket.client.host if websocket.client else "unknown",
            )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if settings.is_development:
        LIVE_LOGGER.info(
            "event=WEBSOCKET_CONNECTED status=accepted user_id=%s client=%s",
            user.id,
            websocket.client.host if websocket.client else "unknown",
        )
    await connect_live_monitoring_client(websocket)

    try:
        while True:
            message = await websocket.receive_text()
            if message.strip().lower() == "status":
                await websocket.send_json(
                    {
                        "type": "status",
                        "payload": get_live_monitoring_status().model_dump(mode="json"),
                    }
                )
            elif message.strip().lower() == "snapshot":
                await websocket.send_json(
                    {
                        "type": "snapshot",
                        "payload": get_live_monitoring_snapshot().model_dump(mode="json"),
                    }
                )
    except WebSocketDisconnect:
        if settings.is_development:
            LIVE_LOGGER.info(
                "event=WEBSOCKET_CONNECTED status=closed user_id=%s client=%s",
                user.id,
                websocket.client.host if websocket.client else "unknown",
            )
        await disconnect_live_monitoring_client(websocket)
    except Exception:
        if settings.is_development:
            LIVE_LOGGER.warning(
                "event=WEBSOCKET_CONNECTED status=interrupted user_id=%s client=%s",
                user.id,
                websocket.client.host if websocket.client else "unknown",
            )
        await disconnect_live_monitoring_client(websocket)
