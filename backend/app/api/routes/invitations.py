from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.core.dependencies import DbSession
from app.core.rate_limit import auth_rate_limit
from app.schemas.invitation import (
    AcceptInvitationRequest,
    AcceptInvitationResponse,
    InvitationValidationResponse,
)
from app.services.invitation_service import accept_user_invitation, validate_user_invitation

router = APIRouter(tags=["invitations"])


def apply_no_store_headers(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.get("/validate", response_model=InvitationValidationResponse)
def validate_invitation_token(
    token: Annotated[str, Query(min_length=16, max_length=2048)],
    response: Response,
    db: DbSession,
) -> InvitationValidationResponse:
    apply_no_store_headers(response)
    return validate_user_invitation(db, token)


@router.post("/accept", response_model=AcceptInvitationResponse)
def accept_invitation(
    payload: AcceptInvitationRequest,
    response: Response,
    db: DbSession,
    _: Annotated[None, Depends(auth_rate_limit)],
) -> AcceptInvitationResponse:
    apply_no_store_headers(response)
    result = accept_user_invitation(db, payload=payload)
    return AcceptInvitationResponse(
        message="Votre compte collaborateur a ete active avec succes.",
        company_name=result.invitation.company.name if result.invitation.company else "",
    )
