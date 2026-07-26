import { describe, expect, it } from "vitest";

import {
  buildGeoQuestionAssistantContent,
  buildGeoQuestionUnavailableContent,
  isGeoQuestion,
} from "../chatbot-geo";
import type { ApiRoamingIntelligenceResponse } from "../api";

function buildRoamingResponse(
  overrides: Partial<ApiRoamingIntelligenceResponse> = {},
): ApiRoamingIntelligenceResponse {
  return {
    devices: [],
    stats: {
      active_roaming_devices: 3,
      total_roaming_cost_mad: 126842,
      critical_roaming_alerts: 27,
      fraud_roaming_detected: 4,
      top_cost_countries: [
        {
          country: "Maroc",
          total_roaming_cost_mad: 93592.5,
          device_count: 4,
          critical_alerts: 16,
          fraud_signals: 2,
        },
      ],
      highest_risk_country: "Maroc",
      exact_gps_locations: 1,
      estimated_locations: 2,
      simulated_locations: 0,
    },
    filters: {
      countries: ["Maroc"],
      operators: ["Orange"],
      departments: ["Commercial"],
      risk_levels: ["critical", "high"],
      anomaly_types: ["roaming_recurrent"],
      location_sources: ["estimated_cdr"],
      roaming_states: [true],
      fraud_states: [true, false],
      period_start: "2026-05-01T00:00:00+00:00",
      period_end: "2026-05-25T18:30:00+00:00",
    },
    heatmap: [],
    clusters: [],
    critical_zones: [
      {
        label: "Oujda, Maroc",
        country: "Maroc",
        city: "Oujda",
        latitude: 34.6814,
        longitude: -1.9086,
        intensity: 188,
        total_roaming_cost_mad: 93592.5,
        active_devices: 4,
        alerts: 18,
        critical_alerts: 16,
        fraud_signals: 2,
        risk_level: "critical",
        explanation:
          "Plusieurs alertes sont liees au roaming recurrent et aux depassements de quota.",
      },
      {
        label: "Casablanca, Maroc",
        country: "Maroc",
        city: "Casablanca",
        latitude: 33.5731,
        longitude: -7.5898,
        intensity: 120,
        total_roaming_cost_mad: 33249,
        active_devices: 3,
        alerts: 10,
        critical_alerts: 8,
        fraud_signals: 1,
        risk_level: "high",
        explanation: "La zone reste exposee a plusieurs depassements roaming ponctuels.",
      },
    ],
    movement_flows: [],
    timeline: [],
    country_insights: [],
    generated_at: "2026-05-25T18:30:00+00:00",
    live_supported: true,
    live_refresh_interval_seconds: 12,
    privacy_notice: "notice",
    ...overrides,
  };
}

describe("chatbot-geo", () => {
  it("detects geospatial telecom questions", () => {
    expect(isGeoQuestion("Quelle region presente le plus de cout roaming ?")).toBe(true);
    expect(isGeoQuestion("Compare les regions selon la consommation.")).toBe(true);
    expect(isGeoQuestion("Resume les forfaits les plus chers du mois.")).toBe(false);
  });

  it("builds a business answer for top roaming cost by region", () => {
    const content = buildGeoQuestionAssistantContent(
      "Quelle region presente le plus de cout roaming ?",
      buildRoamingResponse(),
    );

    expect(content.text).toContain("La region la plus exposee est Oujda, Maroc");
    expect(content.text).toContain("93");
    expect(content.text).toContain("depassements de quota");
    expect(content.recommendation).toContain("verifier les lignes concernees");
    expect(content.bullets).toContain("Region prioritaire: Oujda, Maroc");
  });

  it("returns a clean fallback when no critical zone is available", () => {
    const content = buildGeoQuestionAssistantContent(
      "Quelle zone concentre le plus d'alertes critiques ?",
      buildRoamingResponse({
        critical_zones: [],
        heatmap: [],
        country_insights: [],
        stats: {
          ...buildRoamingResponse().stats,
          top_cost_countries: [],
        },
      }),
    );

    expect(content.text).toContain("Aucune zone critique detectee actuellement");
    expect(content.recommendation).toContain("Poursuivre la surveillance geospatiale");
  });

  it("returns the unavailable fallback when roaming map data cannot be loaded", () => {
    const content = buildGeoQuestionUnavailableContent("unavailable");

    expect(content.text).toBe("Les donnees geographiques ne sont pas disponibles actuellement.");
    expect(content.sources).toContain("Source: Cartographie roaming /api/v1/roaming/map");
  });
});
