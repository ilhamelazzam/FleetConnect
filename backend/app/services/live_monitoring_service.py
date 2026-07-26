from __future__ import annotations

import asyncio
import hashlib
import math
import random
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket

from app.db.session import SessionLocal
from app.schemas.live import (
    LiveAlertResponse,
    LiveChartPoint,
    LiveDepartmentResponse,
    LiveEquipmentResponse,
    LiveMonitoringSnapshotResponse,
    LiveMonitoringStatusResponse,
    LiveOperatorResponse,
    LiveSeverity,
    LiveWorkflowResponse,
)
from app.services.chat_service import DataSummary, SummaryMetric, get_data_summary

LIVE_MONITORING_TICK_SECONDS = 5
LIVE_MONITORING_HISTORY_LIMIT = 18


@dataclass(frozen=True)
class _LiveHistoryPoint:
    timestamp: str
    cost_mad: float
    risk_score: int
    alert_volume: int
    suspicious_calls: int


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _to_iso(value: datetime) -> str:
    return value.isoformat()


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def _clamp_score(value: float) -> int:
    return int(round(_clamp(value, 0, 100)))


def _severity_rank(value: LiveSeverity) -> int:
    if value == "critical":
        return 4
    if value == "high":
        return 3
    if value == "medium":
        return 2
    return 1


def _score_to_severity(value: float) -> LiveSeverity:
    if value >= 82:
        return "critical"
    if value >= 66:
        return "high"
    if value >= 45:
        return "medium"
    return "low"


def _ensure_default_summary() -> DataSummary:
    return DataSummary(
        prompt_context="Simulation live par defaut.",
        sources=["simulation:default"],
        updated_at=_to_iso(_utcnow()),
        signature="simulation-default",
        total_lines=420,
        active_lines=356,
        free_lines=28,
        assigned_lines=298,
        in_progress_lines=18,
        suspended_lines=10,
        inactive_lines=36,
        total_monthly_cost_mad=286000.0,
        projected_monthly_cost_mad=315000.0,
        alert_count=34,
        critical_alert_count=11,
        budget_alert_count=14,
        mobile_alert_count=9,
        mobile_device_total=126,
        mobile_critical_count=17,
        fraud_alert_count=7,
        total_call_count=980,
        suspicious_call_count=74,
        suspicious_call_cost_mad=32600.0,
        high_cost_call_count=39,
        over_quota_count=12,
        anomaly_count=8,
        roaming_line_count=34,
        roaming_alert_count=11,
        expensive_operators=[
            SummaryMetric(label="Maroc Telecom", monthly_cost_mad=128000.0, risk_score=74.0, alert_count=11),
            SummaryMetric(label="Orange", monthly_cost_mad=91000.0, risk_score=62.0, alert_count=8),
            SummaryMetric(label="Inwi", monthly_cost_mad=67000.0, risk_score=58.0, alert_count=6),
        ],
        risky_departments=[
            SummaryMetric(label="IT", monthly_cost_mad=98000.0, risk_score=79.0, alert_count=9),
            SummaryMetric(label="Finance", monthly_cost_mad=69000.0, risk_score=67.0, alert_count=6),
            SummaryMetric(label="Support", monthly_cost_mad=54000.0, risk_score=61.0, alert_count=5),
        ],
        expensive_plans=[],
        critical_lines=[],
        recommendations=[
            "Optimiser les forfaits roaming des profils internationaux.",
            "Surveiller les appels suspects et renforcer les seuils de fraude.",
            "Traiter les equipements vieillissants sur les sites IT prioritaires.",
        ],
        roaming_geo_highlights=[],
    )


def _load_baseline_summary() -> DataSummary:
    db = SessionLocal()
    try:
        return get_data_summary(db)
    except Exception:
        return _ensure_default_summary()
    finally:
        db.close()


def _format_time_label(value: str) -> str:
    try:
        return datetime.fromisoformat(value).astimezone(UTC).strftime("%H:%M:%S")
    except ValueError:
        return value[-8:]


class LiveMonitoringManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._connections: set[WebSocket] = set()
        self._snapshot: LiveMonitoringSnapshotResponse | None = None
        self._history: deque[_LiveHistoryPoint] = deque(maxlen=LIVE_MONITORING_HISTORY_LIMIT)
        self._recent_alerts: deque[LiveAlertResponse] = deque(maxlen=18)
        self._active_alert_ids: set[str] = set()
        self._last_summary_signature: str | None = None
        self._last_summary_refresh_tick = -1
        self._baseline_summary = _ensure_default_summary()
        self._tick = 0

    async def ensure_started(self) -> None:
        async with self._lock:
            if self._snapshot is None:
                self._baseline_summary = await asyncio.to_thread(_load_baseline_summary)
                self._last_summary_signature = self._baseline_summary.signature
                self._snapshot = self._build_snapshot()
            if self._task is None or self._task.done():
                self._task = asyncio.create_task(self._run(), name="live-monitoring-loop")

    def get_status(self) -> LiveMonitoringStatusResponse:
        if self._snapshot is None:
            snapshot = self._build_snapshot()
            self._snapshot = snapshot
        else:
            snapshot = self._snapshot

        return LiveMonitoringStatusResponse(
            monitoring_label=snapshot.monitoring_label,
            connected_clients=len(self._connections),
            latest_tick=snapshot.tick,
            latest_tick_at=snapshot.generated_at,
        )

    def get_snapshot(self) -> LiveMonitoringSnapshotResponse:
        if self._snapshot is None:
            self._snapshot = self._build_snapshot()
        return self._snapshot

    def build_prompt_context(self) -> str | None:
        snapshot = self._snapshot
        if snapshot is None:
            return None

        lines = [
            "Surveillance live active:",
            snapshot.executive_summary,
            (
                f"- Scores live: flotte {snapshot.fleet_health_score}/100, risque {snapshot.risk_score}/100, "
                f"fraude {snapshot.fraud_score}/100, optimisation {snapshot.optimization_score}/100, "
                f"equipements {snapshot.equipment_score}/100."
            ),
            (
                f"- Cout live {round(snapshot.live_cost_mad):,} MAD, variation {snapshot.live_cost_delta_pct:+.1f}%, "
                f"roaming {round(snapshot.roaming_cost_mad):,} MAD, appels suspects {snapshot.suspicious_calls}."
            ).replace(",", " "),
        ]
        if snapshot.priority_alerts:
            lines.append("Alertes live prioritaires:")
            lines.extend(
                f"{index}. {alert.title} - {alert.message}"
                for index, alert in enumerate(snapshot.priority_alerts[:3], start=1)
            )
        if snapshot.recommendations:
            lines.append("Recommandations live:")
            lines.extend(
                f"{index}. {recommendation}"
                for index, recommendation in enumerate(snapshot.recommendations[:3], start=1)
            )
        return "\n".join(lines)

    async def connect(self, websocket: WebSocket) -> None:
        await self.ensure_started()
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

        await websocket.send_json(
            {
                "type": "status",
                "payload": self.get_status().model_dump(mode="json"),
            }
        )
        await websocket.send_json(
            {
                "type": "snapshot",
                "payload": self.get_snapshot().model_dump(mode="json"),
            }
        )

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(LIVE_MONITORING_TICK_SECONDS)

            async with self._lock:
                self._tick += 1
                if self._tick - self._last_summary_refresh_tick >= 12:
                    refreshed_summary = await asyncio.to_thread(_load_baseline_summary)
                    self._baseline_summary = refreshed_summary
                    self._last_summary_signature = refreshed_summary.signature
                    self._last_summary_refresh_tick = self._tick

                self._snapshot = self._build_snapshot()
                payload = self._snapshot.model_dump(mode="json")
                new_alerts = [
                    alert.model_dump(mode="json")
                    for alert in self._snapshot.priority_alerts
                    if alert.alert_id not in self._active_alert_ids
                ]
                self._active_alert_ids = {
                    alert.alert_id for alert in self._snapshot.priority_alerts
                }
                recipients = list(self._connections)

            if recipients:
                await self._broadcast(
                    recipients,
                    {"type": "status", "payload": self.get_status().model_dump(mode="json")},
                )
                await self._broadcast(recipients, {"type": "snapshot", "payload": payload})
                if new_alerts:
                    await self._broadcast(recipients, {"type": "alerts", "payload": new_alerts})

    async def _broadcast(self, recipients: list[WebSocket], payload: dict[str, Any]) -> None:
        stale_sockets: list[WebSocket] = []
        for websocket in recipients:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale_sockets.append(websocket)

        if stale_sockets:
            async with self._lock:
                for websocket in stale_sockets:
                    self._connections.discard(websocket)

    def _build_snapshot(self) -> LiveMonitoringSnapshotResponse:
        summary = self._baseline_summary
        tick = self._tick
        signature_seed = int(
            hashlib.sha1(f"{summary.signature}:{tick}".encode("utf-8")).hexdigest()[:8],
            16,
        )
        seeded_random = random.Random(signature_seed)

        def wave(phase: float, amplitude: float, period: float) -> float:
            return math.sin((tick + phase) / period) * amplitude + math.cos((tick + phase) / (period * 1.7)) * amplitude * 0.42

        top_departments = summary.risky_departments[:4] or _ensure_default_summary().risky_departments
        top_operators = summary.expensive_operators[:3] or _ensure_default_summary().expensive_operators

        live_cost_delta_pct = round(_clamp(7.5 + wave(0.8, 9.5, 2.5) + seeded_random.uniform(-2.4, 2.8), -8.0, 38.0), 1)
        data_delta_pct = round(_clamp(10.0 + wave(1.8, 13.0, 2.3) + seeded_random.uniform(-3.0, 3.2), -4.5, 44.0), 1)
        suspicious_calls = max(
            12,
            int(
                round(
                    max(summary.fraud_alert_count * 16, 48)
                    + wave(2.6, 24.0, 2.1)
                    + seeded_random.uniform(-8.0, 12.0)
                )
            ),
        )
        overage_lines = max(
            2,
            int(
                round(
                    max(summary.over_quota_count, 4)
                    + wave(4.1, 6.0, 2.9)
                    + seeded_random.uniform(-1.8, 2.6)
                )
            ),
        )
        equipment_alerts = max(
            1,
            int(
                round(
                    max(summary.mobile_alert_count, 3)
                    + wave(5.0, 4.8, 3.4)
                    + seeded_random.uniform(-1.5, 1.8)
                )
            ),
        )
        workflow_critical_count = max(
            1,
            int(round(2 + wave(6.4, 1.8, 3.6) + seeded_random.uniform(-0.6, 1.2))),
        )

        live_cost_mad = round(
            max(60_000.0, summary.total_monthly_cost_mad * (1 + (live_cost_delta_pct / 100))),
            2,
        )
        data_consumption_tb = round(
            max(
                0.9,
                (summary.total_lines * 0.022) * (1 + max(data_delta_pct, -6) / 100),
            ),
            2,
        )
        roaming_cost_mad = round(
            max(
                8_000.0,
                (summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad) * 0.42
                + suspicious_calls * 88
                + seeded_random.uniform(-1400.0, 2200.0),
            ),
            2,
        )
        fraud_exposure_mad = round(
            max(5_000.0, suspicious_calls * 122.0 + seeded_random.uniform(-2200.0, 2800.0)),
            2,
        )
        operator_anomaly_count = max(1, min(len(top_operators) + 1, 4))

        risk_score = _clamp_score(
            42
            + max(live_cost_delta_pct, 0) * 0.95
            + max(data_delta_pct, 0) * 0.55
            + overage_lines * 1.3
            + workflow_critical_count * 4.5
        )
        fraud_score = _clamp_score(
            38 + suspicious_calls * 0.18 + (fraud_exposure_mad / 12_000) + wave(1.2, 5.0, 3.1)
        )
        optimization_score = _clamp_score(
            88 - max(live_cost_delta_pct, 0) * 0.72 - overage_lines * 1.1 + wave(3.8, 5.5, 3.5)
        )
        equipment_score = _clamp_score(
            84 - equipment_alerts * 6.3 - workflow_critical_count * 1.8 + wave(4.9, 4.2, 3.2)
        )
        fleet_health_score = _clamp_score(
            98
            - risk_score * 0.34
            - fraud_score * 0.22
            - max(live_cost_delta_pct, 0) * 0.45
            + optimization_score * 0.12
            + equipment_score * 0.14
        )

        departments = self._build_department_items(top_departments, seeded_random, live_cost_delta_pct)
        operators = self._build_operator_items(top_operators, seeded_random, roaming_cost_mad, suspicious_calls)
        equipments = self._build_equipment_items(departments, tick, seeded_random)
        workflows = self._build_workflow_items(departments, tick, workflow_critical_count, seeded_random)
        current_alerts = self._build_alerts(
            departments=departments,
            operators=operators,
            equipments=equipments,
            suspicious_calls=suspicious_calls,
            live_cost_delta_pct=live_cost_delta_pct,
            roaming_cost_mad=roaming_cost_mad,
            fraud_exposure_mad=fraud_exposure_mad,
            overage_lines=overage_lines,
            generated_at=_to_iso(_utcnow()),
        )

        for alert in current_alerts:
            if alert.alert_id not in {existing.alert_id for existing in self._recent_alerts}:
                self._recent_alerts.appendleft(alert)

        executive_summary = self._build_executive_summary(
            departments=departments,
            operators=operators,
            current_alerts=current_alerts,
            live_cost_delta_pct=live_cost_delta_pct,
            suspicious_calls=suspicious_calls,
        )
        recommendations = self._build_recommendations(
            departments=departments,
            operators=operators,
            equipments=equipments,
            current_alerts=current_alerts,
        )

        generated_at = _to_iso(_utcnow())
        self._history.append(
            _LiveHistoryPoint(
                timestamp=generated_at,
                cost_mad=live_cost_mad,
                risk_score=risk_score,
                alert_volume=len(current_alerts),
                suspicious_calls=suspicious_calls,
            )
        )

        return LiveMonitoringSnapshotResponse(
            generated_at=generated_at,
            tick=tick,
            monitoring_label=(
                "Surveillance IA active..."
                if current_alerts
                else "Surveillance IA stabilisee..."
            ),
            executive_summary=executive_summary,
            fleet_health_score=fleet_health_score,
            risk_score=risk_score,
            fraud_score=fraud_score,
            optimization_score=optimization_score,
            equipment_score=equipment_score,
            live_cost_mad=live_cost_mad,
            live_cost_delta_pct=live_cost_delta_pct,
            data_consumption_tb=data_consumption_tb,
            data_delta_pct=data_delta_pct,
            roaming_cost_mad=roaming_cost_mad,
            suspicious_calls=suspicious_calls,
            fraud_exposure_mad=fraud_exposure_mad,
            overage_lines=overage_lines,
            inactive_lines=max(summary.inactive_lines, 0),
            equipment_alerts=equipment_alerts,
            workflow_critical_count=workflow_critical_count,
            operator_anomaly_count=operator_anomaly_count,
            source_status=[
                "Simulation enterprise active",
                f"Sources consolidees: {', '.join(summary.sources[:3]) if summary.sources else 'resume local'}",
                "WebSocket disponible pour dashboards live",
                "Ollama local compatible pour les questions contextuelles",
            ],
            recommendations=recommendations,
            priority_alerts=current_alerts[:4],
            recent_alerts=list(self._recent_alerts)[:6],
            top_departments=departments,
            top_operators=operators,
            critical_equipments=equipments,
            critical_workflows=workflows,
            cost_series=self._build_cost_series(),
            risk_series=self._build_risk_series(),
            alerts_series=self._build_alert_series(),
            operator_heatmap=self._build_operator_heatmap(operators),
        )

    def _build_department_items(
        self,
        metrics: list[SummaryMetric],
        seeded_random: random.Random,
        global_delta_pct: float,
    ) -> list[LiveDepartmentResponse]:
        departments: list[LiveDepartmentResponse] = []
        for index, metric in enumerate(metrics[:4], start=1):
            delta_pct = round(
                _clamp(global_delta_pct * (0.65 + index * 0.11) + seeded_random.uniform(-3.5, 5.5), -6.0, 39.0),
                1,
            )
            live_cost = round(metric.monthly_cost_mad * (1 + delta_pct / 100), 2)
            roaming_pct = round(_clamp(8 + index * 6 + seeded_random.uniform(-2.0, 5.5), 3.0, 42.0), 1)
            departments.append(
                LiveDepartmentResponse(
                    department=metric.label,
                    risk_score=_clamp_score(metric.risk_score + delta_pct * 0.9 + index * 2.8),
                    live_cost_mad=live_cost,
                    delta_pct=delta_pct,
                    alert_count=max(1, metric.alert_count + index),
                    roaming_pct=roaming_pct,
                )
            )
        return departments

    def _build_operator_items(
        self,
        metrics: list[SummaryMetric],
        seeded_random: random.Random,
        roaming_cost_mad: float,
        suspicious_calls: int,
    ) -> list[LiveOperatorResponse]:
        operators: list[LiveOperatorResponse] = []
        for index, metric in enumerate(metrics[:3], start=1):
            delta_pct = round(_clamp(6 + index * 3.8 + seeded_random.uniform(-2.2, 6.2), -2.0, 26.0), 1)
            live_cost = round(metric.monthly_cost_mad * (1 + delta_pct / 100), 2)
            operators.append(
                LiveOperatorResponse(
                    operator=metric.label,
                    live_cost_mad=live_cost,
                    anomaly_score=_clamp_score(metric.risk_score + delta_pct * 1.4 + index * 4.2),
                    roaming_cost_mad=round(roaming_cost_mad * (0.25 + index * 0.14), 2),
                    suspicious_calls=max(8, int(round(suspicious_calls * (0.26 + index * 0.12)))),
                    delta_pct=delta_pct,
                )
            )
        return operators

    def _build_equipment_items(
        self,
        departments: list[LiveDepartmentResponse],
        tick: int,
        seeded_random: random.Random,
    ) -> list[LiveEquipmentResponse]:
        equipment_types = ["Routeur coeur", "Switch distribution", "Gateway VPN"]
        items: list[LiveEquipmentResponse] = []
        for index, department in enumerate(departments[:3]):
            health_score = _clamp_score(82 - department.risk_score * 0.42 + seeded_random.uniform(-4.0, 4.0))
            temperature = round(51 + department.risk_score * 0.24 + math.sin((tick + index) / 1.7) * 6.5, 1)
            severity = _score_to_severity(100 - health_score + (temperature - 48))
            items.append(
                LiveEquipmentResponse(
                    label=f"{equipment_types[index % len(equipment_types)]} {department.department}",
                    site=f"Site {department.department}",
                    health_score=health_score,
                    temperature_c=temperature,
                    severity=severity,
                    issue=(
                        "Temperature anormale detectee"
                        if temperature >= 72
                        else "Usure preventive a surveiller"
                    ),
                )
            )
        return items

    def _build_workflow_items(
        self,
        departments: list[LiveDepartmentResponse],
        tick: int,
        workflow_critical_count: int,
        seeded_random: random.Random,
    ) -> list[LiveWorkflowResponse]:
        names = [
            "Validation roaming international",
            "Attribution SIM corporate",
            "Escalade incidents operateur",
        ]
        bottlenecks = [
            "Validation manager",
            "Double verification budget",
            "Escalade support N2",
        ]
        workflows: list[LiveWorkflowResponse] = []
        for index, department in enumerate(departments[:3]):
            workflows.append(
                LiveWorkflowResponse(
                    name=f"{names[index % len(names)]} - {department.department}",
                    criticality_score=_clamp_score(
                        48 + department.risk_score * 0.48 + workflow_critical_count * 4 + seeded_random.uniform(-5.0, 4.0)
                    ),
                    waiting_steps=max(1, int(round(2 + index + math.sin((tick + index) / 2.2) * 2 + workflow_critical_count / 2))),
                    bottleneck=bottlenecks[index % len(bottlenecks)],
                )
            )
        return workflows

    def _build_alerts(
        self,
        *,
        departments: list[LiveDepartmentResponse],
        operators: list[LiveOperatorResponse],
        equipments: list[LiveEquipmentResponse],
        suspicious_calls: int,
        live_cost_delta_pct: float,
        roaming_cost_mad: float,
        fraud_exposure_mad: float,
        overage_lines: int,
        generated_at: str,
    ) -> list[LiveAlertResponse]:
        alerts: list[LiveAlertResponse] = []
        if departments:
            lead_department = max(departments, key=lambda item: item.delta_pct)
            alerts.append(
                LiveAlertResponse(
                    alert_id=f"dept-spike:{lead_department.department}",
                    title="Pic consommation detecte",
                    severity=_score_to_severity(lead_department.risk_score + lead_department.delta_pct),
                    category="consumption",
                    message=(
                        f"Departement {lead_department.department} : {lead_department.delta_pct:+.1f}% "
                        f"et {lead_department.alert_count} alertes actives."
                    ),
                    recommendation="Verifier les lignes roaming et les forfaits surdimensionnes du departement.",
                    detected_at=generated_at,
                    score=_clamp_score(lead_department.risk_score + lead_department.delta_pct),
                    department=lead_department.department,
                    delta_pct=lead_department.delta_pct,
                    estimated_cost_mad=lead_department.live_cost_mad,
                )
            )

        alerts.append(
            LiveAlertResponse(
                alert_id="fraud-suspicious-calls",
                title="Fraude potentielle",
                severity=_score_to_severity(48 + suspicious_calls * 0.28),
                category="fraud",
                message=f"{suspicious_calls} appels suspects detectes en fenetre courte.",
                recommendation="Lancer une revue CDR prioritaire et isoler les profils internationaux a risque.",
                detected_at=generated_at,
                score=_clamp_score(42 + suspicious_calls * 0.22),
                estimated_cost_mad=fraud_exposure_mad,
            )
        )

        if operators:
            expensive_operator = max(operators, key=lambda item: item.roaming_cost_mad)
            alerts.append(
                LiveAlertResponse(
                    alert_id=f"operator-roaming:{expensive_operator.operator}",
                    title="Cout roaming anormal",
                    severity=_score_to_severity(expensive_operator.anomaly_score),
                    category="roaming",
                    message=(
                        f"{expensive_operator.operator} : {expensive_operator.delta_pct:+.1f}% "
                        f"sur le roaming live et {expensive_operator.suspicious_calls} appels sensibles."
                    ),
                    recommendation="Controler les lignes internationales et ajuster les plafonds roaming.",
                    detected_at=generated_at,
                    score=expensive_operator.anomaly_score,
                    operator=expensive_operator.operator,
                    delta_pct=expensive_operator.delta_pct,
                    estimated_cost_mad=expensive_operator.roaming_cost_mad,
                )
            )

        if equipments:
            critical_equipment = max(equipments, key=lambda item: (item.temperature_c, 100 - item.health_score))
            alerts.append(
                LiveAlertResponse(
                    alert_id=f"equipment-critical:{critical_equipment.label}",
                    title="Equipement critique",
                    severity=critical_equipment.severity,
                    category="equipment",
                    message=(
                        f"{critical_equipment.label} : {critical_equipment.issue.lower()} "
                        f"({critical_equipment.temperature_c:.1f}°C)."
                    ),
                    recommendation="Planifier une intervention preventive et verifier la ventilation du site.",
                    detected_at=generated_at,
                    score=_clamp_score(100 - critical_equipment.health_score + critical_equipment.temperature_c),
                    equipment_label=critical_equipment.label,
                )
            )

        if live_cost_delta_pct >= 14 or overage_lines >= 6:
            alerts.append(
                LiveAlertResponse(
                    alert_id="quota-overage-live",
                    title="Depassements live a surveiller",
                    severity=_score_to_severity(live_cost_delta_pct * 2 + overage_lines * 6),
                    category="quota",
                    message=f"{overage_lines} lignes depassent leurs seuils, cout live {live_cost_delta_pct:+.1f}%.",
                    recommendation="Reduire les forfaits sous-utilises et renforcer les alertes de consommation.",
                    detected_at=generated_at,
                    score=_clamp_score(46 + live_cost_delta_pct * 1.8 + overage_lines * 3.2),
                    delta_pct=live_cost_delta_pct,
                    estimated_cost_mad=roaming_cost_mad,
                )
            )

        alerts.sort(
            key=lambda item: (_severity_rank(item.severity), item.score, item.estimated_cost_mad or 0.0),
            reverse=True,
        )
        return alerts

    def _build_executive_summary(
        self,
        *,
        departments: list[LiveDepartmentResponse],
        operators: list[LiveOperatorResponse],
        current_alerts: list[LiveAlertResponse],
        live_cost_delta_pct: float,
        suspicious_calls: int,
    ) -> str:
        lead_department = departments[0].department if departments else "IT"
        lead_operator = operators[0].operator if operators else "Maroc Telecom"
        top_alert = current_alerts[0].title if current_alerts else "aucune alerte critique"
        return (
            f"La surveillance live montre une pression {live_cost_delta_pct:+.1f}% sur les couts, "
            f"un departement {lead_department} expose, {suspicious_calls} appels suspects et "
            f"{lead_operator} sous tension roaming. Alerte dominante: {top_alert.lower()}."
        )

    def _build_recommendations(
        self,
        *,
        departments: list[LiveDepartmentResponse],
        operators: list[LiveOperatorResponse],
        equipments: list[LiveEquipmentResponse],
        current_alerts: list[LiveAlertResponse],
    ) -> list[str]:
        recommendations: list[str] = []
        if departments:
            recommendations.append(
                f"Surveiller {departments[0].department} et plafonner les usages roaming a court terme."
            )
        if operators:
            recommendations.append(
                f"Verifier les alertes live sur {operators[0].operator} et renegocier les lignes les plus couteuses."
            )
        if equipments:
            recommendations.append(
                f"Traiter {equipments[0].label} avant escalation thermique."
            )
        if current_alerts:
            recommendations.append(
                f"Prioriser l'alerte '{current_alerts[0].title}' et documenter l'action dans le cockpit DSI."
            )
        return recommendations[:4]

    def _build_cost_series(self) -> list[LiveChartPoint]:
        return [
            LiveChartPoint(
                label=_format_time_label(point.timestamp),
                value=round(point.cost_mad, 2),
                secondary_value=float(point.suspicious_calls),
            )
            for point in self._history
        ]

    def _build_risk_series(self) -> list[LiveChartPoint]:
        return [
            LiveChartPoint(
                label=_format_time_label(point.timestamp),
                value=float(point.risk_score),
                secondary_value=float(point.alert_volume),
            )
            for point in self._history
        ]

    def _build_alert_series(self) -> list[LiveChartPoint]:
        return [
            LiveChartPoint(
                label=_format_time_label(point.timestamp),
                value=float(point.alert_volume),
                secondary_value=float(point.suspicious_calls),
            )
            for point in self._history
        ]

    def _build_operator_heatmap(self, operators: list[LiveOperatorResponse]) -> list[LiveChartPoint]:
        return [
            LiveChartPoint(
                label=operator.operator,
                value=operator.live_cost_mad,
                secondary_value=float(operator.anomaly_score),
            )
            for operator in operators
        ]


_LIVE_MONITORING_MANAGER = LiveMonitoringManager()


async def ensure_live_monitoring_started() -> None:
    await _LIVE_MONITORING_MANAGER.ensure_started()


def get_live_monitoring_status() -> LiveMonitoringStatusResponse:
    return _LIVE_MONITORING_MANAGER.get_status()


def get_live_monitoring_snapshot() -> LiveMonitoringSnapshotResponse:
    return _LIVE_MONITORING_MANAGER.get_snapshot()


def get_live_monitoring_snapshot_if_ready() -> LiveMonitoringSnapshotResponse | None:
    snapshot = getattr(_LIVE_MONITORING_MANAGER, "_snapshot", None)
    if snapshot is None:
        return None
    return snapshot


def build_live_monitoring_prompt_context() -> str | None:
    return _LIVE_MONITORING_MANAGER.build_prompt_context()


async def connect_live_monitoring_client(websocket: WebSocket) -> None:
    await _LIVE_MONITORING_MANAGER.connect(websocket)


async def disconnect_live_monitoring_client(websocket: WebSocket) -> None:
    await _LIVE_MONITORING_MANAGER.disconnect(websocket)
