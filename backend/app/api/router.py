from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.cdr_analytics import router as cdr_analytics_router
from app.api.routes.customer_churn import router as customer_churn_router
from app.api.routes.employees import router as employees_router
from app.api.routes.fleet_access import router as fleet_access_router
from app.api.routes.health import router as health_router
from app.api.routes.mobile_fleet import router as mobile_fleet_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.phone_lines import router as phone_lines_router
from app.api.routes.plans import router as plans_router
from app.api.routes.users import router as users_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router, prefix="/auth")
api_router.include_router(cdr_analytics_router)
api_router.include_router(customer_churn_router)
api_router.include_router(employees_router)
api_router.include_router(fleet_access_router)
api_router.include_router(mobile_fleet_router)
api_router.include_router(notifications_router)
api_router.include_router(users_router, prefix="/users")
api_router.include_router(phone_lines_router, prefix="/phone-lines")
api_router.include_router(plans_router, prefix="/plans")
