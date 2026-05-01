from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.core.dependencies import CurrentActiveUser, CurrentAdminUser, DbSession
from app.schemas.fleet_access import (
    AccessCheckRead,
    ComplianceAlertRead,
    ComplianceAlertResolution,
    DepartmentCreate,
    DepartmentRead,
    DepartmentUpdate,
    FleetAccessAuditLogRead,
    FleetResourceCreate,
    FleetResourceRead,
    FleetResourceUpdate,
    ResourceAssignmentBulkCreate,
    ResourceAssignmentCreate,
    ResourceAssignmentRead,
    ResourceAssignmentRevoke,
    ResourceBlockRequest,
    ResourceComplianceOverview,
    ResourceUsagePolicyRead,
    ResourceUsagePolicyUpsert,
    UsageLogCreate,
    UsageLogRead,
    UserResourcesAssignmentCreate,
)
from app.schemas.user import UserRead
from app.services.fleet_access_service import (
    acknowledge_compliance_alert,
    assign_resource,
    assign_resource_to_users,
    assign_resources_to_user,
    block_resource,
    check_resource_access,
    create_department,
    create_resource,
    delete_department,
    get_resource_compliance_overview,
    list_assignable_users,
    list_assignments,
    list_audit_logs,
    list_compliance_alerts,
    list_departments,
    list_resource_assignments,
    list_usage_logs,
    list_user_resource_assignments,
    list_visible_resources,
    read_resource_usage_policy,
    read_visible_resource,
    record_usage_log,
    resolve_compliance_alert,
    revoke_assignment,
    revoke_resource_assignment,
    suspend_resource_for_compliance,
    unblock_resource,
    update_department,
    update_resource,
    upsert_resource_usage_policy,
)

router = APIRouter(prefix="/fleet-access", tags=["fleet-access"])


@router.get("/departments", response_model=list[DepartmentRead])
def read_departments(
    db: DbSession,
    current_user: CurrentActiveUser,
    include_inactive: Annotated[bool, Query()] = False,
) -> list[DepartmentRead]:
    return list_departments(db, current_user, include_inactive=include_inactive)


@router.post("/departments", response_model=DepartmentRead, status_code=201)
def create_new_department(
    payload: DepartmentCreate,
    db: DbSession,
    _: CurrentAdminUser,
) -> DepartmentRead:
    return create_department(db, payload)


@router.put("/departments/{department_id}", response_model=DepartmentRead)
def update_existing_department(
    department_id: Annotated[int, Path(gt=0)],
    payload: DepartmentUpdate,
    db: DbSession,
    _: CurrentAdminUser,
) -> DepartmentRead:
    return update_department(db, department_id, payload)


@router.delete("/departments/{department_id}", status_code=204)
def delete_existing_department(
    department_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentAdminUser,
) -> None:
    delete_department(db, department_id)


@router.get("/users", response_model=list[UserRead])
def read_assignable_users(
    db: DbSession,
    current_user: CurrentActiveUser,
) -> list[UserRead]:
    return [UserRead.model_validate(user) for user in list_assignable_users(db, current_user)]


@router.get("/resources", response_model=list[FleetResourceRead])
def read_resources(
    db: DbSession,
    current_user: CurrentActiveUser,
) -> list[FleetResourceRead]:
    return list_visible_resources(db, current_user)


@router.post("/resources", response_model=FleetResourceRead, status_code=201)
def create_new_resource(
    payload: FleetResourceCreate,
    db: DbSession,
    current_user: CurrentAdminUser,
) -> FleetResourceRead:
    return create_resource(db, payload, current_user)


@router.get("/resources/{resource_id}", response_model=FleetResourceRead)
def read_resource(
    resource_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
) -> FleetResourceRead:
    return read_visible_resource(db, resource_id, current_user)


