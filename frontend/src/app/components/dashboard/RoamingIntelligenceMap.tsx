import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import {
  Activity,
  AlertTriangle,
  Brain,
  Clock3,
  Eye,
  EyeOff,
  Globe2,
  Loader2,
  MapPinned,
  Maximize2,
  Radar,
  RefreshCw,
  Route,
  ShieldAlert,
  Sparkles,
  TowerControl,
  X,
} from "lucide-react";
import L from "leaflet";
import { Fragment, memo, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MarkerClusterGroup from "react-leaflet-cluster";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from "react-leaflet";

import {
  roamingApi,
  type ApiRoamingCriticalZone,
  type ApiRoamingIntelligenceDevice,
  type ApiRoamingIntelligenceFlow,
  type ApiRoamingIntelligenceResponse,
  type ApiRoamingIntelligenceTimelinePoint,
  type ApiRoamingIntelligenceZone,
} from "../../lib/api";
import { formatCallZoneLabel, formatCdrDateTime, formatMadValue, formatRiskScore } from "../../lib/cdr-analytics";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

const leafletGlobal = globalThis as typeof globalThis & { L?: typeof L };

function exposeLeafletGlobal() {
  if (leafletGlobal.L !== L) {
    leafletGlobal.L = L;
  }
}

let leafletHeatPluginPromise: Promise<void> | null = null;

function ensureLeafletHeatPlugin(): Promise<void> {
  exposeLeafletGlobal();
  leafletHeatPluginPromise ??= import("leaflet.heat").then(() => undefined);
  return leafletHeatPluginPromise;
}

const MOROCCO_CENTER: [number, number] = [31.7917, -7.0926];
const DEFAULT_CENTER: [number, number] = MOROCCO_CENTER;
const DEFAULT_ZOOM = 5;
const DEFAULT_REFRESH_INTERVAL_SECONDS = 12;
const MOROCCO_BOUNDS: [[number, number], [number, number]] = [
  [27.4, -13.5],
  [35.95, -0.9],
];
const INLINE_POPUP_MAX_HEIGHT = 420;
const FULLSCREEN_POPUP_MAX_HEIGHT = 560;
const INLINE_POPUP_AUTO_PAN_PADDING_TOP_LEFT: [number, number] = [24, 24];
const FULLSCREEN_POPUP_AUTO_PAN_PADDING_TOP_LEFT: [number, number] = [24, 88];
const POPUP_AUTO_PAN_PADDING_BOTTOM_RIGHT: [number, number] = [24, 24];
const ROAMING_DETAIL_PANEL_STYLE = {
  position: "fixed",
  right: "24px",
  top: "100px",
  width: "420px",
  height: "80vh",
  overflowY: "auto",
  overflowX: "hidden",
  zIndex: 9999,
  overscrollBehavior: "contain",
  touchAction: "pan-y",
} as const;

type FilterState = {
  country: string;
  operator: string;
  department: string;
  riskLevel: string;
  anomalyType: string;
  minCostMad: string;
  periodFrom: string;
  periodTo: string;
  fraudOnly: "all" | "true" | "false";
};

type RoamingPanelTab = "summary" | "timeline" | "zones" | "sources";

export interface RoamingIntelligenceMapSummary {
  criticalZoneCount: number;
  criticalAlertCount: number;
  totalImpactMad: number;
  topZoneImpactMad: number;
  topZoneLabel: string | null;
  topZoneRecommendation: string | null;
}

interface RoamingIntelligenceMapProps {
  token: string | null;
  onSummaryChange?: (summary: RoamingIntelligenceMapSummary | null) => void;
}

interface RoamingMapCanvasProps {
  devices: ApiRoamingIntelligenceDevice[];
  heatmap: ApiRoamingIntelligenceZone[];
  clusters: ApiRoamingIntelligenceZone[];
  criticalZones: RenderableCriticalZone[];
  movementFlows: RenderableMovementFlow[];
  isLoading: boolean;
  pulseTick: boolean;
  showHeatmap: boolean;
  showFlows: boolean;
  showClusters: boolean;
  heightClassName: string;
  interactive?: boolean;
  onOpenFullscreen?: () => void;
  variant?: "inline" | "fullscreen";
  resizeSignal?: number;
  savedViewport?: MapViewState | null;
  onViewportChange?: (viewport: MapViewState) => void;
  onSelectDevice?: (device: ApiRoamingIntelligenceDevice) => void;
}

interface RenderableCriticalZone extends ApiRoamingCriticalZone {
  latitude: number;
  longitude: number;
  intensity: number;
}

interface RenderableMovementFlow extends ApiRoamingIntelligenceFlow {
  synthetic?: boolean;
  explanation?: string;
}

interface MapViewState {
  center: [number, number];
  zoom: number;
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}

function getRiskColor(riskLevel: ApiRoamingIntelligenceDevice["risk_level"]): string {
  if (riskLevel === "critical") return "#DC2626";
  if (riskLevel === "high") return "#F97316";
  if (riskLevel === "medium") return "#F59E0B";
  return "#16A34A";
}

function getDevicePointColor(device: ApiRoamingIntelligenceDevice): string {
  if (device.fraud_flag || device.alerts > 0) {
    return "#DC2626";
  }
  return getRiskColor(device.risk_level);
}

function getRiskBadgeClasses(riskLevel: ApiRoamingIntelligenceDevice["risk_level"]): string {
  if (riskLevel === "critical") return "border-red-200 bg-red-50 text-[#DC2626]";
  if (riskLevel === "high") return "border-orange-200 bg-orange-50 text-[#F97316]";
  if (riskLevel === "medium") return "border-amber-200 bg-amber-50 text-[#B45309]";
  return "border-emerald-200 bg-emerald-50 text-[#15803D]";
}

function getSourceStrokeColor(locationSource: ApiRoamingIntelligenceDevice["location_source"]): string {
  if (locationSource === "gps_exact") return "#2563EB";
  if (locationSource === "simulated_demo") return "#7C3AED";
  if (locationSource === "estimated_mcc") return "#475569";
  return "#334155";
}

function getFlowColor(riskLevel: ApiRoamingIntelligenceFlow["risk_level"]): string {
  if (riskLevel === "critical") return "#DC2626";
  if (riskLevel === "high") return "#F97316";
  if (riskLevel === "medium") return "#F59E0B";
  return "#38BDF8";
}

function formatUsage(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "Donnee indisponible";
  }
  return `${value.toFixed(1)} Go`;
}

function formatLocation(device: Pick<ApiRoamingIntelligenceDevice, "city" | "country">): string {
  if (device.city) {
    return `${device.city}, ${device.country}`;
  }
  return device.country;
}

function formatLocationPair(city: string | null, country: string | null): string {
  if (city && country) {
    return `${city}, ${country}`;
  }
  return city || country || "Non disponible";
}

