from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.chat import router as chat_router
from app.api.routes.company_registration import router as company_registration_router
from app.api.routes.cdr_analytics import router as cdr_analytics_router
from app.api.routes.customer_churn import router as customer_churn_router
from app.api.routes.employees import router as employees_router
from app.api.routes.fleet import router as fleet_router
from app.api.routes.fleet_access import router as fleet_access_router
from app.api.routes.health import router as health_router
from app.api.routes.invitations import router as invitations_router
from app.api.routes.live import router as live_router
from app.api.routes.mobile_fleet import router as mobile_fleet_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.phone_lines import router as phone_lines_router
from app.api.routes.plans import router as plans_router
from app.api.routes.reports import router as reports_router
from app.api.routes.roaming import router as roaming_router
from app.api.routes.users import router as users_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router, prefix="/auth")
api_router.include_router(invitations_router, prefix="/invitations")
api_router.include_router(company_registration_router)
api_router.include_router(chat_router, prefix="/chat")
api_router.include_router(live_router)
api_router.include_router(cdr_analytics_router)
api_router.include_router(customer_churn_router)
api_router.include_router(employees_router)
api_router.include_router(fleet_access_router)
api_router.include_router(mobile_fleet_router)
api_router.include_router(fleet_router)
api_router.include_router(notifications_router)
api_router.include_router(roaming_router)
api_router.include_router(reports_router)
api_router.include_router(users_router, prefix="/users")
api_router.include_router(phone_lines_router, prefix="/phone-lines")
api_router.include_router(plans_router, prefix="/plans")