@router.put("/resources/{resource_id}", response_model=FleetResourceRead)
def update_existing_resource(
    resource_id: Annotated[int, Path(gt=0)],
    payload: FleetResourceUpdate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> FleetResourceRead:
    return update_resource(db, resource_id, payload, current_user)


@router.post("/resources/{resource_id}/assign", response_model=ResourceAssignmentRead)
def assign_existing_resource(
    resource_id: Annotated[int, Path(gt=0)],
    payload: ResourceAssignmentCreate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> ResourceAssignmentRead:
    return assign_resource(db, resource_id, payload, current_user)


@router.post("/resources/{resource_id}/assign-users", response_model=list[ResourceAssignmentRead])
def assign_resource_to_multiple_users(
    resource_id: Annotated[int, Path(gt=0)],
    payload: ResourceAssignmentBulkCreate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> list[ResourceAssignmentRead]:
    return assign_resource_to_users(db, resource_id, payload, current_user)


@router.post("/resources/{resource_id}/revoke", response_model=ResourceAssignmentRead)
def revoke_existing_resource_assignment(
    resource_id: Annotated[int, Path(gt=0)],
    payload: ResourceAssignmentRevoke,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> ResourceAssignmentRead:
    return revoke_resource_assignment(db, resource_id, payload, current_user)


@router.get("/resources/{resource_id}/assignments", response_model=list[ResourceAssignmentRead])
def read_resource_assignment_users(
    resource_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
    include_history: Annotated[bool, Query()] = False,
) -> list[ResourceAssignmentRead]:
    return list_resource_assignments(
        db,
        resource_id,
        current_user,
        include_history=include_history,
    )


@router.post("/resources/{resource_id}/block", response_model=FleetResourceRead)
def block_existing_resource(
    resource_id: Annotated[int, Path(gt=0)],
    payload: ResourceBlockRequest,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> FleetResourceRead:
    return block_resource(db, resource_id, payload, current_user)


@router.post("/resources/{resource_id}/unblock", response_model=FleetResourceRead)
def unblock_existing_resource(
    resource_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
) -> FleetResourceRead:
    return unblock_resource(db, resource_id, current_user)


@router.get("/resources/{resource_id}/access-check", response_model=AccessCheckRead)
def read_resource_access_check(
    resource_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
) -> AccessCheckRead:
    return check_resource_access(db, resource_id, current_user)


@router.get("/resources/{resource_id}/usage-policy", response_model=ResourceUsagePolicyRead)
def read_resource_policy(
    resource_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
) -> ResourceUsagePolicyRead:
    return read_resource_usage_policy(db, resource_id, current_user)


@router.put("/resources/{resource_id}/usage-policy", response_model=ResourceUsagePolicyRead)
def update_resource_policy(
    resource_id: Annotated[int, Path(gt=0)],
    payload: ResourceUsagePolicyUpsert,
    db: DbSession,
    current_user: CurrentAdminUser,
) -> ResourceUsagePolicyRead:
    return upsert_resource_usage_policy(db, resource_id, payload, current_user)


@router.post("/resources/{resource_id}/usage-logs", response_model=UsageLogRead)
def create_resource_usage_log(
    resource_id: Annotated[int, Path(gt=0)],
    payload: UsageLogCreate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> UsageLogRead:
    return record_usage_log(db, resource_id, payload, current_user)


@router.get("/resources/{resource_id}/compliance", response_model=ResourceComplianceOverview)
def read_resource_compliance(
    resource_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
) -> ResourceComplianceOverview:
    return get_resource_compliance_overview(db, resource_id, current_user)


@router.post("/resources/{resource_id}/compliance-suspend", response_model=FleetResourceRead)
def suspend_resource_for_usage_compliance(
    resource_id: Annotated[int, Path(gt=0)],
    payload: ResourceBlockRequest,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> FleetResourceRead:
    return suspend_resource_for_compliance(db, resource_id, payload, current_user)


@router.get("/assignments", response_model=list[ResourceAssignmentRead])
def read_resource_assignments(
    db: DbSession,
    current_user: CurrentActiveUser,
    include_history: Annotated[bool, Query()] = False,
) -> list[ResourceAssignmentRead]:
    return list_assignments(db, current_user, include_history=include_history)


@router.get("/usage-logs", response_model=list[UsageLogRead])
def read_usage_logs(
    db: DbSession,
    current_user: CurrentActiveUser,
    resource_id: Annotated[int | None, Query(gt=0)] = None,
    user_id: Annotated[int | None, Query(gt=0)] = None,
    is_compliant: Annotated[bool | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[UsageLogRead]:
    return list_usage_logs(
        db,
        current_user,
        resource_id=resource_id,
        user_id=user_id,
        is_compliant=is_compliant,
        limit=limit,
    )


@router.get("/compliance-alerts", response_model=list[ComplianceAlertRead])
def read_compliance_alerts(
    db: DbSession,
    current_user: CurrentActiveUser,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    severity: Annotated[str | None, Query()] = None,
    resource_id: Annotated[int | None, Query(gt=0)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[ComplianceAlertRead]:
    return list_compliance_alerts(
        db,
        current_user,
        status_filter=status_filter,
        severity=severity,
        resource_id=resource_id,
        limit=limit,
    )


@router.post("/compliance-alerts/{alert_id}/acknowledge", response_model=ComplianceAlertRead)
def acknowledge_usage_alert(
    alert_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
) -> ComplianceAlertRead:
    return acknowledge_compliance_alert(db, alert_id, current_user)


@router.post("/compliance-alerts/{alert_id}/resolve", response_model=ComplianceAlertRead)
def resolve_usage_alert(
    alert_id: Annotated[int, Path(gt=0)],
    payload: ComplianceAlertResolution,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> ComplianceAlertRead:
    return resolve_compliance_alert(db, alert_id, payload, current_user)


@router.post("/assignments/{assignment_id}/revoke", response_model=ResourceAssignmentRead)
def revoke_specific_assignment(
    assignment_id: Annotated[int, Path(gt=0)],
    payload: ResourceAssignmentRevoke,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> ResourceAssignmentRead:
    return revoke_assignment(db, assignment_id, payload, current_user)


@router.get("/users/{user_id}/resources", response_model=list[ResourceAssignmentRead])
def read_user_resource_assignments(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentActiveUser,
    include_history: Annotated[bool, Query()] = False,
) -> list[ResourceAssignmentRead]:
    return list_user_resource_assignments(
        db,
        user_id,
        current_user,
        include_history=include_history,
    )


@router.post("/users/{user_id}/assign-resources", response_model=list[ResourceAssignmentRead])
def assign_multiple_resources_to_user(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserResourcesAssignmentCreate,
    db: DbSession,
    current_user: CurrentActiveUser,
) -> list[ResourceAssignmentRead]:
    return assign_resources_to_user(db, user_id, payload, current_user)


@router.get("/audit-logs", response_model=list[FleetAccessAuditLogRead])
def read_fleet_access_audit_logs(
    db: DbSession,
    current_user: CurrentActiveUser,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[FleetAccessAuditLogRead]:
    return list_audit_logs(db, current_user, limit=limit)
