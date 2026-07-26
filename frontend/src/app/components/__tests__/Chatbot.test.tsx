import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Chatbot from "../Chatbot";
import type { ApiRoamingIntelligenceResponse } from "../../lib/api";
import {
  saveStoredTelecomChatState,
  type TelecomChatConversation,
} from "../../lib/chatbot-storage";

const {
  chatStreamMock,
  loadTelecomAssistantDatasetMock,
  navigateMock,
  roamingMapMock,
} = vi.hoisted(() => ({
  chatStreamMock: vi.fn(),
  loadTelecomAssistantDatasetMock: vi.fn(),
  navigateMock: vi.fn(),
  roamingMapMock: vi.fn(),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/anomalies" }),
  useNavigate: () => navigateMock,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    token: "token-demo",
    user: {
      id: "user-1",
      full_name: "Amina Benali",
    },
  }),
}));

vi.mock("../../context/LanguageContext", () => ({
  useLanguage: () => ({
    localeCode: "fr-FR",
  }),
}));

vi.mock("../../lib/chatbot-data", async () => {
  const actual = await vi.importActual<typeof import("../../lib/chatbot-data")>(
    "../../lib/chatbot-data",
  );
  return {
    ...actual,
    loadTelecomAssistantDataset: loadTelecomAssistantDatasetMock,
  };
});

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    chatApi: {
      ...actual.chatApi,
      stream: chatStreamMock,
    },
    roamingApi: {
      map: roamingMapMock,
    },
  };
});

function createDeferredPromise<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function buildRoamingResponse(
  overrides: Partial<ApiRoamingIntelligenceResponse> = {},
): ApiRoamingIntelligenceResponse {
  return {
    devices: [],
    stats: {
      active_roaming_devices: 4,
      total_roaming_cost_mad: 131540,
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
      estimated_locations: 3,
      simulated_locations: 0,
    },
    filters: {
      countries: ["Maroc"],
      operators: ["Orange"],
      departments: ["Commercial"],
      risk_levels: ["critical"],
      anomaly_types: ["roaming_recurrent"],
      location_sources: ["estimated_cdr"],
      roaming_states: [true],
      fraud_states: [true, false],
      period_start: "2026-05-01T00:00:00+00:00",
      period_end: "2026-05-25T19:30:00+00:00",
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
        intensity: 182,
        total_roaming_cost_mad: 93592.5,
        active_devices: 4,
        alerts: 18,
        critical_alerts: 16,
        fraud_signals: 2,
        risk_level: "critical",
        explanation:
          "Plusieurs alertes sont liees au roaming recurrent et aux depassements de quota.",
      },
    ],
    movement_flows: [],
    timeline: [],
    country_insights: [],
    generated_at: "2026-05-25T19:30:00+00:00",
    live_supported: true,
    live_refresh_interval_seconds: 12,
    privacy_notice: "notice",
    ...overrides,
  };
}

const CHAT_SCOPE = "telecom-assistant:user:user-1";

function seedEquipmentVisionOnlyConversation(): TelecomChatConversation {
  const conversation: TelecomChatConversation = {
    id: "conversation-equipment-vision-only",
    title: "Analyse equipements",
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:05:00.000Z",
    messages: [
      {
        id: "user-equipment-question",
        role: "user",
        text: "A quoi servent les differents equipements visibles ?",
        createdAt: "2026-06-03T10:01:00.000Z",
        status: "complete",
      },
      {
        id: "assistant-equipment-answer",
        role: "assistant",
        text:
          "Inventaire visuel\n\n* Terminal mobile probable\n* Routeur ou modem reseau probable\n* Modem USB / cle 4G probable\n* Carte SIM ou support SIM probable\n* Accessoires telecom probables\n\nUtilisation probable des equipements\n\n* Terminal mobile : appels, messagerie, applications professionnelles.\n* Routeur/modem : distribution Internet/Wi-Fi.\n* Modem USB/cle 4G : connexion mobile ponctuelle ou de secours.\n* Carte SIM/support SIM : acces au reseau operateur.\n* Accessoires : connexion, alimentation ou activation.\n\nEtat apparent\n\n* Aucun dommage visible confirme.\n\nModernisation potentielle\n\n* Aucun signe visuel ne justifie un remplacement immediat.\n* Modernisation a etudier uniquement selon debit, couverture, disponibilite ou anciennete.\n\nNiveau de confiance\n\n* Moyen a eleve.",
        createdAt: "2026-06-03T10:02:00.000Z",
        status: "complete",
        requestKind: "image",
        linkedUserMessageId: "user-equipment-question",
        bullets: ["Risque optimisation: 91/100", "Risque fraude: 32/100"],
        recommendation: "Verifier la pertinence du remplacement.",
        sources: ["Risque fraude: 32/100", "Risque optimisation: 91/100"],
        imageAnalysis: {
          imageType: "equipement",
          confidence: 0.76,
          analysisMode: "advanced",
          analysisStatus: "fallback",
          processingMessage: "Analyse prudente basee uniquement sur les elements visibles.",
          processingNotices: ["Fallback Vision applique"],
          detectedKpis: ["Risque optimisation: 91/100"],
          recommendations: ["Verifier le parc", "Aucun remplacement immediat"],
          decisionRecommendations: [
            {
              title: "Analyse equipement",
              priority: "medium",
              impact: "analysis",
              estimatedSaving: null,
              reason: "Pourquoi cette recommandation ?",
            },
          ],
          recommendationNotice: "Recommandations IA",
          riskLevel: "medium",
          optimizationScore: 91,
          anomalyScore: 42,
          fraudScore: 32,
          costScore: 27,
          analysisMetadata: {
            sourceMode: "vision_only",
            visibleKpisUsed: [],
            blockedGlobalContext: true,
            removedUnverifiedClaims: [],
            filteredNumbers: [],
            confidenceScore: 0.76,
          },
          equipmentDetails: {
            equipmentType: "routeur",
            conditionScore: 74,
            criticalityScore: 39,
            obsolescenceScore: 28,
            maintenanceScore: 24,
            summary: "Resume technique",
            usageSummary: "Usage exact non confirme visuellement",
            detectedIssues: [],
            maintenanceRecommendations: ["Appliquer analyse"],
            replacementNeeded: false,
          },
        },
      },
    ],
  };

  saveStoredTelecomChatState(CHAT_SCOPE, {
    lastConversationId: conversation.id,
    conversations: [conversation],
  });

  return conversation;
}

