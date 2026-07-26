import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RoamingIntelligenceMap from "../RoamingIntelligenceMap";
import type { ApiRoamingIntelligenceResponse } from "../../../lib/api";

const { mapMethods, roamingMapMock } = vi.hoisted(() => ({
  mapMethods: {
    getContainer: vi.fn(() => ({ isConnected: true })),
    _loaded: true,
    _mapPane: { _leaflet_pos: { x: 0, y: 0 } },
    getCenter: vi.fn(() => ({ lat: 33.5731, lng: -7.5898 })),
    getZoom: vi.fn(() => 6),
    whenReady: vi.fn((callback?: () => void) => {
      callback?.();
    }),
    on: vi.fn(),
    off: vi.fn(),
    stop: vi.fn(),
    invalidateSize: vi.fn(),
    fitBounds: vi.fn(),
    flyToBounds: vi.fn(),
    setView: vi.fn(),
    flyTo: vi.fn(),
  },
  roamingMapMock: vi.fn(),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="mock-map-container" className={className}>
      {children}
    </div>
  ),
  TileLayer: () => <div data-testid="mock-tile-layer" />,
  ZoomControl: () => <div data-testid="mock-zoom-control" />,
  Pane: ({ children, name }: { children: React.ReactNode; name: string }) => (
    <div data-testid={`mock-pane-${name}`}>{children}</div>
  ),
  Circle: ({ children, ...props }: { children?: React.ReactNode; "data-testid"?: string }) => (
    <div data-testid={props["data-testid"] ?? "mock-circle"}>{children}</div>
  ),
  CircleMarker: ({
    children,
    eventHandlers,
    ...props
  }: {
    children?: React.ReactNode;
    "data-testid"?: string;
    eventHandlers?: { click?: () => void };
  }) => (
    <div
      data-testid={props["data-testid"] ?? "mock-circle-marker"}
      onClick={() => eventHandlers?.click?.()}
    >
      {children}
    </div>
  ),
  Marker: ({
    children,
    eventHandlers,
    ...props
  }: {
    children?: React.ReactNode;
    "data-testid"?: string;
    eventHandlers?: { click?: () => void };
  }) => (
    <div
      data-testid={props["data-testid"] ?? "mock-marker"}
      onClick={() => eventHandlers?.click?.()}
    >
      {children}
    </div>
  ),
  Polyline: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    "data-testid"?: string;
  }) => <div data-testid={props["data-testid"] ?? "mock-polyline"}>{children}</div>,
  Popup: ({
    children,
    maxHeight,
    keepInView,
    className,
  }: {
    children?: React.ReactNode;
    maxHeight?: number;
    keepInView?: boolean;
    className?: string;
  }) => (
    <div
      data-testid="mock-popup"
      data-class-name={className}
      data-keep-in-view={keepInView ? "true" : "false"}
      data-max-height={maxHeight}
    >
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div data-testid="mock-tooltip">{children}</div>,
  useMap: () => mapMethods,
}));

vi.mock("react-leaflet-cluster", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-marker-cluster-group">{children}</div>
  ),
}));

vi.mock("leaflet.heat", () => ({}));
vi.mock("leaflet.markercluster", () => ({}));

vi.mock("../../ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    roamingApi: {
      map: roamingMapMock,
    },
  };
});

