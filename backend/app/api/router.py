from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.phone_lines import router as phone_lines_router
from app.api.routes.plans import router as plans_router
from app.api.routes.users import router as users_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router, prefix="/auth")
api_router.include_router(users_router, prefix="/users")
api_router.include_router(phone_lines_router, prefix="/phone-lines")
api_router.include_router(plans_router, prefix="/plans")
