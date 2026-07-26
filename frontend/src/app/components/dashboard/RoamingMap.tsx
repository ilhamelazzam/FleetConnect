import "leaflet/dist/leaflet.css";

import {
  AlertTriangle,
  Globe2,
  Loader2,
  MapPinned,
  Route,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

import {
  cdrAnalyticsApi,
  type ApiCdrMapFlow,
  type ApiCdrMapPoint,
  type ApiCdrMapResponse,
} from "../../lib/api";
import { formatMadValue } from "../../lib/cdr-analytics";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const MOROCCO_CENTER: [number, number] = [31.7917, -7.0926];
const MOROCCO_ZOOM = 6;

type MapMode = "origins" | "destinations" | "flows";
type MapScope = "morocco" | "international" | "all";

export interface RoamingMapSummary {
  criticalZoneCount: number;
  criticalAlertCount: number;
  totalImpactMad: number;
  topZoneImpactMad: number;
  topZoneLabel: string | null;
  topZoneRecommendation: string | null;
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}

function getPointColor(point: ApiCdrMapPoint): string {
  if (point.risk_score >= 80 || point.alerts >= 10) {
    return "#DC2626";
  }
  if (point.risk_score >= 60 || point.alerts >= 6) {
    return "#F97316";
  }
  if (point.risk_score >= 40 || point.alerts >= 3) {
    return "#CA8A04";
  }
  return "#2563EB";
}

function getPointRadius(point: ApiCdrMapPoint): number {
  return Math.min(18, Math.max(8, 8 + point.alerts * 0.45 + point.count * 0.1));
}

function getFlowColor(flow: ApiCdrMapFlow): string {
  if (flow.risk_score >= 80) {
    return "#DC2626";
  }
  if (flow.risk_score >= 60) {
    return "#F97316";
  }
  return "#2563EB";
}

function MapViewportController({
  mode,
  points,
  flows,
  center,
  zoom,
}: {
  mode: MapMode;
  points: ApiCdrMapPoint[];
  flows: ApiCdrMapFlow[];
  center: number[];
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    const coordinates =
      mode === "flows"
        ? flows.flatMap((flow) => [
            [flow.origin_latitude, flow.origin_longitude],
            [flow.destination_latitude, flow.destination_longitude],
          ])
        : points.map((point) => [point.latitude, point.longitude]);

    if (coordinates.length === 0) {
      map.setView([center[0] ?? MOROCCO_CENTER[0], center[1] ?? MOROCCO_CENTER[1]], zoom, {
        animate: true,
      });
      return;
    }

    if (coordinates.length === 1) {
      const [latitude, longitude] = coordinates[0];
      map.setView([latitude, longitude], Math.max(zoom, 7), { animate: true });
      return;
    }

    map.fitBounds(coordinates as [number, number][], {
      padding: [28, 28],
      maxZoom: 8,
      animate: true,
    });
  }, [center, flows, map, mode, points, zoom]);

  return null;
}

