from typing import Annotated

from fastapi import Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_security_logger
from app.db.session import get_db_session
from app.models.user import User
from app.services.auth_service import get_current_active_user, get_current_user, require_admin
from app.services.user_service import get_user_by_id

security_logger = get_security_logger()
settings = get_settings()

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentActiveUser = Annotated[User, Depends(get_current_active_user)]
CurrentAdminUser = Annotated[User, Depends(require_admin)]


DEFAULT_PAGE_SIZE = settings.default_page_size
PaginationOffset = Annotated[int, Query(ge=0)]
PaginationLimit = Annotated[int, Query(ge=1, le=settings.max_page_size)]


def get_accessible_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
) -> User:
    target_user = get_user_by_id(db, user_id)
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if current_user.id != target_user.id and current_user.role != "admin":
        security_logger.warning(
            "event=object_access_denied user_id=%s target_user_id=%s",
            current_user.id,
            target_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to access this resource",
        )

    return target_user
