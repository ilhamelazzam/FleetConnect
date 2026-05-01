from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserRead, UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    photo_url: str | None = Field(default=None, max_length=1_000_000)
    role: UserRole = "user"


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=2048)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_token: str
    expires_in_seconds: int


class VerifyResetCodeRequest(BaseModel):
    reset_token: str = Field(min_length=32, max_length=2048)
    code: str = Field(pattern=r"^\d{6}$")


class MessageResponse(BaseModel):
    message: str


class ResetPasswordRequest(VerifyResetCodeRequest):
    new_password: str = Field(min_length=8, max_length=128)


class OAuthProviderStatus(BaseModel):
    configured: bool


class OAuthProvidersResponse(BaseModel):
    google: OAuthProviderStatus
    microsoft: OAuthProviderStatus


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    access_token_expires_in: int
    refresh_token_expires_in: int
    user: UserRead