export default function RoamingMap({
  token,
  onSummaryChange,
}: {
  token: string | null;
  onSummaryChange?: (summary: RoamingMapSummary | null) => void;
}) {
  const [mode, setMode] = useState<MapMode>("origins");
  const [scope, setScope] = useState<MapScope>("morocco");
  const [operator, setOperator] = useState("all");
  const [department, setDepartment] = useState("all");
  const [riskLevel, setRiskLevel] = useState("all");
  const [region, setRegion] = useState("all");
  const [data, setData] = useState<ApiCdrMapResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        const response = await cdrAnalyticsApi.map(token, {
          mode,
          scope,
          operator: operator !== "all" ? operator : undefined,
          department: department !== "all" ? department : undefined,
          risk_level: riskLevel !== "all" ? riskLevel : undefined,
          region: region !== "all" ? region : undefined,
        });

        if (isMounted) {
          setData(response);
        }
      } catch (error) {
        if (isMounted) {
          setData(null);
          setErrorMessage(normalizeError(error, "Impossible de charger la carte CDR."));
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
  }, [department, mode, operator, region, riskLevel, scope, token]);

  const points = data?.points ?? [];
  const flows = data?.flows ?? [];
  const topPoint = points[0] ?? null;
  const summary = useMemo<RoamingMapSummary | null>(() => {
    if (!data) {
      return null;
    }

    return {
      criticalZoneCount: points.filter((point) => point.alerts > 0).length,
      criticalAlertCount: points.reduce((total, point) => total + point.alerts, 0),
      totalImpactMad: points.reduce((total, point) => total + point.estimated_loss_mad, 0),
      topZoneImpactMad: topPoint?.estimated_loss_mad ?? 0,
      topZoneLabel: topPoint ? `${topPoint.city} (${topPoint.region})` : null,
      topZoneRecommendation: topPoint?.top_recommendation ?? null,
    };
  }, [data, points, topPoint]);

  useEffect(() => {
    onSummaryChange?.(summary);
  }, [onSummaryChange, summary]);

  return (
    <section className="rounded-[30px] border border-[#DCE5F1] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.14),transparent_30%),linear-gradient(180deg,#FFFFFF,#F8FAFC)] p-6 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.32)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#6D28D9]">
            <MapPinned className="h-3.5 w-3.5" />
            Cartographie CDR Maroc
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-[#0F172A]">
            Origines, destinations et flux reconstitues
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748B]">
            Vue recentrée sur le Maroc, uniquement avec les villes réellement reconnues dans le
            référentiel métier. Les localisations inconnues restent listées séparément.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Points reconnus",
              value: `${points.length}`,
              helper: mode === "flows" ? "villes reliées" : "villes affichées",
              icon: MapPinned,
            },
            {
              label: "Alertes",
              value: `${summary?.criticalAlertCount ?? 0}`,
              helper: "incidents agrégés",
              icon: ShieldAlert,
            },
            {
              label: "Impact",
              value: formatMadValue(summary?.totalImpactMad ?? 0),
              helper: "perte financière estimée",
              icon: AlertTriangle,
            },
            {
              label: "Inconnues",
              value: `${data?.unknown_locations.length ?? 0}`,
              helper: "à corriger dans la source",
              icon: Globe2,
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="rounded-3xl border border-[#DCE5F1] bg-white/90 p-4 backdrop-blur-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                    {item.label}
                  </p>
                  <Icon className="h-4 w-4 text-[#2563EB]" />
                </div>
                <p className="mt-3 text-2xl font-bold text-[#0F172A]">
                  {isLoading ? "--" : item.value}
                </p>
                <p className="mt-2 text-sm text-[#64748B]">{item.helper}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 rounded-[26px] border border-[#DCE5F1] bg-white/90 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as MapMode)}
            className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          >
            {(data?.filters.modes ?? ["origins", "destinations", "flows"]).map((item) => (
              <option key={item} value={item}>
                {item === "origins"
                  ? "Origines Maroc"
                  : item === "destinations"
                    ? "Destinations"
                    : "Flux"}
              </option>
            ))}
          </select>

          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as MapScope)}
            className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          >
            {(data?.filters.scopes ?? ["morocco", "international", "all"]).map((item) => (
              <option key={item} value={item}>
                {item === "morocco" ? "Vue Maroc" : item === "international" ? "International" : "Tous"}
              </option>
            ))}
          </select>

          <select
            value={operator}
            onChange={(event) => setOperator(event.target.value)}
            className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          >
            <option value="all">Tous les operateurs</option>
            {(data?.filters.operators ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          >
            <option value="all">Tous les departements</option>
            {(data?.filters.departments ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={riskLevel}
            onChange={(event) => setRiskLevel(event.target.value)}
            className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          >
            <option value="all">Tous les risques</option>
            {(data?.filters.risk_levels ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          <select
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            className="h-11 rounded-2xl border border-[#DCE5F1] bg-white px-3 text-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          >
            <option value="all">Toutes les regions</option>
            {(data?.filters.regions ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_360px]">
        <div className="rounded-[28px] border border-[#DCE5F1] bg-white/90 p-4 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.3)]">
          <div className="flex items-center justify-between gap-4 border-b border-[#E2E8F0] px-1 pb-4">
            <div>
              <h3 className="text-lg font-semibold text-[#0F172A]">Carte Maroc</h3>
              <p className="mt-1 text-sm text-[#64748B]">
                {mode === "flows"
                  ? "Les flux sont tracés uniquement lorsque l'origine et la destination sont toutes deux reconnues."
                  : "Les marqueurs affichent les villes réellement reconnues dans le référentiel marocain."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-[#DCE5F1] bg-white"
              onClick={() => {
                setMode("origins");
                setScope("morocco");
                setOperator("all");
                setDepartment("all");
                setRiskLevel("all");
                setRegion("all");
              }}
            >
              Reinitialiser
            </Button>
          </div>

          <div className="relative mt-4 overflow-hidden rounded-[24px] border border-[#DCE5F1] bg-[#EEF2FF]">
            {isLoading ? (
              <div className="flex h-[540px] items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#6D28D9]" />
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">Cartographie CDR en cours...</p>
                    <p className="mt-1 text-sm text-[#64748B]">
                      Agrégation des villes marocaines, alertes et pertes estimées.
                    </p>
                  </div>
                </div>
              </div>
            ) : mode !== "flows" && points.length === 0 ? (
              <div className="flex h-[540px] items-center justify-center px-6 text-center">
                <div className="max-w-md">
                  <AlertTriangle className="mx-auto h-8 w-8 text-[#F59E0B]" />
                  <p className="mt-3 text-lg font-semibold text-[#0F172A]">Aucun point cartographiable</p>
                  <p className="mt-2 text-sm leading-6 text-[#64748B]">
                    Elargissez les filtres ou vérifiez la liste des localisations inconnues à droite.
                  </p>
                </div>
              </div>
            ) : mode === "flows" && flows.length === 0 ? (
              <div className="flex h-[540px] items-center justify-center px-6 text-center">
                <div className="max-w-md">
                  <Route className="mx-auto h-8 w-8 text-[#2563EB]" />
                  <p className="mt-3 text-lg font-semibold text-[#0F172A]">Aucun flux traçable</p>
                  <p className="mt-2 text-sm leading-6 text-[#64748B]">
                    Les flux n’apparaissent que lorsque l’origine et la destination ont toutes deux des coordonnées métier connues.
                  </p>
                </div>
              </div>
            ) : (
              <MapContainer
                center={MOROCCO_CENTER}
                zoom={MOROCCO_ZOOM}
                className="h-[540px] w-full"
                scrollWheelZoom={false}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapViewportController
                  mode={mode}
                  points={points}
                  flows={flows}
                  center={data?.center ?? MOROCCO_CENTER}
                  zoom={data?.zoom ?? MOROCCO_ZOOM}
                />

                {mode === "flows"
                  ? flows.map((flow) => (
                      <Polyline
                        key={`${flow.origin_city}-${flow.destination_city}`}
                        positions={[
                          [flow.origin_latitude, flow.origin_longitude],
                          [flow.destination_latitude, flow.destination_longitude],
                        ]}
                        pathOptions={{
                          color: getFlowColor(flow),
                          weight: Math.min(7, 2 + flow.alerts * 0.35),
                          opacity: 0.78,
                        }}
                      >
                        <Popup>
                          <div className="space-y-2 text-sm">
                            <p className="font-semibold text-[#0F172A]">
                              {flow.origin_city} → {flow.destination_city}
                            </p>
                            <p className="text-[#475569]">
                              {flow.count} evenement(s) · {flow.alerts} alerte(s)
                            </p>
                            <p className="text-[#475569]">
                              Score moyen {flow.risk_score.toFixed(1)} · perte {formatMadValue(flow.estimated_loss_mad)}
                            </p>
                          </div>
                        </Popup>
                      </Polyline>
                    ))
                  : points.map((point) => (
                      <CircleMarker
                        key={`${point.city}-${point.region}`}
                        center={[point.latitude, point.longitude]}
                        radius={getPointRadius(point)}
                        pathOptions={{
                          fillColor: getPointColor(point),
                          fillOpacity: 0.82,
                          color: "#0F172A",
                          weight: 1,
                        }}
                      >
                        <Popup minWidth={260}>
                          <div className="space-y-3 text-sm">
                            <div>
                              <p className="font-semibold text-[#0F172A]">{point.city}</p>
                              <p className="text-[#64748B]">{point.region}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[#334155]">
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Lignes</p>
                                <p className="mt-1 font-medium">{point.count}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Alertes</p>
                                <p className="mt-1 font-medium">{point.alerts}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Score</p>
                                <p className="mt-1 font-medium">{point.risk_score.toFixed(1)}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-[#64748B]">Perte</p>
                                <p className="mt-1 font-medium">{formatMadValue(point.estimated_loss_mad)}</p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-violet-100 bg-violet-50 px-3 py-2 text-[#4C1D95]">
                              {point.top_recommendation}
                            </div>
                          </div>
                        </Popup>
                      </CircleMarker>
                    ))}
              </MapContainer>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-[#DCE5F1] bg-white/90 p-5 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.28)]">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#6D28D9]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Hotspots marocains</h3>
            </div>
            <div className="mt-4 space-y-3">
              {points.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#DCE5F1] bg-[#F8FAFC] px-4 py-5 text-sm text-[#64748B]">
                  Aucun hotspot visible sur la sélection courante.
                </div>
              ) : (
                points.slice(0, 5).map((point) => (
                  <div
                    key={`${point.city}-${point.region}-summary`}
                    className="rounded-2xl border border-[#E2E8F0] bg-[linear-gradient(180deg,#FFFFFF,#F8FAFC)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{point.city}</p>
                        <p className="mt-1 text-sm text-[#64748B]">{point.region}</p>
                      </div>
                      <Badge className="rounded-full border-red-200 bg-red-50 px-3 py-1 text-[#DC2626]">
                        {point.alerts} alertes
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-[#475569]">
                      {formatMadValue(point.estimated_loss_mad)} · score moyen {point.risk_score.toFixed(1)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-[#DCE5F1] bg-white/90 p-5 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.28)]">
            <div className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-[#2563EB]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Localisations inconnues</h3>
            </div>
            <div className="mt-4 space-y-3">
              {data?.unknown_locations.length ? (
                data.unknown_locations.slice(0, 6).map((item) => (
                  <div
                    key={`${item.cdr_row_id}-${item.field}-${item.raw_value}`}
                    className="rounded-2xl border border-amber-200 bg-[linear-gradient(180deg,#FFFDF5,#FFFFFF)] p-4"
                  >
                    <p className="font-semibold text-[#0F172A]">
                      {item.raw_value || "Valeur vide"} · {item.country || "Pays inconnu"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#64748B]">{item.reason}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-[#DCE5F1] bg-[#F8FAFC] px-4 py-5 text-sm text-[#64748B]">
                  Aucune ville inconnue sur la sélection courante.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