function formatFraudFlagLabel(fraudFlag: boolean): string {
  return fraudFlag ? "Oui" : "Non";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hasValidCoordinates(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

function hasDistinctCoordinates(
  originLatitude: number,
  originLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number,
): boolean {
  return (
    Math.abs(originLatitude - destinationLatitude) > 0.01 ||
    Math.abs(originLongitude - destinationLongitude) > 0.01
  );
}

function getDeviceRadius(device: ApiRoamingIntelligenceDevice): number {
  return clamp(7 + device.alerts + device.fraud_signals + Math.round(device.risk_score / 22), 9, 17);
}

function getHeatRadius(zone: ApiRoamingIntelligenceZone): number {
  return clamp(zone.intensity * 650, 45000, 220000);
}

function getClusterRadius(zone: ApiRoamingIntelligenceZone): number {
  return clamp(12 + zone.device_count * 2 + zone.critical_alerts * 1.5, 12, 26);
}

function getCriticalZoneRadius(zone: RenderableCriticalZone): number {
  return clamp(18 + zone.active_devices * 1.3 + zone.critical_alerts * 1.8, 16, 30);
}

function getCriticalZoneHaloRadius(zone: RenderableCriticalZone): number {
  return clamp(85000 + zone.intensity * 240, 65000, 210000);
}

function getFlowNodeRadius(flow: ApiRoamingIntelligenceFlow): number {
  return clamp(5 + flow.alerts * 0.35 + flow.event_count * 0.08, 6, 12);
}

function getHeatZoneKey(zone: ApiRoamingIntelligenceZone, index: number): string {
  return `heat:${zone.label}:${zone.latitude}:${zone.longitude}:${zone.risk_level}:${index}`;
}

function getCriticalZoneKey(zone: RenderableCriticalZone, index: number): string {
  return `critical:${zone.label}:${zone.latitude}:${zone.longitude}:${zone.risk_level}:${index}`;
}

function getFlowKey(flow: RenderableMovementFlow, index: number): string {
  return [
    "flow",
    flow.origin_label,
    flow.destination_label,
    flow.origin_latitude,
    flow.origin_longitude,
    flow.destination_latitude,
    flow.destination_longitude,
    flow.risk_level,
    index,
  ].join(":");
}

function getClusterKey(zone: ApiRoamingIntelligenceZone, index: number): string {
  return `cluster:${zone.label}:${zone.latitude}:${zone.longitude}:${zone.risk_level}:${index}`;
}

function getDeviceKey(device: ApiRoamingIntelligenceDevice, index: number): string {
  return [
    "device",
    device.line_id ?? "line-na",
    device.phone_number ?? "phone-na",
    device.latitude,
    device.longitude,
    device.location_source,
    device.last_event_at ?? "event-na",
    index,
  ].join(":");
}

function getRoamingPopupProps(variant: "inline" | "fullscreen") {
  return {
    className: "roaming-map-popup",
    keepInView: true,
    maxHeight: variant === "fullscreen" ? FULLSCREEN_POPUP_MAX_HEIGHT : INLINE_POPUP_MAX_HEIGHT,
    autoPanPaddingTopLeft:
      variant === "fullscreen"
        ? FULLSCREEN_POPUP_AUTO_PAN_PADDING_TOP_LEFT
        : INLINE_POPUP_AUTO_PAN_PADDING_TOP_LEFT,
    autoPanPaddingBottomRight: POPUP_AUTO_PAN_PADDING_BOTTOM_RIGHT,
  } as const;
}

function getDeviceMarkerTone(device: ApiRoamingIntelligenceDevice): "critical" | "high" | "medium" | "low" {
  if (device.fraud_flag || device.risk_level === "critical") {
    return "critical";
  }
  if (device.risk_level === "high") {
    return "high";
  }
  if (device.risk_level === "medium") {
    return "medium";
  }
  return "low";
}

function createClusteredDeviceIcon(device: ApiRoamingIntelligenceDevice) {
  const tone = getDeviceMarkerTone(device);

  return L.divIcon({
    className: "bc-roaming-device-marker-icon",
    html: `<span class="bc-roaming-device-marker bc-roaming-device-marker--${tone}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function createClusterGroupIcon(cluster: { getChildCount: () => number }) {
  const childCount = cluster.getChildCount();
  const size = childCount >= 25 ? 58 : childCount >= 10 ? 52 : 46;

  return L.divIcon({
    className: "bc-roaming-cluster-icon",
    html: `
      <span class="bc-roaming-cluster-badge" style="width:${size}px;height:${size}px;">
        <span class="bc-roaming-cluster-badge__core">${childCount}</span>
      </span>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function buildHeatLayerPoints(zones: ApiRoamingIntelligenceZone[]): L.HeatLatLngTuple[] {
  if (zones.length === 0) {
    return [];
  }

  const maxIntensity = Math.max(
    1,
    ...zones.map((zone) => Math.max(zone.intensity, zone.device_count, zone.critical_alerts, zone.fraud_signals)),
  );

  return zones.map((zone) => [
    zone.latitude,
    zone.longitude,
    clamp(zone.intensity / maxIntensity, 0.22, 1),
  ]);
}

function renderDevicePopupContent(device: ApiRoamingIntelligenceDevice, deviceKey: string) {
  return (
    <div className="space-y-3 p-4 text-sm text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-white">{formatLocation(device)}</p>
          <p className="text-slate-300">{device.phone_number ?? "Ligne de demonstration"}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getRiskBadgeClasses(device.risk_level)}`}>
          {device.risk_level}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-slate-200">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Type</p>
          <p className="mt-1 font-medium">{formatCallZoneLabel(device.call_zone)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Ligne</p>
          <p className="mt-1 font-medium">{device.line_id ? `#${device.line_id}` : "Non rattachee"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Utilisateur</p>
          <p className="mt-1 font-medium">{device.employee ?? "Non attribue"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Operateur</p>
          <p className="mt-1 font-medium">{device.operator}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Fraude</p>
          <p className="mt-1 font-medium">{formatFraudFlagLabel(device.fraud_flag)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Cout</p>
          <p className="mt-1 font-medium">{formatMadValue(device.call_cost_mad)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Score risque</p>
          <p className="mt-1 font-medium">{formatRiskScore(device.fraud_risk_score_100)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-slate-200">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Origine reelle</p>
          <p className="mt-1 font-medium">{formatLocationPair(device.location_origin, device.country_origin)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Destination</p>
          <p className="mt-1 font-medium">{formatLocationPair(device.location_dest, device.country_dest)}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Position affichee</p>
          <p className="mt-1 font-medium">{formatLocation(device)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Cause probable</p>
        <p className="mt-1 text-sm leading-6 text-white">{device.explanation}</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-400">
          <Brain className="h-3.5 w-3.5" />
          <span>Action recommandee</span>
        </div>
        <p className="mt-2 text-sm font-medium leading-6 text-violet-100">{device.recommendation}</p>
        {device.ai_reasoning.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-violet-100">
            {device.ai_reasoning.slice(0, 3).map((reason, reasonIndex) => (
              <li key={`${deviceKey}:reason:${reasonIndex}`}>- {reason}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 text-slate-200">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Data</p>
          <p className="mt-1 font-medium">{formatUsage(device.data_usage)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Precision</p>
          <p className="mt-1 font-medium">{device.location_precision_label}</p>
        </div>
      </div>

      {device.last_event_at ? (
        <p className="text-xs text-slate-400">Dernier signal: {formatCdrDateTime(device.last_event_at)}</p>
      ) : null}
    </div>
  );
}

function RoamingHeatLayer({ heatmap }: { heatmap: ApiRoamingIntelligenceZone[] }) {
  const map = useMap();
  const heatPoints = useMemo(() => buildHeatLayerPoints(heatmap), [heatmap]);

  useEffect(() => {
    if (heatPoints.length === 0) {
      return;
    }

    let isDisposed = false;
    let heatLayer: L.Layer | null = null;

    void ensureLeafletHeatPlugin()
      .then(() => {
        if (isDisposed || typeof L.heatLayer !== "function") {
          return;
        }

        heatLayer = L.heatLayer(heatPoints, {
          pane: "heatmap-pane",
          radius: 34,
          blur: 26,
          minOpacity: 0.32,
          maxZoom: 8,
          gradient: {
            0.2: "#38BDF8",
            0.45: "#818CF8",
            0.7: "#F97316",
            1: "#DC2626",
          },
        });

        heatLayer.addTo(map);
      })
      .catch(() => {
        // Keep the map usable even if the optional heatmap plugin cannot be loaded.
      });

    return () => {
      isDisposed = true;
      heatLayer?.remove();
    };
  }, [heatPoints, map]);

  return null;
}

const RoamingClusteredDeviceMarkers = memo(function RoamingClusteredDeviceMarkers({
  devices,
  variant,
  popupProps,
  onSelectDevice,
}: {
  devices: ApiRoamingIntelligenceDevice[];
  variant: "inline" | "fullscreen";
  popupProps: ReturnType<typeof getRoamingPopupProps>;
  onSelectDevice?: (device: ApiRoamingIntelligenceDevice) => void;
}) {
  return (
    <MarkerClusterGroup
      chunkedLoading
      showCoverageOnHover={false}
      spiderfyOnMaxZoom
      removeOutsideVisibleBounds
      maxClusterRadius={52}
      iconCreateFunction={createClusterGroupIcon}
    >
      {devices.map((device, index) => {
        const deviceKey = getDeviceKey(device, index);

        return (
          <Marker
            key={deviceKey}
            position={[device.latitude, device.longitude]}
            icon={createClusteredDeviceIcon(device)}
            eventHandlers={
              variant === "fullscreen" && onSelectDevice
                ? {
                    click: () => {
                      onSelectDevice(device);
                    },
                  }
                : undefined
            }
          >
            {variant === "fullscreen" ? (
              <Tooltip direction="top" offset={[0, -10]}>
                <div className="text-sm">
                  <p className="font-semibold">{formatLocation(device)}</p>
                  <p>{device.phone_number ?? "Ligne de demonstration"}</p>
                </div>
              </Tooltip>
            ) : (
              <Popup {...popupProps} minWidth={330}>
                {renderDevicePopupContent(device, deviceKey)}
              </Popup>
            )}
          </Marker>
        );
      })}
    </MarkerClusterGroup>
  );
});
RoamingClusteredDeviceMarkers.displayName = "RoamingClusteredDeviceMarkers";

const RoamingMapDetailPanel = memo(function RoamingMapDetailPanel({
  device,
  onClose,
}: {
  device: ApiRoamingIntelligenceDevice;
  onClose: () => void;
}) {
  const stopPanelEventPropagation = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <aside
      data-testid="roaming-map-detail-panel"
      aria-label="Panneau de details roaming"
      className="pointer-events-auto rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.98),rgba(15,23,42,0.98))] text-white shadow-[0_32px_90px_rgba(2,6,23,0.42)] backdrop-blur-xl"
      style={ROAMING_DETAIL_PANEL_STYLE}
      onWheelCapture={stopPanelEventPropagation}
      onTouchMoveCapture={stopPanelEventPropagation}
      onPointerDownCapture={stopPanelEventPropagation}
    >
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[linear-gradient(180deg,rgba(8,15,31,0.98),rgba(8,15,31,0.92))] px-6 py-5 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-2xl font-semibold text-white">{formatLocation(device)}</h3>
              <Badge className={`rounded-full border px-3 py-1 text-sm font-semibold ${getRiskBadgeClasses(device.risk_level)}`}>
                {device.risk_level}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-slate-300">{device.phone_number ?? "Ligne de demonstration"}</p>
          </div>
          <button
            type="button"
            aria-label="Fermer le panneau de details"
            data-testid="roaming-map-detail-panel-close-button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div data-testid="roaming-map-detail-panel-scroll" className="space-y-5 px-6 py-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Type</p>
            <p className="mt-3 text-xl font-semibold text-slate-100">{formatCallZoneLabel(device.call_zone)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Ligne</p>
            <p className="mt-3 text-xl font-semibold text-slate-100">{device.line_id ? `#${device.line_id}` : "Non rattachee"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Utilisateur</p>
            <p className="mt-3 text-xl font-semibold text-slate-100">{device.employee ?? "Non attribue"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Operateur</p>
            <p className="mt-3 text-xl font-semibold text-slate-100">{device.operator}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Fraude</p>
            <p className="mt-3 text-xl font-semibold text-slate-100">{formatFraudFlagLabel(device.fraud_flag)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Cout</p>
            <p className="mt-3 text-xl font-semibold text-slate-100">{formatMadValue(device.call_cost_mad)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Score risque</p>
            <p className="mt-3 text-3xl font-semibold text-slate-100">{formatRiskScore(device.fraud_risk_score_100)}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Origine reelle</p>
            <p className="mt-3 text-lg font-semibold text-slate-100">
              {formatLocationPair(device.location_origin, device.country_origin)}
            </p>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Destination</p>
            <p className="mt-3 text-lg font-semibold text-slate-100">
              {formatLocationPair(device.location_dest, device.country_dest)}
            </p>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Position affichee</p>
            <p className="mt-3 text-lg font-semibold text-slate-100">{formatLocation(device)}</p>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Cause probable</p>
          <p className="mt-3 text-sm leading-7 text-slate-100">{device.explanation}</p>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
            <Brain className="h-4 w-4" />
            <span>Action recommandee</span>
          </div>
          <p className="mt-3 text-sm font-medium leading-7 text-violet-100">{device.recommendation}</p>
          {device.ai_reasoning.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm leading-6 text-violet-100">
              {device.ai_reasoning.slice(0, 3).map((reason, reasonIndex) => (
                <li key={`${device.line_id ?? "line"}:reason:${reasonIndex}`}>- {reason}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Data</p>
            <p className="mt-3 text-lg font-semibold text-slate-100">{formatUsage(device.data_usage)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Precision</p>
            <p className="mt-3 text-lg font-semibold text-slate-100">{device.location_precision_label}</p>
          </div>
        </div>

        {device.last_event_at ? (
          <p className="text-sm text-slate-400">Dernier signal: {formatCdrDateTime(device.last_event_at)}</p>
        ) : null}
      </div>
    </aside>,
    document.body,
  );
});
RoamingMapDetailPanel.displayName = "RoamingMapDetailPanel";

export function buildRenderableCriticalZones(
  criticalZones: ApiRoamingCriticalZone[],
  clusters: ApiRoamingIntelligenceZone[],
  heatmap: ApiRoamingIntelligenceZone[],
): RenderableCriticalZone[] {
  const clusterIndex = new Map(
    [...clusters, ...heatmap].map((zone) => [`${zone.label}::${zone.country}::${zone.city ?? ""}`, zone]),
  );

  const seenKeys = new Set<string>();

  return criticalZones.flatMap((zone) => {
    const sourceZone =
      hasValidCoordinates(zone.latitude, zone.longitude)
        ? zone
        : clusterIndex.get(`${zone.label}::${zone.country}::${zone.city ?? ""}`);

    if (!sourceZone || !hasValidCoordinates(sourceZone.latitude, sourceZone.longitude)) {
      return [];
    }

    const renderableZone: RenderableCriticalZone = {
      ...zone,
      latitude: sourceZone.latitude,
      longitude: sourceZone.longitude,
      intensity: "intensity" in sourceZone && typeof sourceZone.intensity === "number" ? sourceZone.intensity : 0,
    };

    const key = `${renderableZone.label}:${renderableZone.latitude}:${renderableZone.longitude}:${renderableZone.risk_level}`;
    if (seenKeys.has(key)) {
      return [];
    }
    seenKeys.add(key);
    return [renderableZone];
  });
}

function getRiskLevelRank(riskLevel: ApiRoamingIntelligenceFlow["risk_level"]): number {
  if (riskLevel === "critical") {
    return 3;
  }
  if (riskLevel === "high") {
    return 2;
  }
  if (riskLevel === "medium") {
    return 1;
  }
  return 0;
}

function getHighestRiskLevel(
  ...levels: Array<ApiRoamingIntelligenceFlow["risk_level"]>
): ApiRoamingIntelligenceFlow["risk_level"] {
  return levels.reduce<ApiRoamingIntelligenceFlow["risk_level"]>((highest, current) => {
    return getRiskLevelRank(current) > getRiskLevelRank(highest) ? current : highest;
  }, "low");
}

function buildSyntheticFlow(
  sourceLabel: string,
  sourceLatitude: number,
  sourceLongitude: number,
  zone: RenderableCriticalZone,
  riskLevel?: ApiRoamingIntelligenceFlow["risk_level"],
): RenderableMovementFlow | null {
  if (
    !hasValidCoordinates(sourceLatitude, sourceLongitude) ||
    !hasValidCoordinates(zone.latitude, zone.longitude) ||
    !hasDistinctCoordinates(sourceLatitude, sourceLongitude, zone.latitude, zone.longitude)
  ) {
    return null;
  }

  return {
    origin_label: sourceLabel,
    destination_label: zone.label,
    origin_latitude: sourceLatitude,
    origin_longitude: sourceLongitude,
    destination_latitude: zone.latitude,
    destination_longitude: zone.longitude,
    total_roaming_cost_mad: Math.round(zone.total_roaming_cost_mad * 100) / 100,
    alerts: Math.max(zone.alerts, zone.critical_alerts, 1),
    event_count: Math.max(zone.active_devices + zone.critical_alerts, zone.alerts, 1),
    risk_level: riskLevel ?? zone.risk_level,
    synthetic: true,
    explanation:
      "Flux geospatial reconstitue a partir des zones critiques pour visualiser la concentration roaming lorsque les trajectoires CDR restent partielles.",
  };
}

export function buildRenderableMovementFlows(
  movementFlows: ApiRoamingIntelligenceFlow[],
  criticalZones: RenderableCriticalZone[],
  devices: ApiRoamingIntelligenceDevice[],
): RenderableMovementFlow[] {
  const explicitFlows = movementFlows
    .filter((flow) => {
      return (
        hasValidCoordinates(flow.origin_latitude, flow.origin_longitude) &&
        hasValidCoordinates(flow.destination_latitude, flow.destination_longitude) &&
        hasDistinctCoordinates(
          flow.origin_latitude,
          flow.origin_longitude,
          flow.destination_latitude,
          flow.destination_longitude,
        )
      );
    })
    .map((flow) => ({
      ...flow,
      synthetic: false,
      explanation:
        "Flux roaming observe a partir des evenements geographiques consolides par FleetConnect IA.",
    }));

  if (explicitFlows.length > 0) {
    return explicitFlows;
  }

  const sortedZones = [...criticalZones].sort((leftZone, rightZone) => {
    if (leftZone.total_roaming_cost_mad !== rightZone.total_roaming_cost_mad) {
      return rightZone.total_roaming_cost_mad - leftZone.total_roaming_cost_mad;
    }
    if (leftZone.critical_alerts !== rightZone.critical_alerts) {
      return rightZone.critical_alerts - leftZone.critical_alerts;
    }
    return rightZone.active_devices - leftZone.active_devices;
  });

  const fallbackFlows: RenderableMovementFlow[] = [];
  const flowKeys = new Set<string>();

  const pushFlow = (flow: RenderableMovementFlow | null) => {
    if (!flow) {
      return;
    }

    const flowKey = `${flow.origin_label}:${flow.destination_label}:${flow.origin_latitude}:${flow.origin_longitude}:${flow.destination_latitude}:${flow.destination_longitude}`;
    if (flowKeys.has(flowKey)) {
      return;
    }

    flowKeys.add(flowKey);
    fallbackFlows.push(flow);
  };

  if (sortedZones.length > 1) {
    const [hubZone, ...otherZones] = sortedZones;

    otherZones.slice(0, 5).forEach((zone) => {
      pushFlow(
        buildSyntheticFlow(
          hubZone.label,
          hubZone.latitude,
          hubZone.longitude,
          zone,
          getHighestRiskLevel(hubZone.risk_level, zone.risk_level),
        ),
      );
    });
  }

  if (fallbackFlows.length > 0) {
    return fallbackFlows;
  }

  const topZone = sortedZones[0] ?? null;
  if (!topZone) {
    return [];
  }

  const alternateDevices = devices
    .filter((device) => {
      return (
        hasValidCoordinates(device.latitude, device.longitude) &&
        hasDistinctCoordinates(device.latitude, device.longitude, topZone.latitude, topZone.longitude)
      );
    })
    .sort((leftDevice, rightDevice) => {
      if (leftDevice.roaming_cost !== rightDevice.roaming_cost) {
        return rightDevice.roaming_cost - leftDevice.roaming_cost;
      }
      return rightDevice.alerts - leftDevice.alerts;
    });

  if (alternateDevices.length > 0) {
    alternateDevices.slice(0, 3).forEach((device) => {
      pushFlow(
        buildSyntheticFlow(
          formatLocation(device),
          device.latitude,
          device.longitude,
          topZone,
          getHighestRiskLevel(device.risk_level, topZone.risk_level),
        ),
      );
    });
  }

  if (fallbackFlows.length > 0) {
    return fallbackFlows;
  }

  pushFlow(buildSyntheticFlow("Hub Maroc FleetConnect", MOROCCO_CENTER[0], MOROCCO_CENTER[1], topZone));

  return fallbackFlows;
}

export function getViewportCoordinates({
  devices,
  flows,
  heatmap,
  clusters,
  criticalZones,
}: {
  devices: ApiRoamingIntelligenceDevice[];
  flows: RenderableMovementFlow[];
  heatmap: ApiRoamingIntelligenceZone[];
  clusters: ApiRoamingIntelligenceZone[];
  criticalZones: RenderableCriticalZone[];
}): Array<[number, number]> {
  const rawCoordinates: Array<[number | undefined, number | undefined]> = [
    ...devices.map((device) => [device.latitude, device.longitude]),
    ...heatmap.map((zone) => [zone.latitude, zone.longitude]),
    ...clusters.map((zone) => [zone.latitude, zone.longitude]),
    ...criticalZones.map((zone) => [zone.latitude, zone.longitude]),
    ...flows.flatMap((flow) => [
      [flow.origin_latitude, flow.origin_longitude],
      [flow.destination_latitude, flow.destination_longitude],
    ]),
  ];

  const dedupedCoordinates = new Map<string, [number, number]>();
  for (const [latitude, longitude] of rawCoordinates) {
    if (!hasValidCoordinates(latitude, longitude)) {
      continue;
    }
    const normalizedLatitude = Number(latitude);
    const normalizedLongitude = Number(longitude);
    const key = `${normalizedLatitude.toFixed(6)}:${normalizedLongitude.toFixed(6)}`;
    if (!dedupedCoordinates.has(key)) {
      dedupedCoordinates.set(key, [normalizedLatitude, normalizedLongitude]);
    }
  }

  return [...dedupedCoordinates.values()];
}

export function hasRenderableGeoData({
  devices,
  heatmap,
  clusters,
  criticalZones,
  movementFlows,
}: {
  devices: ApiRoamingIntelligenceDevice[];
  heatmap: ApiRoamingIntelligenceZone[];
  clusters: ApiRoamingIntelligenceZone[];
  criticalZones: RenderableCriticalZone[];
  movementFlows: RenderableMovementFlow[];
}): boolean {
  return (
    devices.length > 0 ||
    heatmap.length > 0 ||
    clusters.length > 0 ||
    criticalZones.length > 0 ||
    movementFlows.length > 0
  );
}

type LeafletMapRuntime = ReturnType<typeof useMap> & {
  _container?: { isConnected?: boolean } | null;
  _loaded?: boolean;
  _mapPane?: { _leaflet_pos?: unknown } | null;
};

type LeafletContainerLike = { isConnected?: boolean } | null;

function getSafeMapContainer(map: ReturnType<typeof useMap>): LeafletContainerLike {
  try {
    const container = map.getContainer();
    return typeof container === "object" && container !== null ? (container as LeafletContainerLike) : null;
  } catch {
    return null;
  }
}

function canReadLeafletViewport(map: ReturnType<typeof useMap>): boolean {
  const runtimeMap = map as LeafletMapRuntime;
  const container = getSafeMapContainer(map);
  const hasConnectedContainer = Boolean(container && container.isConnected !== false);
  if (!hasConnectedContainer) {
    return false;
  }

  if (runtimeMap._mapPane) {
    return Boolean(
      runtimeMap._loaded &&
        Object.prototype.hasOwnProperty.call(runtimeMap._mapPane, "_leaflet_pos"),
    );
  }

  return true;
}

function invalidateLeafletMapSize(map: ReturnType<typeof useMap>): boolean {
  const container = getSafeMapContainer(map);
  if (!container || container.isConnected === false) {
    return false;
  }

  try {
    map.invalidateSize({ pan: false, animate: false });
    return true;
  } catch {
    return false;
  }
}

function safelySetLeafletView(
  map: ReturnType<typeof useMap>,
  center: [number, number],
  zoom: number,
): boolean {
  if (!canReadLeafletViewport(map)) {
    return false;
  }

  try {
    map.setView(center, zoom, { animate: false });
    return true;
  } catch {
    return false;
  }
}

function safelyFitLeafletBounds(
  map: ReturnType<typeof useMap>,
  bounds: [[number, number], [number, number]] | Array<[number, number]>,
  options: { padding: [number, number]; maxZoom: number },
): boolean {
  if (!canReadLeafletViewport(map)) {
    return false;
  }

  try {
    map.fitBounds(bounds, { ...options, animate: false });
    return true;
  } catch {
    return false;
  }
}

function MapViewportController({
  devices,
  flows,
  heatmap,
  clusters,
  criticalZones,
  variant,
  padding = 36,
  resizeSignal = 0,
  invalidateDelayMs = 180,
  savedViewport = null,
  onViewportChange,
}: {
  devices: ApiRoamingIntelligenceDevice[];
  flows: RenderableMovementFlow[];
  heatmap: ApiRoamingIntelligenceZone[];
  clusters: ApiRoamingIntelligenceZone[];
  criticalZones: RenderableCriticalZone[];
  variant: "inline" | "fullscreen";
  padding?: number;
  resizeSignal?: number;
  invalidateDelayMs?: number;
  savedViewport?: MapViewState | null;
  onViewportChange?: (viewport: MapViewState) => void;
}) {
  const map = useMap();
  const savedViewportRef = useRef<MapViewState | null>(savedViewport);

  useEffect(() => {
    savedViewportRef.current = savedViewport;
  }, [savedViewport]);

  useEffect(() => {
    let isActive = true;

    function emitViewport() {
      if (!isActive || !canReadLeafletViewport(map)) {
        return;
      }

      try {
        const center = map.getCenter();
        onViewportChange?.({
          center: [Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))],
          zoom: map.getZoom(),
        });
      } catch {
        return;
      }
    }

    map.whenReady(() => {
      emitViewport();
    });

    map.on("moveend zoomend resize", emitViewport);

    return () => {
      isActive = false;
      map.off("moveend zoomend resize", emitViewport);
    };
  }, [map, onViewportChange]);

  useEffect(() => {
    const container = getSafeMapContainer(map);
    if (!container || container.isConnected === false) {
      return;
    }

    let animationFrameId = 0;
    let timeoutIds: number[] = [];

    function syncSize() {
      if (!container.isConnected) {
        return;
      }

      if (!invalidateLeafletMapSize(map)) {
        return;
      }

      const currentViewport = savedViewportRef.current;
      if (variant === "fullscreen" && currentViewport) {
        safelySetLeafletView(map, currentViewport.center, currentViewport.zoom);
      }
    }

    function scheduleSizeSync(delay: number) {
      const timeoutId = window.setTimeout(() => {
        animationFrameId = window.requestAnimationFrame(() => {
          syncSize();
        });
      }, delay);
      timeoutIds.push(timeoutId);
    }

    scheduleSizeSync(0);
    scheduleSizeSync(invalidateDelayMs);
    if (variant === "fullscreen") {
      scheduleSizeSync(invalidateDelayMs + 220);
    }

    const handleResize = () => {
      scheduleSizeSync(90);
    };

    window.addEventListener("resize", handleResize);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            handleResize();
          });

    resizeObserver?.observe(container);

    return () => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
    };
  }, [invalidateDelayMs, map, resizeSignal, variant]);

  useEffect(() => {
    const container = getSafeMapContainer(map);
    if (!container || container.isConnected === false) {
      return;
    }

    const currentViewport = savedViewportRef.current;
    const shouldFitViewport = variant === "inline" || !currentViewport;
    if (!shouldFitViewport) {
      return;
    }

    let animationFrameId = 0;
    const timeoutId = window.setTimeout(() => {
      animationFrameId = window.requestAnimationFrame(() => {
        if (!container.isConnected) {
          return;
        }

        if (!invalidateLeafletMapSize(map)) {
          return;
        }

        const coordinates = getViewportCoordinates({
          devices,
          flows,
          heatmap,
          clusters,
          criticalZones,
        });

        if (coordinates.length === 0) {
          safelyFitLeafletBounds(map, MOROCCO_BOUNDS, {
            padding: [padding, padding],
            maxZoom: DEFAULT_ZOOM,
          });
          return;
        }

        if (coordinates.length === 1) {
          safelySetLeafletView(map, coordinates[0], 6);
          return;
        }

        safelyFitLeafletBounds(map, coordinates, { padding: [padding, padding], maxZoom: 7 });
      });
    }, variant === "fullscreen" ? invalidateDelayMs : 0);

    return () => {
      window.clearTimeout(timeoutId);
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [
    clusters,
    criticalZones,
    devices,
    flows,
    heatmap,
    invalidateDelayMs,
    map,
    padding,
    variant,
  ]);

  return null;
}

function LegendItem({
  label,
  description,
  color,
  dashed = false,
}: {
  label: string;
  description: string;
  color: string;
  dashed?: boolean;
}) {
  return (
    <div className="bc-roaming-card flex items-start gap-3 p-3">
      <div
        className="mt-1 h-3.5 w-9 rounded-full border-2"
        style={{
          backgroundColor: "rgba(255,255,255,0.88)",
          borderColor: color,
          borderStyle: dashed ? "dashed" : "solid",
        }}
      />
      <div>
        <p className="text-sm font-semibold text-[#0F172A]">{label}</p>
        <p className="mt-1 text-xs leading-5 text-[#64748B]">{description}</p>
      </div>
    </div>
  );
}

function TimelineBar({ point, maxCost }: { point: ApiRoamingIntelligenceTimelinePoint; maxCost: number }) {
  const width = maxCost <= 0 ? 0 : (point.total_roaming_cost_mad / maxCost) * 100;

  return (
    <div className="bc-roaming-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#0F172A]">{point.bucket}</p>
          <p className="mt-1 text-xs text-[#64748B]">
            {point.active_devices} appareil(s) • {point.alerts} alerte(s)
          </p>
        </div>
        <p className="text-sm font-semibold text-[#0F172A]">{formatMadValue(point.total_roaming_cost_mad)}</p>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#E2E8F0]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#2563EB,#7C3AED)]"
          style={{ width: `${clamp(width, 8, 100)}%` }}
        />
      </div>
    </div>
  );
}

function CriticalZoneCard({ zone }: { zone: ApiRoamingCriticalZone }) {
  return (
    <div className="bc-roaming-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#0F172A]">{zone.label}</p>
          <p className="mt-1 text-sm text-[#64748B]">
            {zone.active_devices} appareil(s) • {zone.alerts} signaux
          </p>
        </div>
        <Badge className={`rounded-full border px-2.5 py-1 ${getRiskBadgeClasses(zone.risk_level)}`}>
          {zone.risk_level}
        </Badge>
      </div>
      <p className="mt-3 text-sm font-semibold text-[#0F172A]">{formatMadValue(zone.total_roaming_cost_mad)}</p>
      <p className="mt-2 text-sm leading-6 text-[#64748B]">{zone.explanation}</p>
    </div>
  );
}

function LeafletMapStyles() {
  return (
    <style>{`
      .roaming-map-surface .leaflet-container {
        height: 100%;
        width: 100%;
        background: linear-gradient(180deg, #dbeafe 0%, #e0f2fe 100%);
        font: inherit;
      }

      .roaming-map-surface .leaflet-control-container {
        z-index: 640;
      }

      .roaming-map-surface .leaflet-top,
      .roaming-map-surface .leaflet-bottom {
        z-index: 640;
      }

      .roaming-map-surface .leaflet-tile-pane {
        z-index: 200;
      }

      .roaming-map-surface .leaflet-overlay-pane {
        z-index: 320;
      }

      .roaming-map-surface .leaflet-marker-pane {
        z-index: 520;
      }

      .roaming-map-surface .leaflet-popup-pane {
        z-index: 760;
      }

      .roaming-map-surface .bc-roaming-device-marker-icon {
        background: transparent;
        border: 0;
      }

      .roaming-map-surface .bc-roaming-device-marker {
        display: block;
        height: 18px;
        width: 18px;
        border: 2px solid rgba(15, 23, 42, 0.88);
        border-radius: 999px;
        box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.12), 0 12px 24px rgba(15, 23, 42, 0.22);
      }

      .roaming-map-surface .bc-roaming-device-marker--critical {
        background: radial-gradient(circle at 35% 35%, #fca5a5 0%, #ef4444 42%, #991b1b 100%);
      }

      .roaming-map-surface .bc-roaming-device-marker--high {
        background: radial-gradient(circle at 35% 35%, #fdba74 0%, #f97316 44%, #9a3412 100%);
      }

      .roaming-map-surface .bc-roaming-device-marker--medium {
        background: radial-gradient(circle at 35% 35%, #fde68a 0%, #f59e0b 44%, #a16207 100%);
      }

      .roaming-map-surface .bc-roaming-device-marker--low {
        background: radial-gradient(circle at 35% 35%, #86efac 0%, #22c55e 44%, #166534 100%);
      }

      .roaming-map-surface .bc-roaming-cluster-icon {
        background: transparent;
        border: 0;
      }

      .roaming-map-surface .bc-roaming-cluster-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 4px;
        background: radial-gradient(circle at 30% 30%, rgba(165, 243, 252, 0.95), rgba(37, 99, 235, 0.92));
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.28);
      }

      .roaming-map-surface .bc-roaming-cluster-badge__core {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        border: 2px solid rgba(255, 255, 255, 0.72);
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(37, 99, 235, 0.88));
        color: #f8fafc;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .roaming-map-surface .leaflet-control-zoom {
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 18px;
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.22);
        backdrop-filter: blur(18px);
      }

      .roaming-map-surface .leaflet-control-zoom a {
        width: 42px;
        height: 42px;
        line-height: 40px;
        border: 0;
        color: #e2e8f0;
        background: rgba(15, 23, 42, 0.72);
        transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
      }

      .roaming-map-surface .leaflet-control-zoom a:hover {
        color: #ffffff;
        background: rgba(37, 99, 235, 0.72);
        transform: translateY(-1px);
      }

      .roaming-map-surface .leaflet-control-zoom a:first-child {
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .roaming-map-surface--inline .leaflet-control-zoom {
        background: rgba(248, 250, 252, 0.72);
      }

      .roaming-map-surface--inline .leaflet-control-zoom a {
        color: #0f172a;
        background: rgba(255, 255, 255, 0.86);
      }

      .roaming-map-surface--inline .leaflet-control-zoom a:hover {
        color: #0f172a;
        background: rgba(224, 231, 255, 0.96);
      }

      .roaming-map-surface--fullscreen .leaflet-container {
        background: #020617;
      }

      .roaming-map-surface--fullscreen .leaflet-control-zoom {
        background: rgba(15, 23, 42, 0.42);
        box-shadow: 0 18px 46px rgba(2, 6, 23, 0.46);
      }

      .roaming-map-surface--fullscreen .leaflet-top.leaflet-right {
        margin-top: 20px;
        margin-right: 20px;
      }

      .roaming-map-surface--fullscreen .leaflet-bottom.leaflet-right {
        margin-right: 16px;
        margin-bottom: 16px;
      }

      .roaming-map-surface--fullscreen .leaflet-control-attribution {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        background: rgba(2, 6, 23, 0.78);
        color: rgba(226, 232, 240, 0.76);
        padding: 4px 10px;
        backdrop-filter: blur(14px);
      }

      .roaming-map-surface--fullscreen .leaflet-control-attribution a {
        color: rgba(255, 255, 255, 0.88);
      }

      .roaming-map-popup .leaflet-popup-content-wrapper {
        border: 1px solid rgba(148, 163, 184, 0.14);
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(8, 15, 31, 0.98), rgba(15, 23, 42, 0.98));
        box-shadow: 0 24px 70px rgba(2, 6, 23, 0.45);
      }

      .roaming-map-popup .leaflet-popup-content {
        margin: 0;
        min-width: 0;
      }

      .roaming-map-popup .leaflet-popup-content.leaflet-popup-scrolled {
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.62) transparent;
      }

      .roaming-map-popup .leaflet-popup-content.leaflet-popup-scrolled::-webkit-scrollbar {
        width: 8px;
      }

      .roaming-map-popup .leaflet-popup-content.leaflet-popup-scrolled::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.5);
      }

      .roaming-map-popup .leaflet-popup-content.leaflet-popup-scrolled::-webkit-scrollbar-track {
        background: transparent;
      }

      .roaming-map-popup .leaflet-popup-tip {
        background: rgba(15, 23, 42, 0.98);
      }

      .roaming-map-popup .leaflet-popup-close-button {
        top: 8px;
        right: 8px;
        color: rgba(255, 255, 255, 0.72);
      }

      .roaming-map-popup .leaflet-popup-close-button:hover {
        color: #ffffff;
      }

      .roaming-map-surface .bc-roaming-critical-outline {
        filter: drop-shadow(0 0 14px rgba(239, 68, 68, 0.42));
      }

      .roaming-map-surface .bc-roaming-critical-core {
        filter: drop-shadow(0 0 12px rgba(249, 115, 22, 0.3));
      }

      .roaming-map-surface .bc-roaming-heat-outer {
        animation: bc-roaming-heat-fade 1.45s ease-out;
        transition: opacity 180ms ease, fill-opacity 180ms ease, stroke-opacity 180ms ease;
      }

      .roaming-map-surface .bc-roaming-heat-core {
        animation: bc-roaming-heat-pulse 2.4s ease-in-out infinite;
        transition: opacity 180ms ease, fill-opacity 180ms ease;
      }

      .roaming-map-surface .bc-roaming-flow-glow {
        filter: drop-shadow(0 0 12px rgba(251, 113, 133, 0.35));
        opacity: 0.34;
      }

      .roaming-map-surface .bc-roaming-flow-line {
        animation: bc-roaming-flow-dash 9s linear infinite;
        transition: opacity 180ms ease, stroke-opacity 180ms ease;
      }

      .roaming-map-surface .bc-roaming-flow-node {
        animation: bc-roaming-flow-node-pulse 2.2s ease-in-out infinite;
        filter: drop-shadow(0 0 10px rgba(56, 189, 248, 0.3));
      }

      @keyframes bc-roaming-heat-fade {
        from {
          opacity: 0;
          fill-opacity: 0;
        }
        to {
          opacity: 1;
          fill-opacity: 1;
        }
      }

      @keyframes bc-roaming-heat-pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.04);
        }
      }

      @keyframes bc-roaming-flow-dash {
        from {
          stroke-dashoffset: 0;
        }
        to {
          stroke-dashoffset: -40;
        }
      }

      @keyframes bc-roaming-flow-node-pulse {
        0%,
        100% {
          opacity: 0.82;
        }
        50% {
          opacity: 1;
        }
      }
    `}</style>
  );
}

const RoamingMapCanvas = memo(function RoamingMapCanvas({
  devices,
  heatmap,
  clusters,
  criticalZones,
  movementFlows,
  isLoading,
  pulseTick,
  showHeatmap,
  showFlows,
  showClusters,
  heightClassName,
  interactive = true,
  onOpenFullscreen,
  variant = "inline",
  resizeSignal = 0,
  savedViewport = null,
  onViewportChange,
  onSelectDevice,
}: RoamingMapCanvasProps) {
  const canOpenFullscreen = !interactive && typeof onOpenFullscreen === "function";
  const hasGeoData = hasRenderableGeoData({
    devices,
    heatmap,
    clusters,
    criticalZones,
    movementFlows,
  });
  const hasCriticalZoneOverlay = criticalZones.length > 0;
  const showClusterGroups = showClusters && devices.length > 0;
  const visibleHeatmap = useMemo(() => (showHeatmap ? heatmap : []), [heatmap, showHeatmap]);
  const visibleClusters = useMemo(() => (showClusterGroups ? clusters : []), [clusters, showClusterGroups]);
  const visibleDevices = useMemo(() => (showClusterGroups ? [] : devices), [devices, showClusterGroups]);
  const visibleMovementFlows = useMemo(() => (showFlows ? movementFlows : []), [movementFlows, showFlows]);
  const popupProps = getRoamingPopupProps(variant);

  return (
    <div
      data-testid={`roaming-map-canvas-${variant}`}
      className={`roaming-map-surface relative z-0 isolate w-full overflow-hidden ${
        variant === "fullscreen"
          ? "roaming-map-surface--fullscreen rounded-none border-0 bg-black"
          : "roaming-map-surface--inline rounded-[26px] border border-[#DCE5F1] bg-[#E9F0FF]"
      } ${heightClassName}`}
    >
      <LeafletMapStyles />
      {isLoading ? (
        <div
          className={`flex h-full items-center justify-center ${
            variant === "fullscreen"
              ? "bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.18),_transparent_22%),linear-gradient(180deg,#020617,#0F172A)] text-white"
              : "bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.14),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(37,99,235,0.12),_transparent_26%),linear-gradient(180deg,#F8FAFC,#EEF2FF)]"
          }`}
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className={`h-8 w-8 animate-spin ${variant === "fullscreen" ? "text-sky-300" : "text-[#6D28D9]"}`} />
            <div className="space-y-1">
              <p className={`text-sm font-semibold ${variant === "fullscreen" ? "text-white" : "text-[#0F172A]"}`}>
                Construction carte intelligente...
              </p>
              <p className={`text-sm ${variant === "fullscreen" ? "text-slate-300" : "text-[#64748B]"}`}>
                Analyse geographique IA, concentration roaming et score des zones critiques.
              </p>
            </div>
          </div>
        </div>
      ) : !hasGeoData ? (
        <div
          className={`flex h-full items-center justify-center px-6 text-center ${
            variant === "fullscreen"
              ? "bg-[linear-gradient(180deg,#020617,#0F172A)] text-white"
              : "bg-[linear-gradient(180deg,#FFFFFF,#F8FAFC)]"
          }`}
        >
          <div className="max-w-md">
            <AlertTriangle className={`mx-auto h-8 w-8 ${variant === "fullscreen" ? "text-amber-300" : "text-[#F59E0B]"}`} />
            <p className={`mt-3 text-lg font-semibold ${variant === "fullscreen" ? "text-white" : "text-[#0F172A]"}`}>
              Aucune donnee geospatiale disponible actuellement.
            </p>
            <p className={`mt-2 text-sm leading-6 ${variant === "fullscreen" ? "text-slate-300" : "text-[#64748B]"}`}>
              Ajustez les filtres ou relancez le mode live pour afficher les signaux roaming, les hotspots critiques et les flux geographiques.
            </p>
          </div>
        </div>
      ) : (
        <>
          <MapContainer
            center={savedViewport?.center ?? DEFAULT_CENTER}
            zoom={savedViewport?.zoom ?? DEFAULT_ZOOM}
            className="h-full w-full"
            scrollWheelZoom={interactive}
            zoomAnimation
            markerZoomAnimation
            zoomControl={false}
            doubleClickZoom={interactive}
            dragging={interactive}
            touchZoom={interactive}
            minZoom={2}
          >
            <ZoomControl position="topright" />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapViewportController
              devices={devices}
              flows={visibleMovementFlows}
              heatmap={visibleHeatmap}
              clusters={visibleClusters}
              criticalZones={criticalZones}
              variant={variant}
              padding={variant === "fullscreen" ? 88 : 44}
              resizeSignal={resizeSignal}
              invalidateDelayMs={variant === "fullscreen" ? 300 : 160}
              savedViewport={savedViewport}
              onViewportChange={onViewportChange}
            />

            {showHeatmap ? (
              <Pane name="heatmap-pane" style={{ zIndex: 320 }}>
                <RoamingHeatLayer heatmap={visibleHeatmap} />
                {visibleHeatmap.map((zone, index) => {
                  const zoneColor = getRiskColor(zone.risk_level);
                  const radius = getHeatRadius(zone);

                  return (
                    <Fragment key={getHeatZoneKey(zone, index)}>
                      <Circle
                        center={[zone.latitude, zone.longitude]}
                        radius={Math.round(radius * 1.08)}
                        pathOptions={{
                          color: zoneColor,
                          fillColor: zoneColor,
                          fillOpacity: 0.14,
                          opacity: 0.24,
                          weight: 1,
                          className: "bc-roaming-heat-outer",
                        }}
                      />
                      <Circle
                        data-testid="roaming-heatmap-zone"
                        center={[zone.latitude, zone.longitude]}
                        radius={Math.round(radius * 0.82)}
                        pathOptions={{
                          color: zoneColor,
                          fillColor: zoneColor,
                          fillOpacity: 0.24,
                          opacity: 0.38,
                          weight: 1.4,
                          className: "bc-roaming-heat-outer",
                        }}
                      />
                      <CircleMarker
                        data-testid="roaming-heatmap-hotspot"
                        center={[zone.latitude, zone.longitude]}
                        radius={clamp(9 + zone.device_count + Math.round(zone.intensity / 35), 10, 22)}
                        pathOptions={{
                          color: "#FFF7ED",
                          fillColor: zoneColor,
                          fillOpacity: 0.62,
                          opacity: 0.82,
                          weight: 1.8,
                          className: "bc-roaming-heat-core",
                        }}
                      >
                        <Tooltip direction="top" offset={[0, -8]}>
                          <div className="text-sm">
                            <p className="font-semibold">{zone.label}</p>
                            <p>Hotspot roaming • {formatMadValue(zone.total_roaming_cost_mad)}</p>
                          </div>
                        </Tooltip>
                        <Popup {...popupProps} minWidth={280}>
                          <div className="space-y-3 p-4 text-sm text-slate-100">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-white">{zone.label}</p>
                                <p className="text-slate-300">{zone.city ? `${zone.city}, ${zone.country}` : zone.country}</p>
                              </div>
                              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getRiskBadgeClasses(zone.risk_level)}`}>
                                {zone.risk_level}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-slate-200">
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Impact</p>
                                <p className="mt-1 font-medium">{formatMadValue(zone.total_roaming_cost_mad)}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Appareils</p>
                                <p className="mt-1 font-medium">{zone.device_count}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Alertes</p>
                                <p className="mt-1 font-medium">{zone.critical_alerts}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Signaux fraude</p>
                                <p className="mt-1 font-medium">{zone.fraud_signals}</p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-violet-100">
                              Concentration anormale de trafic roaming a verifier en priorite sur cette zone.
                            </div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    </Fragment>
                  );
                })}
              </Pane>
            ) : null}

            {hasCriticalZoneOverlay ? (
              <Pane name="critical-zone-pane" style={{ zIndex: 460 }}>
                {criticalZones.map((zone, index) => {
                  const glowColor = getRiskColor(zone.risk_level);
                  const markerRadius = getCriticalZoneRadius(zone);
                  const haloRadius = getCriticalZoneHaloRadius(zone);
                  const zoneScore = Math.min(
                    100,
                    Math.round(54 + zone.critical_alerts * 6 + zone.fraud_signals * 5 + zone.active_devices * 1.8),
                  );

                  return (
                    <Fragment key={getCriticalZoneKey(zone, index)}>
                      <Circle
                        center={[zone.latitude, zone.longitude]}
                        radius={haloRadius}
                        pathOptions={{
                          color: glowColor,
                          fillColor: glowColor,
                          fillOpacity: pulseTick ? 0.075 : 0.045,
                          opacity: pulseTick ? 0.34 : 0.22,
                          weight: pulseTick ? 1.6 : 1,
                          dashArray: zone.risk_level === "critical" ? "4 8" : "3 7",
                          className: "bc-roaming-critical-outline",
                        }}
                      />
                      <CircleMarker
                        center={[zone.latitude, zone.longitude]}
                        radius={markerRadius + (pulseTick ? 6 : 3)}
                        pathOptions={{
                          color: glowColor,
                          fillColor: glowColor,
                          fillOpacity: pulseTick ? 0.11 : 0.08,
                          opacity: pulseTick ? 0.56 : 0.34,
                          weight: 1,
                          className: "bc-roaming-critical-outline",
                        }}
                      />
                      <CircleMarker
                        data-testid="roaming-critical-zone-marker"
                        center={[zone.latitude, zone.longitude]}
                        radius={markerRadius}
                        pathOptions={{
                          color: "#0F172A",
                          fillColor: glowColor,
                          fillOpacity: 0.86,
                          opacity: 1,
                          weight: 2.6,
                          className: "bc-roaming-critical-core",
                        }}
                      >
                        <Tooltip direction="top" offset={[0, -10]}>
                          <div className="text-sm">
                            <p className="font-semibold">{zone.label}</p>
                            <p>
                              {formatMadValue(zone.total_roaming_cost_mad)} • {zone.critical_alerts} alertes critiques
                            </p>
                          </div>
                        </Tooltip>
                        <Popup {...popupProps} minWidth={300}>
                          <div className="space-y-3 p-4 text-sm text-slate-100">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-white">{zone.label}</p>
                                <p className="text-slate-300">{zone.city ? `${zone.city}, ${zone.country}` : zone.country}</p>
                              </div>
                              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getRiskBadgeClasses(zone.risk_level)}`}>
                                {zone.risk_level}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-slate-200">
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Score risque</p>
                                <p className="mt-1 font-medium">{zoneScore}/100</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Impact</p>
                                <p className="mt-1 font-medium">{formatMadValue(zone.total_roaming_cost_mad)}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Alertes</p>
                                <p className="mt-1 font-medium">{zone.alerts}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Lignes</p>
                                <p className="mt-1 font-medium">{zone.active_devices}</p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Recommandation IA</p>
                              <p className="mt-1 text-sm font-medium leading-6 text-violet-100">{zone.explanation}</p>
                            </div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    </Fragment>
                  );
                })}
              </Pane>
            ) : null}

            {showFlows ? (
              <Pane name="flow-pane" style={{ zIndex: 360 }}>
                {movementFlows.map((flow, index) => (
                  <Polyline
                    key={getFlowKey(flow, index)}
                    data-testid="roaming-flow-line"
                    positions={[
                      [flow.origin_latitude, flow.origin_longitude],
                      [flow.destination_latitude, flow.destination_longitude],
                    ]}
                    pathOptions={{
                      color: getFlowColor(flow.risk_level),
                      weight: clamp(flow.alerts + 2, 2, 5),
                      opacity: 0.84,
                      dashArray: flow.risk_level === "critical" ? "7 7" : "5 9",
                      className: "bc-roaming-flow-line",
                    }}
                  >
                    <Tooltip sticky>
                      <div className="text-sm">
                        <p className="font-semibold">
                          {flow.origin_label} {"->"} {flow.destination_label}
                        </p>
                        <p>
                          {formatMadValue(flow.total_roaming_cost_mad)} • {flow.event_count} evenement(s)
                        </p>
                      </div>
                    </Tooltip>
                    <Popup {...popupProps} minWidth={300}>
                      <div className="space-y-3 p-4 text-sm text-slate-100">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{flow.origin_label}</p>
                            <p className="text-slate-300">Vers {flow.destination_label}</p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getRiskBadgeClasses(flow.risk_level)}`}>
                            {flow.risk_level}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-slate-200">
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Origine</p>
                            <p className="mt-1 font-medium">{flow.origin_label}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Destination</p>
                            <p className="mt-1 font-medium">{flow.destination_label}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Cout</p>
                            <p className="mt-1 font-medium">{formatMadValue(flow.total_roaming_cost_mad)}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Alertes</p>
                            <p className="mt-1 font-medium">{flow.alerts}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Evenements</p>
                            <p className="mt-1 font-medium">{flow.event_count}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Criticite</p>
                            <p className="mt-1 font-medium">{flow.risk_level}</p>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Lecture IA</p>
                          <p className="mt-1 text-sm font-medium leading-6 text-violet-100">
                            {flow.explanation ??
                              `Flux roaming a surveiller entre ${flow.origin_label} et ${flow.destination_label} avec exposition ${formatMadValue(flow.total_roaming_cost_mad)} et ${flow.alerts} alerte(s).`}
                          </p>
                        </div>
                      </div>
                    </Popup>
                  </Polyline>
                ))}
              </Pane>
            ) : null}

            {showFlows ? (
              <Pane name="flow-node-pane" style={{ zIndex: 438 }}>
                {movementFlows.flatMap((flow, index) => {
                  const flowColor = getFlowColor(flow.risk_level);
                  const nodeRadius = getFlowNodeRadius(flow);
                  const flowKey = getFlowKey(flow, index);

                  return [
                    <CircleMarker
                      key={`${flowKey}:origin`}
                      data-testid="roaming-flow-node"
                      center={[flow.origin_latitude, flow.origin_longitude]}
                      radius={nodeRadius}
                      pathOptions={{
                        color: "#DBEAFE",
                        fillColor: flowColor,
                        fillOpacity: 0.92,
                        opacity: 0.86,
                        weight: 1.5,
                        className: "bc-roaming-flow-node",
                      }}
                    />,
                    <CircleMarker
                      key={`${flowKey}:destination`}
                      data-testid="roaming-flow-node"
                      center={[flow.destination_latitude, flow.destination_longitude]}
                      radius={Math.max(5, nodeRadius - 1)}
                      pathOptions={{
                        color: "#E0F2FE",
                        fillColor: flowColor,
                        fillOpacity: 0.76,
                        opacity: 0.78,
                        weight: 1.2,
                        className: "bc-roaming-flow-node",
                      }}
                    />,
                  ];
                })}
              </Pane>
            ) : null}

            {showClusterGroups && false ? (
              <Pane name="cluster-pane" style={{ zIndex: 420 }}>
                {visibleClusters.map((zone, index) => (
                  <CircleMarker
                    key={getClusterKey(zone, index)}
                    data-testid="roaming-cluster-marker"
                    center={[zone.latitude, zone.longitude]}
                    radius={getClusterRadius(zone)}
                    pathOptions={{
                      color: getRiskColor(zone.risk_level),
                      fillColor: getRiskColor(zone.risk_level),
                      fillOpacity: 0.22,
                      opacity: 0.92,
                      weight: 1.8,
                      dashArray: zone.risk_level === "critical" ? "4 6" : undefined,
                    }}
                  >
                    <Tooltip direction="top">
                      <div className="text-sm">
                        <p className="font-semibold">{zone.label}</p>
                        <p>
                          {zone.device_count} appareil(s) • {formatMadValue(zone.total_roaming_cost_mad)}
                        </p>
                      </div>
                    </Tooltip>
                    <Popup {...popupProps} minWidth={290}>
                      <div className="space-y-3 p-4 text-sm text-slate-100">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{zone.label}</p>
                            <p className="text-slate-300">{zone.city ? `${zone.city}, ${zone.country}` : zone.country}</p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getRiskBadgeClasses(zone.risk_level)}`}>
                            {zone.risk_level}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-slate-200">
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Score zone</p>
                            <p className="mt-1 font-medium">{Math.min(100, 40 + zone.critical_alerts * 9 + zone.fraud_signals * 5)}/100</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Impact</p>
                            <p className="mt-1 font-medium">{formatMadValue(zone.total_roaming_cost_mad)}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Alertes</p>
                            <p className="mt-1 font-medium">{zone.critical_alerts}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Signaux</p>
                            <p className="mt-1 font-medium">{zone.fraud_signals}</p>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Action recommandee</p>
                          <p className="mt-1 text-sm font-medium leading-6 text-violet-100">
                            Auditer les lignes concentrees sur ce cluster et renforcer la surveillance roaming.
                          </p>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </Pane>
            ) : null}

            {showClusterGroups ? (
              <RoamingClusteredDeviceMarkers
                devices={devices}
                variant={variant}
                popupProps={popupProps}
                onSelectDevice={onSelectDevice}
              />
            ) : null}

            <Pane name="device-pane" style={{ zIndex: 520 }}>
              {visibleDevices.map((device, index) => {
                const radius = getDeviceRadius(device);
                const fillColor = getDevicePointColor(device);
                const sourceStrokeColor = getSourceStrokeColor(device.location_source);
                const deviceKey = getDeviceKey(device, index);

                return (
                  <Fragment key={deviceKey}>
                    {device.risk_level === "critical" ? (
                      <CircleMarker
                        center={[device.latitude, device.longitude]}
                        radius={radius + (pulseTick ? 4 : 2)}
                        pathOptions={{
                          color: fillColor,
                          fillColor,
                          fillOpacity: pulseTick ? 0.04 : 0.015,
                          opacity: pulseTick ? 0.24 : 0.1,
                          weight: 0.8,
                        }}
                      />
                    ) : null}

                    <CircleMarker
                      data-testid={variant === "fullscreen" ? "roaming-device-marker-fullscreen" : "roaming-device-marker"}
                      center={[device.latitude, device.longitude]}
                      radius={radius}
                      pathOptions={{
                        color: sourceStrokeColor,
                        fillColor,
                        fillOpacity: 0.78,
                        weight: 2,
                        dashArray:
                          device.location_source === "simulated_demo"
                            ? "4 6"
                            : device.location_source === "estimated_mcc"
                              ? "3 5"
                              : undefined,
                      }}
                      eventHandlers={
                        variant === "fullscreen" && onSelectDevice
                          ? {
                              click: () => {
                                onSelectDevice(device);
                              },
                            }
                          : undefined
                      }
                    >
                      {variant === "fullscreen" ? (
                        <Tooltip direction="top" offset={[0, -10]}>
                          <div className="text-sm">
                            <p className="font-semibold">{formatLocation(device)}</p>
                            <p>{device.phone_number ?? "Ligne de demonstration"}</p>
                          </div>
                        </Tooltip>
                      ) : (
                        <Popup {...popupProps} minWidth={330}>
                        <div className="space-y-3 p-4 text-sm text-slate-100">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-white">{formatLocation(device)}</p>
                              <p className="text-slate-300">{device.phone_number ?? "Ligne de demonstration"}</p>
                            </div>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getRiskBadgeClasses(device.risk_level)}`}>
                              {device.risk_level}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-slate-200">
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Type</p>
                              <p className="mt-1 font-medium">{formatCallZoneLabel(device.call_zone)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Ligne</p>
                              <p className="mt-1 font-medium">{device.line_id ? `#${device.line_id}` : "Non rattachee"}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Utilisateur</p>
                              <p className="mt-1 font-medium">{device.employee ?? "Non attribue"}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Operateur</p>
                              <p className="mt-1 font-medium">{device.operator}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Fraude</p>
                              <p className="mt-1 font-medium">{formatFraudFlagLabel(device.fraud_flag)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Cout</p>
                              <p className="mt-1 font-medium">{formatMadValue(device.call_cost_mad)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Score risque</p>
                              <p className="mt-1 font-medium">{formatRiskScore(device.fraud_risk_score_100)}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2 text-slate-200">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Origine reelle</p>
                              <p className="mt-1 font-medium">{formatLocationPair(device.location_origin, device.country_origin)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Destination</p>
                              <p className="mt-1 font-medium">{formatLocationPair(device.location_dest, device.country_dest)}</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Position affichee</p>
                              <p className="mt-1 font-medium">{formatLocation(device)}</p>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Cause probable</p>
                            <p className="mt-1 text-sm leading-6 text-white">{device.explanation}</p>
                          </div>

                          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-400">
                              <Brain className="h-3.5 w-3.5" />
                              <span>Action recommandee</span>
                            </div>
                            <p className="mt-2 text-sm font-medium leading-6 text-violet-100">{device.recommendation}</p>
                            {device.ai_reasoning.length > 0 ? (
                              <ul className="mt-2 space-y-1 text-sm text-violet-100">
                                {device.ai_reasoning.slice(0, 3).map((reason, reasonIndex) => (
                                  <li key={`${deviceKey}:reason:${reasonIndex}`}>• {reason}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-slate-200">
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Data</p>
                              <p className="mt-1 font-medium">{formatUsage(device.data_usage)}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Precision</p>
                              <p className="mt-1 font-medium">{device.location_precision_label}</p>
                            </div>
                          </div>

                          {device.last_event_at ? (
                            <p className="text-xs text-slate-400">Dernier signal: {formatCdrDateTime(device.last_event_at)}</p>
                          ) : null}
                        </div>
                        </Popup>
                      )}
                    </CircleMarker>
                  </Fragment>
                );
              })}
            </Pane>
          </MapContainer>

          {variant === "inline" && !hasCriticalZoneOverlay ? (
            <div
              data-testid="roaming-critical-zone-fallback"
              className="pointer-events-none absolute left-4 top-4 z-[72] max-w-xs rounded-2xl border border-amber-300/35 bg-slate-950/72 px-4 py-3 text-white backdrop-blur-xl"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">Zones critiques</p>
              <p className="mt-1 text-sm text-slate-100">Aucune zone critique détectée actuellement.</p>
            </div>
          ) : null}

          {variant === "inline" && showHeatmap && heatmap.length === 0 ? (
            <div className="pointer-events-none absolute right-4 top-4 z-[72] max-w-xs rounded-2xl border border-violet-300/24 bg-slate-950/70 px-4 py-3 text-white backdrop-blur-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-200">Heatmap</p>
              <p className="mt-1 text-sm text-slate-100">Aucune densite geospatiale exploitable actuellement.</p>
            </div>
          ) : null}

          {variant === "inline" && showFlows && movementFlows.length === 0 ? (
            <div className="pointer-events-none absolute right-4 bottom-4 z-[72] max-w-xs rounded-2xl border border-sky-300/24 bg-slate-950/70 px-4 py-3 text-white backdrop-blur-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200">Flux</p>
              <p className="mt-1 text-sm text-slate-100">Aucun flux geospatial disponible actuellement.</p>
            </div>
          ) : null}

          {canOpenFullscreen ? (
            <>
              <button
                type="button"
                aria-label="Ouvrir la carte en plein ecran"
                onClick={onOpenFullscreen}
                className="absolute inset-0 z-[50] cursor-zoom-in bg-transparent"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[60] bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.82))] px-4 py-4 text-white">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Geospatial preview</p>
                    <p className="mt-1 text-sm text-white/90">
                      Cliquez pour ouvrir la carte en centre operationnel fullscreen.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white">
                    <Maximize2 className="h-3.5 w-3.5" />
                    Agrandir
                  </span>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
});
RoamingMapCanvas.displayName = "RoamingMapCanvas";

export default function RoamingIntelligenceMap({ token, onSummaryChange }: RoamingIntelligenceMapProps) {
  const [filters, setFilters] = useState<FilterState>({
    country: "all",
    operator: "all",
    department: "all",
    riskLevel: "all",
    anomalyType: "all",
    minCostMad: "",
    periodFrom: "",
    periodTo: "",
    fraudOnly: "all",
  });
  const [data, setData] = useState<ApiRoamingIntelligenceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [isFlowEnabled, setIsFlowEnabled] = useState(false);
  const [showClusters, setShowClusters] = useState(true);
  const [pulseTick, setPulseTick] = useState(false);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [selectedFullscreenDevice, setSelectedFullscreenDevice] = useState<ApiRoamingIntelligenceDevice | null>(null);
  const [mapViewport, setMapViewport] = useState<MapViewState | null>(null);
  const [fullscreenResizeSignal, setFullscreenResizeSignal] = useState(0);
  const [activePanel, setActivePanel] = useState<RoamingPanelTab>("summary");

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPulseTick((currentValue) => !currentValue);
    }, 950);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!isFullscreenOpen) {
      return;
    }

    const timeoutIds = [0, 120, 320].map((delay) =>
      window.setTimeout(() => {
        setFullscreenResizeSignal((currentValue) => currentValue + 1);
      }, delay),
    );

    return () => {
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, [isFullscreenOpen]);

  useEffect(() => {
    let isMounted = true;

    async function loadMap() {
      if (!token) {
        if (isMounted) {
          setData(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await roamingApi.map(token, {
          country: filters.country !== "all" ? filters.country : undefined,
          operator: filters.operator !== "all" ? filters.operator : undefined,
          department: filters.department !== "all" ? filters.department : undefined,
          risk_level:
            filters.riskLevel !== "all"
              ? (filters.riskLevel as ApiRoamingIntelligenceDevice["risk_level"])
              : undefined,
          anomaly_type: filters.anomalyType !== "all" ? filters.anomalyType : undefined,
          min_cost_mad: filters.minCostMad.trim() === "" ? undefined : Number(filters.minCostMad),
          period_from: filters.periodFrom || undefined,
          period_to: filters.periodTo || undefined,
          fraud_only: filters.fraudOnly === "all" ? undefined : filters.fraudOnly === "true",
        });

        if (isMounted) {
          setData(response);
        }
      } catch (error) {
        if (isMounted) {
          setData(null);
          setErrorMessage(normalizeError(error, "Impossible de charger la Roaming Intelligence Map."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadMap();

    return () => {
      isMounted = false;
    };
  }, [filters, refreshTick, token]);

  const refreshIntervalSeconds = data?.live_refresh_interval_seconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS;

  useEffect(() => {
    if (!token || !isLiveMode || !(data?.live_supported ?? true)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setRefreshTick((currentValue) => currentValue + 1);
    }, refreshIntervalSeconds * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [data?.live_supported, isLiveMode, refreshIntervalSeconds, token]);

  const devices = data?.devices ?? [];
  const heatmap = data?.heatmap ?? [];
  const clusters = data?.clusters ?? [];
  const movementFlows = data?.movement_flows ?? [];
  const timeline = data?.timeline ?? [];
  const countryInsights = data?.country_insights ?? [];
  const criticalZones = data?.critical_zones ?? [];
  const renderableCriticalZones = useMemo(
    () => buildRenderableCriticalZones(criticalZones, clusters, heatmap),
    [clusters, criticalZones, heatmap],
  );
  const effectiveHeatmap = useMemo<ApiRoamingIntelligenceZone[]>(
    () =>
      heatmap.length > 0
        ? heatmap
        : renderableCriticalZones.map((zone) => ({
            label: zone.label,
            country: zone.country,
            city: zone.city,
            latitude: zone.latitude,
            longitude: zone.longitude,
            intensity: Math.max(zone.intensity || 0, zone.critical_alerts + zone.fraud_signals + 3),
            device_count: zone.active_devices,
            total_roaming_cost_mad: zone.total_roaming_cost_mad,
            critical_alerts: zone.critical_alerts,
            fraud_signals: zone.fraud_signals,
            risk_level: zone.risk_level,
          })),
    [heatmap, renderableCriticalZones],
  );
  const effectiveMovementFlows = useMemo<RenderableMovementFlow[]>(
    () => buildRenderableMovementFlows(movementFlows, renderableCriticalZones, devices),
    [devices, movementFlows, renderableCriticalZones],
  );
  const topCostCountries = data?.stats.top_cost_countries ?? [];
  const topCountry = topCostCountries[0] ?? null;
  const lastUpdated = data?.generated_at ? formatCdrDateTime(data.generated_at) : null;
  const maxTimelineCost = timeline.reduce(
    (currentMax, point) => Math.max(currentMax, point.total_roaming_cost_mad),
    0,
  );
  const liveLabel = isLiveMode ? "Surveillance temps reel active" : "Surveillance temps reel en pause";
  const liveDescription = isLiveMode
    ? `Actualisation toutes les ${refreshIntervalSeconds}s.`
    : "Passez en mode live pour relancer les mises a jour geospatiales.";

  const sortedCriticalZones = useMemo(
    () =>
      [...criticalZones].sort((leftZone, rightZone) => {
        if (leftZone.critical_alerts !== rightZone.critical_alerts) {
          return rightZone.critical_alerts - leftZone.critical_alerts;
        }
        if (leftZone.alerts !== rightZone.alerts) {
          return rightZone.alerts - leftZone.alerts;
        }
        return rightZone.total_roaming_cost_mad - leftZone.total_roaming_cost_mad;
      }),
    [criticalZones],
  );

  const topCriticalZone = sortedCriticalZones[0] ?? null;

  const topRiskDevice = useMemo(
    () =>
      [...devices].sort((leftDevice, rightDevice) => {
        if (leftDevice.risk_score !== rightDevice.risk_score) {
          return rightDevice.risk_score - leftDevice.risk_score;
        }
        if (leftDevice.alerts !== rightDevice.alerts) {
          return rightDevice.alerts - leftDevice.alerts;
        }
        return rightDevice.roaming_cost - leftDevice.roaming_cost;
      })[0] ?? null,
    [devices],
  );

  const intelligenceSubtitle = useMemo(() => {
    if (isLoading) {
      return "Construction carte intelligente...";
    }
    if (devices.length === 0) {
      return "Aucun appareil roaming ne correspond aux filtres actifs.";
    }
    return `${devices.length} appareil(s) roaming, ${effectiveMovementFlows.length} flux geographiques et ${criticalZones.length} zone(s) critique(s).`;
  }, [criticalZones.length, devices.length, effectiveMovementFlows.length, isLoading]);

  useEffect(() => {
    if (!onSummaryChange) {
      return;
    }

    if (!data || errorMessage) {
      onSummaryChange(null);
      return;
    }

    onSummaryChange({
      criticalZoneCount: criticalZones.length,
      criticalAlertCount: data.stats.critical_roaming_alerts,
      totalImpactMad: data.stats.total_roaming_cost_mad,
      topZoneImpactMad: topCriticalZone?.total_roaming_cost_mad ?? topCountry?.total_roaming_cost_mad ?? 0,
      topZoneLabel: topCriticalZone?.label ?? topCountry?.country ?? null,
      topZoneRecommendation: topCriticalZone?.explanation ?? countryInsights[0]?.explanation ?? null,
    });
  }, [countryInsights, criticalZones.length, data, errorMessage, onSummaryChange, topCountry, topCriticalZone]);

  const fullscreenPointCount =
    devices.length || effectiveHeatmap.length || renderableCriticalZones.length || clusters.length;

  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.MODE === "test") {
      return;
    }

    console.log("heatmapData", effectiveHeatmap.length);
    console.log("markers", devices.length);
    console.log("showHeatmap", showHeatmap);
    console.log("showClusters", showClusters);
  }, [devices.length, effectiveHeatmap.length, showClusters, showHeatmap]);

  const handleViewportChange = useCallback((nextViewport: MapViewState) => {
    setMapViewport((currentViewport) => {
      if (
        currentViewport &&
        currentViewport.zoom === nextViewport.zoom &&
        Math.abs(currentViewport.center[0] - nextViewport.center[0]) < 0.000001 &&
        Math.abs(currentViewport.center[1] - nextViewport.center[1]) < 0.000001
      ) {
        return currentViewport;
      }

      return nextViewport;
    });
  }, []);

  const openFullscreenMap = useCallback(() => {
    setIsFullscreenOpen(true);
  }, []);

  const handleFullscreenOpenChange = useCallback((nextOpen: boolean) => {
    setIsFullscreenOpen(nextOpen);
    if (!nextOpen) {
      setSelectedFullscreenDevice(null);
    }
  }, []);

  const handleSelectFullscreenDevice = useCallback((device: ApiRoamingIntelligenceDevice) => {
    setSelectedFullscreenDevice((currentDevice) => {
      if (
        currentDevice &&
        currentDevice.line_id === device.line_id &&
        currentDevice.phone_number === device.phone_number &&
        currentDevice.last_event_at === device.last_event_at
      ) {
        return currentDevice;
      }

      return device;
    });
  }, []);

  const closeFullscreenDetailPanel = useCallback(() => {
    setSelectedFullscreenDevice(null);
  }, []);

  const toggleHeatmap = useCallback(() => {
    setShowHeatmap((currentValue) => !currentValue);
  }, []);

  const toggleFlow = useCallback(() => {
    setIsFlowEnabled((currentValue) => !currentValue);
  }, []);

  const toggleClusters = useCallback(() => {
    setShowClusters((currentValue) => {
      const nextValue = !currentValue;
      if (nextValue) {
        setSelectedFullscreenDevice(null);
      }
      return nextValue;
    });
  }, []);

  return (
    <>
      <section
        id="roaming-map"
        data-roaming-map-id="roaming-intelligence-map"
        className="bc-roaming-shell rounded-[30px] border border-[#DCE5F1] p-4 shadow-[0_30px_80px_-52px_rgba(15,23,42,0.42)] lg:p-5"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#6D28D9]">
              <TowerControl className="h-3.5 w-3.5" />
              Roaming Intelligence Map
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-[#0F172A]">AI Operations Center geospatial</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[#64748B]">
              Vue SOC roaming compacte avec preview geospatial, clusters critiques, heatmap d'exposition
              et ouverture fullscreen pour l'analyse detaillee.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full border-blue-200 bg-blue-50 px-3 py-1 text-[#2563EB]">
              <Radar className="mr-1.5 h-3.5 w-3.5" />
              {intelligenceSubtitle}
            </Badge>
            {lastUpdated ? (
              <Badge className="rounded-full border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                Maj {lastUpdated}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
          <div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-600 via-[#6D28D9] to-[#2563EB] p-4 text-white shadow-xl shadow-violet-500/20">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/70">Roaming actifs</p>
              <MapPinned className="h-4 w-4 text-white" />
            </div>
            <p className="mt-2 text-2xl font-bold">{isLoading ? "--" : data?.stats.active_roaming_devices ?? 0}</p>
            <p className="mt-1 text-xs text-white/75">Appareils exposes</p>
          </div>

          <div className="bc-roaming-card rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Impact roaming</p>
              <Globe2 className="h-4 w-4 text-[#2563EB]" />
            </div>
            <p className="mt-2 text-xl font-bold text-[#0F172A]">
              {isLoading ? "--" : formatMadValue(data?.stats.total_roaming_cost_mad ?? 0)}
            </p>
            <p className="mt-1 text-xs text-[#64748B]">Exposition du perimetre</p>
          </div>

          <div className="bc-roaming-card rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Alertes critiques</p>
              <ShieldAlert className="h-4 w-4 text-[#DC2626]" />
            </div>
            <p className="mt-2 text-xl font-bold text-[#DC2626]">{isLoading ? "--" : data?.stats.critical_roaming_alerts ?? 0}</p>
            <p className="mt-1 text-xs text-[#64748B]">Escalade immediate</p>
          </div>

          <div className="bc-roaming-card rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Zone dominante</p>
              <Radar className="h-4 w-4 text-[#7C3AED]" />
            </div>
            <p className="mt-2 text-lg font-bold text-[#0F172A]">{isLoading ? "--" : topCriticalZone?.label ?? topCountry?.country ?? "N/A"}</p>
            <p className="mt-1 text-xs text-[#64748B]">
              {isLoading
                ? "Scoring IA..."
                : topCriticalZone
                  ? `${formatMadValue(topCriticalZone.total_roaming_cost_mad)} • ${topCriticalZone.active_devices} ligne(s)`
                  : topCountry
                    ? `${formatMadValue(topCountry.total_roaming_cost_mad)} • ${topCountry.device_count} appareil(s)`
                    : "Aucune zone dominante."}
            </p>
          </div>

          <div className="bc-roaming-card rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Fraudes roaming</p>
              <AlertTriangle className="h-4 w-4 text-[#F97316]" />
            </div>
            <p className="mt-2 text-xl font-bold text-[#0F172A]">{isLoading ? "--" : data?.stats.fraud_roaming_detected ?? 0}</p>
            <p className="mt-1 text-xs text-[#64748B]">Signaux consolides</p>
          </div>
        </div>

        <div className="mt-4 rounded-[28px] border border-white/70 bg-white/80 p-4 shadow-[0_20px_60px_-42px_rgba(15,23,42,0.34)] backdrop-blur-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Console roaming</p>
              <p className="mt-2 text-sm text-[#64748B]">Filtrage geospatial, mode live et ouverture grand format.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={isLiveMode ? "default" : "outline"}
                className={
                  isLiveMode
                    ? "h-9 rounded-xl bg-[linear-gradient(135deg,#2563EB,#7C3AED)] text-white"
                    : "h-9 rounded-xl border-[#DCE5F1] bg-white"
                }
                onClick={() => setIsLiveMode((currentValue) => !currentValue)}
              >
                <Activity className="mr-2 h-4 w-4" />
                {isLiveMode ? "Live ON" : "Live OFF"}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-[#DCE5F1] bg-white"
                onClick={() => setRefreshTick((currentValue) => currentValue + 1)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Actualiser
              </Button>

              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-[#DCE5F1] bg-white"
                onClick={openFullscreenMap}
              >
                <Maximize2 className="mr-2 h-4 w-4" />
                Agrandir la carte
              </Button>

              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-[#DCE5F1] bg-white"
                onClick={() =>
                  setFilters({
                    country: "all",
                    operator: "all",
                    department: "all",
                    riskLevel: "all",
                    anomalyType: "all",
                    minCostMad: "",
                    periodFrom: "",
                    periodTo: "",
                    fraudOnly: "all",
                  })
                }
              >
                Reinitialiser
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] px-4 py-2.5 text-sm text-[#475569]">
            <span className="inline-flex items-center gap-2 text-[#0F172A]">
              <span className={`bc-roaming-live-dot ${isLiveMode ? "text-[#16A34A]" : "text-[#94A3B8]"}`} />
              {liveLabel}
            </span>
            <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
            <span>{liveDescription}</span>
            <span className="h-1 w-1 rounded-full bg-[#94A3B8]" />
            <span>
              GPS {data?.stats.exact_gps_locations ?? 0} • Estime {data?.stats.estimated_locations ?? 0} • Simule{" "}
              {data?.stats.simulated_locations ?? 0}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-8">
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Pays</span>
              <select
                className="h-11 w-full rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                value={filters.country}
                onChange={(event) => setFilters((current) => ({ ...current, country: event.target.value }))}
              >
                <option value="all">Tous</option>
                {(data?.filters.countries ?? []).map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Operateur</span>
              <select
                className="h-11 w-full rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                value={filters.operator}
                onChange={(event) => setFilters((current) => ({ ...current, operator: event.target.value }))}
              >
                <option value="all">Tous</option>
                {(data?.filters.operators ?? []).map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Departement</span>
              <select
                className="h-11 w-full rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                value={filters.department}
                onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))}
              >
                <option value="all">Tous</option>
                {(data?.filters.departments ?? []).map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Risque</span>
              <select
                className="h-11 w-full rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                value={filters.riskLevel}
                onChange={(event) => setFilters((current) => ({ ...current, riskLevel: event.target.value }))}
              >
                <option value="all">Tous</option>
                {(data?.filters.risk_levels ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Anomalie</span>
              <select
                className="h-11 w-full rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                value={filters.anomalyType}
                onChange={(event) => setFilters((current) => ({ ...current, anomalyType: event.target.value }))}
              >
                <option value="all">Toutes</option>
                {(data?.filters.anomaly_types ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Fraude</span>
              <select
                className="h-11 w-full rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                value={filters.fraudOnly}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, fraudOnly: event.target.value as FilterState["fraudOnly"] }))
                }
              >
                <option value="all">Tous</option>
                <option value="true">Fraude uniquement</option>
                <option value="false">Sans fraude</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Cout min</span>
              <input
                type="number"
                min="0"
                step="10"
                className="h-11 w-full rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                value={filters.minCostMad}
                onChange={(event) => setFilters((current) => ({ ...current, minCostMad: event.target.value }))}
                placeholder="300"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#64748B]">Periode</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                  value={filters.periodFrom}
                  onChange={(event) => setFilters((current) => ({ ...current, periodFrom: event.target.value }))}
                />
                <input
                  type="date"
                  className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm text-[#0F172A] outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                  value={filters.periodTo}
                  onChange={(event) => setFilters((current) => ({ ...current, periodTo: event.target.value }))}
                />
              </div>
            </label>
          </div>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.72fr)_340px]">
          <div className="bc-roaming-card rounded-[28px] p-4">
            <div className="flex flex-col gap-3 border-b border-[#E2E8F0] px-1 pb-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#0F172A]">Cartographie geospatiale IA</h3>
                <p className="mt-1 text-sm text-[#64748B]">
                  Preview compacte des clusters, flux et zones d'exposition.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  data-testid="roaming-map-heatmap-inline-button"
                  className={`h-9 rounded-xl border px-3 transition-all ${
                    showHeatmap
                      ? "border-violet-300 bg-violet-50 text-[#6D28D9] shadow-[0_10px_24px_-18px_rgba(109,40,217,0.55)]"
                      : "border-[#DCE5F1] bg-white text-[#0F172A]"
                  }`}
                  onClick={toggleHeatmap}
                >
                  {showHeatmap ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                  Heatmap
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="roaming-map-flow-inline-button"
                  className={`h-9 rounded-xl border px-3 transition-all ${
                    isFlowEnabled
                      ? "border-sky-300 bg-sky-50 text-[#0369A1] shadow-[0_10px_24px_-18px_rgba(14,165,233,0.5)]"
                      : "border-[#DCE5F1] bg-white text-[#0F172A]"
                  }`}
                  onClick={toggleFlow}
                >
                  {isFlowEnabled ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                  Flux
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="roaming-map-clusters-inline-button"
                  className={`h-9 rounded-xl border px-3 transition-all ${
                    showClusters
                      ? "border-emerald-300 bg-emerald-50 text-[#047857] shadow-[0_10px_24px_-18px_rgba(5,150,105,0.55)]"
                      : "border-[#DCE5F1] bg-white text-[#0F172A]"
                  }`}
                  onClick={toggleClusters}
                >
                  {showClusters ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
                  Clusters
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-[#DCE5F1] bg-white px-3"
                  onClick={openFullscreenMap}
                >
                  <Maximize2 className="mr-2 h-4 w-4" />
                  Fullscreen
                </Button>
              </div>
            </div>

            <div className="mt-4">
              <RoamingMapCanvas
                devices={devices}
                heatmap={effectiveHeatmap}
                clusters={clusters}
                criticalZones={renderableCriticalZones}
                movementFlows={effectiveMovementFlows}
                isLoading={isLoading}
                pulseTick={pulseTick}
                showHeatmap={showHeatmap}
                showFlows={isFlowEnabled}
                showClusters={showClusters}
                heightClassName="h-[420px] md:h-[500px]"
                interactive={false}
                onOpenFullscreen={openFullscreenMap}
                onViewportChange={handleViewportChange}
              />
            </div>
          </div>

          <div className="bc-roaming-card rounded-[28px] p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#6D28D9]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Console IA geospatiale</h3>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(
                [
                  { id: "summary", label: "Resume", icon: Sparkles },
                  { id: "timeline", label: "Timeline", icon: Route },
                  { id: "zones", label: "Zones", icon: Clock3 },
                  { id: "sources", label: "Sources", icon: Globe2 },
                ] satisfies Array<{ id: RoamingPanelTab; label: string; icon: typeof Sparkles }>
              ).map((tab) => {
                const Icon = tab.icon;
                const isActive = activePanel === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActivePanel(tab.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      isActive
                        ? "border-violet-200 bg-violet-50 text-[#6D28D9]"
                        : "border-[#DCE5F1] bg-white text-[#64748B] hover:border-violet-200 hover:text-[#6D28D9]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              {activePanel === "summary" ? (
                <div className="space-y-3">
                  <div className="rounded-3xl border border-red-200 bg-[linear-gradient(135deg,#fff1f2,#ffffff)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#DC2626]">Zone la plus risquee</p>
                    <p className="mt-2 text-lg font-semibold text-[#0F172A]">{topCriticalZone?.label ?? topCountry?.country ?? "Aucune"}</p>
                    <p className="mt-1 text-sm text-[#475569]">
                      {topCriticalZone
                        ? `${formatMadValue(topCriticalZone.total_roaming_cost_mad)} • ${topCriticalZone.critical_alerts} alertes critiques`
                        : topCountry
                          ? `${formatMadValue(topCountry.total_roaming_cost_mad)} • ${topCountry.device_count} appareil(s)`
                          : "Pas de concentration majeure."}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#64748B]">
                      {topCriticalZone?.explanation ?? countryInsights[0]?.explanation ?? "Le moteur attend des signaux roaming pour formuler une recommandation zone."}
                    </p>
                  </div>

                  <div className="bc-roaming-scroll max-h-[312px] space-y-3 overflow-y-auto pr-1">
                    {countryInsights.length === 0 ? (
                      <div className="bc-roaming-card p-4 text-sm text-[#64748B]">Aucun pays prioritaire sur la selection courante.</div>
                    ) : (
                      countryInsights.slice(0, 3).map((insight) => (
                        <div key={insight.country} className="bc-roaming-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[#0F172A]">{insight.country}</p>
                              <p className="mt-1 text-sm text-[#64748B]">
                                {formatMadValue(insight.total_roaming_cost_mad)} • {insight.active_devices} appareil(s)
                              </p>
                            </div>
                            <Badge className={`rounded-full border px-2.5 py-1 ${getRiskBadgeClasses(insight.risk_level)}`}>
                              {insight.risk_level}
                            </Badge>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-[#64748B]">{insight.explanation}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {activePanel === "timeline" ? (
                <div className="bc-roaming-scroll max-h-[430px] space-y-3 overflow-y-auto pr-1">
                  {timeline.length === 0 ? (
                    <div className="bc-roaming-card p-4 text-sm text-[#64748B]">
                      Aucune timeline disponible sur la periode selectionnee.
                    </div>
                  ) : (
                    timeline.map((point) => <TimelineBar key={point.bucket} point={point} maxCost={maxTimelineCost} />)
                  )}
                </div>
              ) : null}

              {activePanel === "zones" ? (
                <div className="space-y-3">
                  <div className="bc-roaming-scroll max-h-[320px] space-y-3 overflow-y-auto pr-1">
                    {sortedCriticalZones.length === 0 ? (
                      <div className="bc-roaming-card p-4 text-sm text-[#64748B]">
                        Aucune zone critique consolidee sur la selection courante.
                      </div>
                    ) : (
                      sortedCriticalZones.map((zone) => <CriticalZoneCard key={zone.label} zone={zone} />)
                    )}
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-[linear-gradient(180deg,#FFFDF5,#FFFFFF)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#B45309]">Confidentialite</p>
                    <p className="mt-2 text-sm leading-6 text-[#64748B]">
                      {data?.privacy_notice ??
                        "FleetConnect n'affiche jamais une position GPS exacte sans consentement explicite."}
                    </p>
                  </div>
                </div>
              ) : null}

              {activePanel === "sources" ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">Telemetrie</p>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-[#475569]">
                      <div>
                        <p className="text-xs text-[#64748B]">GPS exact</p>
                        <p className="mt-1 font-semibold text-[#0F172A]">{data?.stats.exact_gps_locations ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#64748B]">Estime</p>
                        <p className="mt-1 font-semibold text-[#0F172A]">{data?.stats.estimated_locations ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#64748B]">Simule</p>
                        <p className="mt-1 font-semibold text-[#0F172A]">{data?.stats.simulated_locations ?? 0}</p>
                      </div>
                    </div>
                  </div>

                  <LegendItem
                    label="GPS exact"
                    description="Position reelle uniquement si latitude/longitude existent et si le consentement est explicite."
                    color="#2563EB"
                  />
                  <LegendItem
                    label="Position estimee"
                    description="Position derivee via pays, ville roaming ou MCC/MNC operateur."
                    color="#334155"
                  />
                  <LegendItem
                    label="Position simulee"
                    description="Position de demonstration PFE quand aucune geolocalisation exploitable n'est disponible."
                    color="#7C3AED"
                    dashed
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <Dialog open={isFullscreenOpen} onOpenChange={handleFullscreenOpenChange}>
        <DialogContent className="[&>button]:hidden !left-0 !top-0 h-screen w-screen !max-w-none !translate-x-0 !translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 shadow-none duration-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 sm:!max-w-none">
          <DialogTitle className="sr-only">Cartographie geospatiale IA fullscreen</DialogTitle>
          <DialogDescription className="sr-only">
            Carte geospatiale plein ecran avec controles fermer, reset zoom et zoom Leaflet.
          </DialogDescription>

          <div data-testid="roaming-map-fullscreen" className="relative h-screen w-screen overflow-hidden bg-black">
            {fullscreenPointCount > 0 ? (
              <div className="pointer-events-none absolute left-4 top-4 z-[760]">
                <Badge className="rounded-full border border-white/10 bg-slate-950/78 px-3 py-1.5 text-[12px] text-white backdrop-blur-xl">
                  {fullscreenPointCount} point{fullscreenPointCount > 1 ? "s" : ""}
                </Badge>
              </div>
            ) : null}

            <div className="absolute right-4 top-4 z-[760] flex items-center gap-2">
              <button
                type="button"
                onClick={toggleHeatmap}
                data-testid="roaming-map-heatmap-fullscreen-button"
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium backdrop-blur-xl transition ${
                  showHeatmap
                    ? "border-violet-300/60 bg-violet-500/16 text-violet-100 hover:bg-violet-500/22"
                    : "border-white/10 bg-slate-950/78 text-white hover:bg-slate-900/90"
                }`}
              >
                {showHeatmap ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                Heatmap
              </button>
              <button
                type="button"
                onClick={toggleFlow}
                data-testid="roaming-map-flow-fullscreen-button"
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium backdrop-blur-xl transition ${
                  isFlowEnabled
                    ? "border-sky-300/60 bg-sky-500/16 text-sky-100 hover:bg-sky-500/22"
                    : "border-white/10 bg-slate-950/78 text-white hover:bg-slate-900/90"
                }`}
              >
                {isFlowEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                Flux
              </button>
              <button
                type="button"
                onClick={toggleClusters}
                data-testid="roaming-map-clusters-fullscreen-button"
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium backdrop-blur-xl transition ${
                  showClusters
                    ? "border-emerald-300/60 bg-emerald-500/16 text-emerald-100 hover:bg-emerald-500/22"
                    : "border-white/10 bg-slate-950/78 text-white hover:bg-slate-900/90"
                }`}
              >
                {showClusters ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                Clusters
              </button>
              <button
                type="button"
                onClick={() => handleFullscreenOpenChange(false)}
                data-testid="roaming-map-close-fullscreen-button"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/78 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur-xl transition hover:bg-slate-900/90"
              >
                Fermer
              </button>
            </div>

            <RoamingMapCanvas
              devices={devices}
              heatmap={effectiveHeatmap}
              clusters={clusters}
              criticalZones={renderableCriticalZones}
              movementFlows={effectiveMovementFlows}
              isLoading={isLoading}
              pulseTick={pulseTick}
              showHeatmap={showHeatmap}
              showFlows={isFlowEnabled}
              showClusters={showClusters}
              heightClassName="h-screen"
              interactive
              variant="fullscreen"
              resizeSignal={fullscreenResizeSignal}
              savedViewport={mapViewport}
              onViewportChange={handleViewportChange}
              onSelectDevice={handleSelectFullscreenDevice}
            />
          </div>
        </DialogContent>
      </Dialog>

      {isFullscreenOpen && selectedFullscreenDevice ? (
        <RoamingMapDetailPanel device={selectedFullscreenDevice} onClose={closeFullscreenDetailPanel} />
      ) : null}
    </>
  );
}