async function openChat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(/ouvrir l'assistant ia/i));
  return screen.findByPlaceholderText(/Posez une question sur les lignes, forfaits ou couts/i);
}

describe("Chatbot geospatial questions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    loadTelecomAssistantDatasetMock.mockResolvedValue({
      lines: [],
      lineStats: {},
      occupationStats: {},
      plans: [],
      operatorBudgets: [],
      departmentBudgets: [],
      recommendations: [],
      alerts: [],
      recentNotifications: [],
      unreadNotifications: 0,
      usingMock: true,
      loadedAt: "2026-05-25T19:30:00+00:00",
      sources: [],
    });
    chatStreamMock.mockResolvedValue({
      answer: "Reponse texte standard",
      cached: false,
      fallback_used: false,
      model: "llama3",
      sources: [],
      summary_updated_at: "2026-05-25T19:30:00+00:00",
      duration_ms: 12,
    });
    roamingMapMock.mockReset();
    chatStreamMock.mockClear();
    loadTelecomAssistantDatasetMock.mockClear();
    navigateMock.mockClear();

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("routes a text-only geo question to roaming map data and clears loading on success", async () => {
    const deferred = createDeferredPromise<ApiRoamingIntelligenceResponse>();
    roamingMapMock.mockReturnValueOnce(deferred.promise);
    const user = userEvent.setup();

    render(<Chatbot />);

    const input = await openChat(user);
    await user.type(input, "Quelle region presente le plus de cout roaming ?");
    await user.click(screen.getByLabelText(/envoyer la question/i));

    await waitFor(() =>
      expect(roamingMapMock).toHaveBeenCalledWith(
        "token-demo",
        undefined,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      ),
    );
    expect(chatStreamMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/Analyse geospatiale en cours/i)).toBeInTheDocument();

    deferred.resolve(buildRoamingResponse());

    expect(
      await screen.findByText(/La region la plus exposee est Oujda, Maroc/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/Analyse geospatiale en cours/i)).not.toBeInTheDocument(),
    );
  });

  it("shows a clean fallback and clears loading when roaming map data fails", async () => {
    const deferred = createDeferredPromise<ApiRoamingIntelligenceResponse>();
    roamingMapMock.mockReturnValueOnce(deferred.promise);
    const user = userEvent.setup();

    render(<Chatbot />);

    const input = await openChat(user);
    await user.type(input, "Quelle zone concentre le plus d'alertes critiques ?");
    await user.click(screen.getByLabelText(/envoyer la question/i));

    expect(await screen.findByText(/Analyse geospatiale en cours/i)).toBeInTheDocument();

    deferred.reject(new Error("roaming map unavailable"));

    expect(
      await screen.findByText(/Les donnees geographiques ne sont pas disponibles actuellement/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/Analyse geospatiale en cours/i)).not.toBeInTheDocument(),
    );
  });

  it("renders a compact equipment vision-only fallback without scores or recommendation blocks", async () => {
    seedEquipmentVisionOnlyConversation();
    const user = userEvent.setup();

    render(<Chatbot />);

    await openChat(user);

    expect(await screen.findByText(/Inventaire visuel/i)).toBeInTheDocument();
    expect(screen.getByText(/Utilisation probable des equipements/i)).toBeInTheDocument();
    expect(screen.getByText(/Etat apparent/i)).toBeInTheDocument();
    expect(screen.getByText(/Modernisation potentielle/i)).toBeInTheDocument();
    expect(screen.getByText(/Niveau de confiance/i)).toBeInTheDocument();

    expect(screen.queryByText(/^Recommandation$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pourquoi cette recommandation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Score etat/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Score criticite/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Score obsolescence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Score maintenance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Risque optimisation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Risque cout/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Risque anomalie/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Risque fraude/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Analyse equipement$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Resume technique$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Recommandations IA$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Actions detectees$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Appliquer analyse$/i)).not.toBeInTheDocument();
  });
});