function buildRoamingResponse(
  overrides: Partial<ApiRoamingIntelligenceResponse> = {},
): ApiRoamingIntelligenceResponse {
  return {
    devices: [
      {
        line_id: 101,
        phone_number: "+212600000101",
        employee: "Amina B.",
        department: "Commercial",
        operator: "Maroc Telecom",
        country: "Espagne",
        city: "Madrid",
        latitude: 40.4168,
        longitude: -3.7038,
        location_source: "estimated_cdr",
        location_precision_label: "Localisation estimee via roaming/CDR",
        location_notice: "Position estimee a partir des donnees roaming/CDR.",
        assignment_notice: null,
        line_assignment_source: "direct",
        roaming_cost: 94000,
        data_usage: 14.2,
        risk_level: "critical",
        risk_score: 94,
        alerts: 18,
        fraud_signals: 4,
        anomaly_type: "roaming_international",
        roaming_active: true,
        recommendation: "Verifier la ligne et renforcer la surveillance roaming.",
        ai_reasoning: ["Volume international anormal", "Repetition sur plusieurs periodes"],
        explanation: "Appels internationaux anormaux observes sur plusieurs periodes.",
        last_event_at: "2026-05-25T10:30:00+00:00",
        roaming_events: 19,
        call_zone: "Roaming",
        fraud_flag: true,
        call_cost_mad: 94000,
        fraud_risk_score_100: 94,
        location_origin: "Meknes",
        country_origin: "MA",
        location_dest: "Madrid",
        country_dest: "ES",
      },
    ],
    stats: {
      active_roaming_devices: 1,
      total_roaming_cost_mad: 94000,
      critical_roaming_alerts: 144,
      fraud_roaming_detected: 4,
      top_cost_countries: [
        {
          country: "Espagne",
          total_roaming_cost_mad: 94000,
          device_count: 1,
          critical_alerts: 144,
          fraud_signals: 4,
        },
      ],
      highest_risk_country: "Espagne",
      exact_gps_locations: 0,
      estimated_locations: 1,
      simulated_locations: 0,
    },
    filters: {
      countries: ["Espagne"],
      operators: ["Maroc Telecom"],
      departments: ["Commercial"],
      risk_levels: ["critical"],
      anomaly_types: ["roaming_international"],
      location_sources: ["estimated_cdr"],
      roaming_states: [true],
      fraud_states: [true, false],
      period_start: "2026-05-01T08:00:00+00:00",
      period_end: "2026-05-25T10:30:00+00:00",
    },
    heatmap: [
      {
        label: "Madrid, Espagne",
        country: "Espagne",
        city: "Madrid",
        latitude: 40.4168,
        longitude: -3.7038,
        intensity: 182,
        device_count: 6,
        total_roaming_cost_mad: 94000,
        critical_alerts: 18,
        fraud_signals: 4,
        risk_level: "critical",
      },
    ],
    clusters: [
      {
        label: "Madrid, Espagne",
        country: "Espagne",
        city: "Madrid",
        latitude: 40.4168,
        longitude: -3.7038,
        intensity: 182,
        device_count: 6,
        total_roaming_cost_mad: 94000,
        critical_alerts: 18,
        fraud_signals: 4,
        risk_level: "critical",
      },
    ],
    critical_zones: [
      {
        label: "Madrid, Espagne",
        country: "Espagne",
        city: "Madrid",
        latitude: 40.4168,
        longitude: -3.7038,
        intensity: 182,
        total_roaming_cost_mad: 94000,
        active_devices: 6,
        alerts: 18,
        critical_alerts: 18,
        fraud_signals: 4,
        risk_level: "critical",
        explanation: "Madrid concentre les usages roaming les plus couteux du perimetre.",
      },
    ],
    movement_flows: [
      {
        origin_label: "Meknes, Maroc",
        destination_label: "Madrid, Espagne",
        origin_latitude: 33.8935,
        origin_longitude: -5.5473,
        destination_latitude: 40.4168,
        destination_longitude: -3.7038,
        total_roaming_cost_mad: 18000,
        alerts: 4,
        event_count: 11,
        risk_level: "high",
      },
    ],
    timeline: [
      {
        bucket: "25/05 10:00",
        total_roaming_cost_mad: 94000,
        active_devices: 1,
        alerts: 18,
        critical_alerts: 18,
        fraud_signals: 4,
      },
    ],
    country_insights: [
      {
        country: "Espagne",
        risk_level: "critical",
        total_roaming_cost_mad: 94000,
        active_devices: 1,
        critical_alerts: 144,
        fraud_signals: 4,
        dominant_operator: "Maroc Telecom",
        top_department: "Commercial",
        explanation_factors: ["roaming recurrent", "impact financier eleve"],
        explanation: "L'Espagne concentre actuellement les alertes geospatiales prioritaires.",
      },
    ],
    generated_at: "2026-05-25T10:30:00+00:00",
    live_supported: true,
    live_refresh_interval_seconds: 12,
    privacy_notice: "Les positions exactes restent masquees sans consentement explicite.",
    ...overrides,
  };
}

describe("RoamingIntelligenceMap", () => {
  beforeEach(() => {
    roamingMapMock.mockResolvedValue(buildRoamingResponse());
    mapMethods.stop.mockClear();
  });

  it("renders critical zone overlays and popup content", async () => {
    const user = userEvent.setup();
    render(<RoamingIntelligenceMap token="token-demo" />);

    expect(await screen.findAllByTestId("roaming-critical-zone-marker")).toHaveLength(1);
    await user.click(screen.getByTestId("roaming-map-clusters-inline-button"));
    expect(screen.getAllByText("Madrid, Espagne").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Madrid concentre les usages roaming les plus couteux du perimetre.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Origine reelle")).toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(screen.getByText("Position affichee")).toBeInTheDocument();
    expect(screen.getByText("Itinerance")).toBeInTheDocument();
    expect(screen.getByText("Meknes, MA")).toBeInTheDocument();
    expect(screen.getByText("Madrid, ES")).toBeInTheDocument();
  });

  it("renders a fullscreen map-only surface with essential controls", async () => {
    const user = userEvent.setup();
    render(<RoamingIntelligenceMap token="token-demo" />);

    await screen.findAllByTestId("roaming-heatmap-zone");
    await user.click(screen.getByRole("button", { name: /agrandir la carte/i }));

    expect(await screen.findByTestId("roaming-map-fullscreen")).toBeInTheDocument();
    expect(screen.queryByTestId("roaming-map-reset-zoom-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("roaming-map-heatmap-fullscreen-button")).toBeInTheDocument();
    expect(screen.getByTestId("roaming-map-flow-fullscreen-button")).toBeInTheDocument();
    expect(screen.getByTestId("roaming-map-clusters-fullscreen-button")).toBeInTheDocument();
    expect(screen.getByTestId("roaming-map-close-fullscreen-button")).toBeInTheDocument();
    expect(screen.getByText("1 point")).toBeInTheDocument();
    expect(screen.queryByText(/Focus IA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/SOC geospatial/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("roaming-map-heatmap-toggle-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roaming-map-flow-toggle-button")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("mock-popup").some((popup) => popup.getAttribute("data-max-height") === "560")).toBe(true);
  });

  it("toggles flow overlays from the fullscreen controls", async () => {
    const user = userEvent.setup();
    render(<RoamingIntelligenceMap token="token-demo" />);

    await screen.findAllByTestId("roaming-critical-zone-marker");
    await user.click(screen.getByRole("button", { name: /agrandir la carte/i }));

    expect(await screen.findByTestId("roaming-map-fullscreen")).toBeInTheDocument();
    expect(screen.queryAllByTestId("roaming-flow-line")).toHaveLength(0);

    await user.click(screen.getByTestId("roaming-map-flow-fullscreen-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("roaming-flow-line").length).toBeGreaterThan(0);
      expect(screen.getAllByTestId("roaming-flow-node").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByTestId("roaming-map-flow-fullscreen-button"));

    await waitFor(() => {
      expect(screen.queryAllByTestId("roaming-flow-line")).toHaveLength(0);
    });
  });

  it("renders a fixed detail panel outside Leaflet when a fullscreen device is selected", async () => {
    const user = userEvent.setup();
    render(<RoamingIntelligenceMap token="token-demo" />);

    await screen.findAllByTestId("roaming-heatmap-zone");
    await user.click(screen.getByTestId("roaming-map-clusters-inline-button"));
    await user.click(screen.getByRole("button", { name: /agrandir la carte/i }));
    await user.click(await screen.findByTestId("roaming-device-marker-fullscreen"));

    const panel = await screen.findByTestId("roaming-map-detail-panel");

    expect(panel).toHaveStyle({
      position: "fixed",
      right: "24px",
      top: "100px",
      width: "420px",
      height: "80vh",
      overflowY: "auto",
      overflowX: "hidden",
      zIndex: "9999",
    });
    expect(within(panel).getByText("Origine reelle")).toBeInTheDocument();
    expect(within(panel).getByText("Position affichee")).toBeInTheDocument();
    expect(within(panel).getByText("Madrid, ES")).toBeInTheDocument();
    expect(screen.getAllByTestId("mock-map-container").every((container) => !container.contains(panel))).toBe(true);
  });

  it("configures scrollable map popups with keep-in-view behavior", async () => {
    render(<RoamingIntelligenceMap token="token-demo" />);

    const popups = await screen.findAllByTestId("mock-popup");

    expect(popups.some((popup) => popup.getAttribute("data-max-height") === "420")).toBe(true);
    expect(popups.every((popup) => popup.getAttribute("data-keep-in-view") === "true")).toBe(true);
  });

  it("toggles the heatmap layer from the inline controls", async () => {
    const user = userEvent.setup();
    render(<RoamingIntelligenceMap token="token-demo" />);

    expect(await screen.findAllByTestId("roaming-heatmap-zone")).toHaveLength(1);

    await user.click(screen.getByTestId("roaming-map-heatmap-inline-button"));

    await waitFor(() => {
      expect(screen.queryAllByTestId("roaming-heatmap-zone")).toHaveLength(0);
    });

    await user.click(screen.getByTestId("roaming-map-heatmap-inline-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("roaming-heatmap-zone")).toHaveLength(1);
    });
  });

  it("toggles clustered markers into simple markers from the inline controls", async () => {
    const user = userEvent.setup();
    render(<RoamingIntelligenceMap token="token-demo" />);

    expect(await screen.findByTestId("mock-marker-cluster-group")).toBeInTheDocument();
    expect(screen.getAllByTestId("mock-marker")).toHaveLength(1);
    expect(screen.queryAllByTestId("roaming-device-marker")).toHaveLength(0);

    await user.click(screen.getByTestId("roaming-map-clusters-inline-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("mock-marker-cluster-group")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("roaming-device-marker")).toHaveLength(1);
    });
  });

  it("closes the fullscreen map without calling Leaflet stop during unmount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<RoamingIntelligenceMap token="token-demo" />);

    await screen.findAllByTestId("roaming-heatmap-zone");
    await user.click(screen.getByRole("button", { name: /agrandir la carte/i }));
    await screen.findByTestId("roaming-map-fullscreen");
    await user.click(screen.getByTestId("roaming-map-close-fullscreen-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("roaming-map-fullscreen")).not.toBeInTheDocument();
    });

    unmount();

    expect(mapMethods.stop).not.toHaveBeenCalled();
  });

  it("toggles flow overlays from the inline controls and keeps critical markers visible", async () => {
    const user = userEvent.setup();
    render(<RoamingIntelligenceMap token="token-demo" />);

    expect(await screen.findAllByTestId("roaming-critical-zone-marker")).toHaveLength(1);
    expect(screen.queryAllByTestId("roaming-flow-line")).toHaveLength(0);

    await user.click(screen.getByTestId("roaming-map-flow-inline-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("roaming-flow-line")).toHaveLength(1);
      expect(screen.getAllByTestId("roaming-flow-node")).toHaveLength(2);
    });
    expect(screen.getAllByTestId("roaming-critical-zone-marker")).toHaveLength(1);

    await user.click(screen.getByTestId("roaming-map-flow-inline-button"));

    await waitFor(() => {
      expect(screen.queryAllByTestId("roaming-flow-line")).toHaveLength(0);
    });
    expect(screen.getAllByTestId("roaming-critical-zone-marker")).toHaveLength(1);
  });

  it("reconstructs a flow overlay from critical zones when the API returns no explicit movement flow", async () => {
    const user = userEvent.setup();
    roamingMapMock.mockResolvedValue(
      buildRoamingResponse({
        movement_flows: [],
      }),
    );

    render(<RoamingIntelligenceMap token="token-demo" />);

    expect(await screen.findAllByTestId("roaming-critical-zone-marker")).toHaveLength(1);
    expect(screen.queryAllByTestId("roaming-flow-line")).toHaveLength(0);

    await user.click(screen.getByTestId("roaming-map-flow-inline-button"));

    await waitFor(() => {
      expect(screen.getAllByTestId("roaming-flow-line")).toHaveLength(1);
      expect(screen.getAllByTestId("roaming-flow-node")).toHaveLength(2);
    });

    expect(screen.queryByText("Aucun flux geospatial disponible actuellement.")).not.toBeInTheDocument();
  });

  it("shows the empty geospatial fallback when no map data is available", async () => {
    roamingMapMock.mockResolvedValue(
      buildRoamingResponse({
        devices: [],
        heatmap: [],
        clusters: [],
        critical_zones: [],
        movement_flows: [],
        timeline: [],
        country_insights: [],
      }),
    );

    render(<RoamingIntelligenceMap token="token-demo" />);

    expect(
      await screen.findByText("Aucune donnee geospatiale disponible actuellement."),
    ).toBeInTheDocument();
  });

  it("shows the critical-zone fallback when no critical zone is available", async () => {
    roamingMapMock.mockResolvedValue(
      buildRoamingResponse({
        heatmap: [],
        clusters: [],
        critical_zones: [],
      }),
    );

    render(<RoamingIntelligenceMap token="token-demo" />);

    expect(await screen.findByTestId("roaming-critical-zone-fallback")).toBeInTheDocument();
    expect(screen.getByText("Aucune zone critique détectée actuellement.")).toBeInTheDocument();
  });
});
