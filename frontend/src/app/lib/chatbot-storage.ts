import { createUuid } from "./uuid";

export type TelecomChatRole = "assistant" | "user";
export type TelecomChatDocumentType = "pdf" | "csv" | "xlsx" | "xls";
export type TelecomChatRequestKind = "text" | "image" | "document" | "executive_report";

export interface TelecomChatImageAttachment {
  kind: "image";
  name: string;
  mimeType: string;
  previewUrl: string;
  sizeBytes?: number;
}

export interface TelecomChatDocumentAttachment {
  kind: "document";
  name: string;
  mimeType: string;
  previewUrl: string;
  sizeBytes?: number;
  documentType?: TelecomChatDocumentType;
  pageCount?: number | null;
}

export type TelecomChatPdfAttachment = TelecomChatDocumentAttachment;

export type TelecomChatAttachment =
  | TelecomChatImageAttachment
  | TelecomChatDocumentAttachment;

export interface TelecomChatImageAnalysis {
  imageType: string;
  confidence: number | null;
  ocrConfidence?: number | null;
  analysisMode?: "quick" | "advanced" | "dashboard_analysis";
  analysisStatus?: "success" | "fallback";
  advancedAnalysisAvailable?: boolean;
  advancedAnalysisCompleted?: boolean;
  processingMessage?: string | null;
  processingNotices?: string[];
  errorType?: string | null;
  fallbackAnswer?: string | null;
  detectedOperator?: string;
  detectedAnomalies?: string[];
  analysisMetadata?: {
    sourceMode: string;
    visibleKpisUsed: string[];
    blockedGlobalContext: boolean;
    removedUnverifiedClaims: string[];
    filteredNumbers: string[];
    confidenceScore: number;
  };
  ocrText?: string;
  visionAnalysis?: string;
  detectedKpis?: string[];
  recommendations?: string[];
  decisionRecommendations?: Array<{
    title: string;
    priority: "low" | "medium" | "high" | "critical";
    impact: string;
    estimatedSaving?: string | null;
    reason: string;
  }>;
  recommendationNotice?: string | null;
  riskLevel?: "low" | "medium" | "high" | "critical" | null;
  optimizationScore?: number | null;
  anomalyScore?: number | null;
  fraudScore?: number | null;
  costScore?: number | null;
  highlightedImage?: string | null;
  annotations?: Array<{
    label: string;
    type: string;
    bbox: [number, number, number, number];
    confidence: number;
  }>;
  invoiceDetails?: {
    operator?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    billingPeriod?: string;
    amountHtMad?: string;
    vatAmountMad?: string;
    amountTtcMad?: string;
    totalAmountMad?: string;
    billedLines?: string[];
    additionalFees?: string[];
    overageItems?: string[];
    anomalies?: string[];
  };
  incidentDetails?: {
    alertType?: string;
    severity?: string;
    detectedAt?: string;
    operator?: string;
    lineReference?: string;
    suspectCostMad?: string;
    callVolume?: string;
    dataOverage?: string;
    errorMessage?: string;
    priority?: string;
    summary?: string;
    criticalAlertCount?: number | null;
    exposureRate?: string;
    exposureRatePct?: number | null;
    financialImpactMad?: string;
    financialImpactValueMad?: number | null;
    averageScore?: string;
    averageScoreValue?: number | null;
    riskScore?: string;
    maxRiskScores?: string[];
    riskyEntities?: string[];
    repeatedAnomalies?: string[];
    visibleStatuses?: string[];
    criticalSignals?: string[];
    probableCauses?: string[];
  };
  alertIntelligence?: {
    alertFamily?: string;
    aiRiskScore?: number | null;
    ocrConfidenceScore?: number | null;
    criticity?: "low" | "medium" | "high" | "critical" | null;
    executiveSummary?: string;
    businessRisk?: string;
    financialExposureMad?: string;
    potentialLossMad?: string;
    possibleSavingsMad?: string;
    priorityKpis?: string[];
    visibleEvidence?: string[];
    atRiskEntities?: string[];
    immediateActions?: string[];
    recommendedControls?: string[];
    alertTimeline?: Array<{
      label: string;
      detail: string;
      status?: "observed" | "watch" | "critical" | "action";
    }>;
    auditFocus?: string;
  };
  workflowDetails?: {
    workflowType?: string;
    complexityScore?: number | null;
    complexityLevel?: "low" | "medium" | "high" | "critical" | null;
    criticalSteps?: string[];
    detectedDepartments?: string[];
    detectedRoles?: string[];
    automationOpportunities?: string[];
    bottlenecks?: string[];
    repeatedValidations?: string[];
    summary?: string;
  };
  equipmentDetails?: {
    equipmentType?: string;
    brand?: string;
    model?: string;
    serialNumber?: string;
    operator?: string;
    visibleCondition?: string;
    deviceVersion?: string;
    simInformation?: string;
    labelInformation?: string;
    usageSummary?: string;
    detectedIssues?: string[];
    maintenanceRecommendations?: string[];
    replacementNeeded?: boolean;
    conditionScore?: number | null;
    criticalityScore?: number | null;
    obsolescenceScore?: number | null;
    maintenanceScore?: number | null;
    summary?: string;
  };
}

export interface TelecomExecutiveReport {
  executiveSummary: string;
  fleetHealthScore: number;
  fleetHealthLevel: "excellent" | "bon" | "moyen" | "critique";
  riskLevel: "low" | "medium" | "high" | "critical";
  riskScore: number;
  fraudScore: number;
  optimizationScore: number;
  anomalyScore: number;
  equipmentScore: number;
  criticalCosts: Array<{
    title: string;
    amountMad: number;
    category: string;
    owner?: string | null;
    reason: string;
  }>;
  highRiskDepartments: Array<{
    department: string;
    riskScore: number;
    monthlyCostMad?: number | null;
    alertCount: number;
    reason: string;
  }>;
  costlyOperators: Array<{
    operator: string;
    totalCostMad: number;
    suspiciousCalls: number;
    roamingLines: number;
    reason: string;
  }>;
  majorAnomalies: Array<{
    title: string;
    severity: "low" | "medium" | "high" | "critical";
    source: string;
    reason: string;
  }>;
  fraudSignals: Array<{
    title: string;
    severity: "low" | "medium" | "high" | "critical";
    operator?: string | null;
    department?: string | null;
    estimatedExposureMad?: number | null;
    reason: string;
  }>;
  priorityRisks: string[];
  optimizationOpportunities: Array<{
    title: string;
    estimatedSavingMad?: number | null;
    justification: string;
  }>;
  topRecommendations: Array<{
    title: string;
    priority: "low" | "medium" | "high" | "critical";
    justification: string;
    action: string;
    estimatedSavingMad?: number | null;
  }>;
  estimatedSavings: string;
  estimatedSavingsMad: number;
  multimodalHighlights: string[];
  multimodalAnalysisCount: number;
  scoreExplanations: Array<{
    label: string;
    score: number;
    level: "excellent" | "bon" | "moyen" | "critique";
    direction: "higher_is_better" | "higher_is_worse";
    explanation: string;
  }>;
  charts: {
    costEvolution: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
    departmentRisk: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
    operatorCosts: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
    scoreBreakdown: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
  };
  model: string;
  sources: string[];
  summaryUpdatedAt: string;
  cached: boolean;
  fallbackUsed: boolean;
  durationMs: number | null;
}

export interface TelecomChatExplainability {
  answer: string;
  confidence: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  reasoning: string[];
  causes: string[];
  influencingFactors: Array<{
    label: string;
    category: string;
    value: string;
    impactScore: number;
    severity: "low" | "medium" | "high" | "critical";
    evidence: string;
  }>;
  explanationGraph: {
    summary: string;
    dominantFactor?: string | null;
    nodes: Array<{
      nodeId: string;
      label: string;
      nodeType: "signal" | "cause" | "decision" | "impact" | "zone";
      severity: "low" | "medium" | "high" | "critical";
      weight: number;
    }>;
    edges: Array<{
      source: string;
      target: string;
      relation: string;
    }>;
  };
  criticalZones: Array<{
    label: string;
    zoneType: string;
    severity: "low" | "medium" | "high" | "critical";
    detail: string;
    value?: string | null;
  }>;
  recommendations: string[];
  dataPointsUsed: string[];
  confidenceScore: number;
  fraudScore: number;
  anomalyScore: number;
  optimizationScore: number;
  riskScore: number;
  equipmentScore: number;
  charts: {
    factorBreakdown: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
    riskTimeline: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
    criticalZoneHeatmap: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
    scoreRadar: Array<{
      label: string;
      value: number;
      secondaryValue?: number | null;
    }>;
  };
  model: string;
  sources: string[];
  summaryUpdatedAt: string;
  cached: boolean;
  fallbackUsed: boolean;
  durationMs: number | null;
}

export interface TelecomChatMessage {
  id: string;
  role: TelecomChatRole;
  text: string;
  createdAt: string;
  status?: "complete" | "streaming" | "error";
  bullets?: string[];
  recommendation?: string;
  ctaLabel?: string;
  ctaPath?: string;
  sources?: string[];
  linkedUserMessageId?: string | null;
  requestKind?: TelecomChatRequestKind;
  isEdited?: boolean;
  editedAt?: string | null;
  loadingLabel?: string | null;
  attachment?: TelecomChatAttachment | null;
  imageAnalysis?: TelecomChatImageAnalysis | null;
  executiveReport?: TelecomExecutiveReport | null;
  explainability?: TelecomChatExplainability | null;
}

export interface TelecomChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: TelecomChatMessage[];
}

export interface TelecomChatStoredState {
  lastConversationId: string | null;
  conversations: TelecomChatConversation[];
}

interface RootChatStorage {
  [scope: string]: TelecomChatStoredState | undefined;
}

const CHATBOT_STORAGE_KEY = "bcskills:telecom-assistant:conversations:v2";
export const DEFAULT_CONVERSATION_TITLE = "Nouvelle discussion";
const MAX_STORED_CONVERSATIONS = 30;

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAttachmentPreviewUrl(rawValue: string): string {
  const normalizedValue = rawValue.trim();
  return normalizedValue.startsWith("blob:") ? "" : normalizedValue;
}

function sanitizeAttachmentForStorage(
  attachment: TelecomChatAttachment | null | undefined,
): TelecomChatAttachment | null {
  if (!attachment) {
    return null;
  }

  return {
    ...attachment,
    previewUrl: normalizeAttachmentPreviewUrl(attachment.previewUrl),
  };
}

function sanitizeConversationForStorage(
  conversation: TelecomChatConversation,
): TelecomChatConversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      attachment: sanitizeAttachmentForStorage(message.attachment ?? null),
    })),
  };
}

function normalizeIsoDate(rawValue: unknown): string {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return new Date().toISOString();
  }

  const parsedTimestamp = Date.parse(rawValue);
  if (Number.isNaN(parsedTimestamp)) {
    return new Date().toISOString();
  }

  return new Date(parsedTimestamp).toISOString();
}

function sanitizeExecutiveChartPoints(
  rawValue: unknown,
): Array<{ label: string; value: number; secondaryValue?: number | null }> {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((item) => {
      if (
        !isObjectLike(item) ||
        typeof item.label !== "string" ||
        typeof item.value !== "number" ||
        !Number.isFinite(item.value)
      ) {
        return null;
      }

      return {
        label: item.label,
        value: item.value,
        secondaryValue:
          typeof item.secondaryValue === "number" && Number.isFinite(item.secondaryValue)
            ? item.secondaryValue
            : item.secondaryValue === null
              ? null
              : undefined,
      };
    })
    .filter(
      (
        item,
      ): item is { label: string; value: number; secondaryValue?: number | null } => item !== null,
    );
}

function sanitizeExecutiveReport(rawValue: unknown): TelecomExecutiveReport | null {
  if (!isObjectLike(rawValue) || typeof rawValue.executiveSummary !== "string") {
    return null;
  }

  const sanitizeStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  const sanitizeLevel = (
    value: unknown,
  ): "excellent" | "bon" | "moyen" | "critique" =>
    value === "excellent" || value === "bon" || value === "moyen" ? value : "critique";
  const sanitizeRiskLevel = (
    value: unknown,
  ): "low" | "medium" | "high" | "critical" =>
    value === "low" || value === "medium" || value === "high" ? value : "critical";

  return {
    executiveSummary: rawValue.executiveSummary,
    fleetHealthScore:
      typeof rawValue.fleetHealthScore === "number" && Number.isFinite(rawValue.fleetHealthScore)
        ? rawValue.fleetHealthScore
        : 0,
    fleetHealthLevel: sanitizeLevel(rawValue.fleetHealthLevel),
    riskLevel: sanitizeRiskLevel(rawValue.riskLevel),
    riskScore:
      typeof rawValue.riskScore === "number" && Number.isFinite(rawValue.riskScore)
        ? rawValue.riskScore
        : 0,
    fraudScore:
      typeof rawValue.fraudScore === "number" && Number.isFinite(rawValue.fraudScore)
        ? rawValue.fraudScore
        : 0,
    optimizationScore:
      typeof rawValue.optimizationScore === "number" &&
      Number.isFinite(rawValue.optimizationScore)
        ? rawValue.optimizationScore
        : 0,
    anomalyScore:
      typeof rawValue.anomalyScore === "number" && Number.isFinite(rawValue.anomalyScore)
        ? rawValue.anomalyScore
        : 0,
    equipmentScore:
      typeof rawValue.equipmentScore === "number" && Number.isFinite(rawValue.equipmentScore)
        ? rawValue.equipmentScore
        : 0,
    criticalCosts: Array.isArray(rawValue.criticalCosts)
      ? rawValue.criticalCosts
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.title !== "string" ||
              typeof item.amountMad !== "number" ||
              !Number.isFinite(item.amountMad) ||
              typeof item.category !== "string" ||
              typeof item.reason !== "string"
            ) {
              return null;
            }
            return {
              title: item.title,
              amountMad: item.amountMad,
              category: item.category,
              owner: typeof item.owner === "string" ? item.owner : item.owner === null ? null : undefined,
              reason: item.reason,
            };
          })
          .filter(
            (
              item,
            ): item is {
              title: string;
              amountMad: number;
              category: string;
              owner?: string | null;
              reason: string;
            } => item !== null,
          )
      : [],
    highRiskDepartments: Array.isArray(rawValue.highRiskDepartments)
      ? rawValue.highRiskDepartments
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.department !== "string" ||
              typeof item.riskScore !== "number" ||
              !Number.isFinite(item.riskScore) ||
              typeof item.alertCount !== "number" ||
              !Number.isFinite(item.alertCount) ||
              typeof item.reason !== "string"
            ) {
              return null;
            }
            return {
              department: item.department,
              riskScore: item.riskScore,
              monthlyCostMad:
                typeof item.monthlyCostMad === "number" && Number.isFinite(item.monthlyCostMad)
                  ? item.monthlyCostMad
                  : item.monthlyCostMad === null
                    ? null
                    : undefined,
              alertCount: item.alertCount,
              reason: item.reason,
            };
          })
          .filter(
            (
              item,
            ): item is {
              department: string;
              riskScore: number;
              monthlyCostMad?: number | null;
              alertCount: number;
              reason: string;
            } => item !== null,
          )
      : [],
    costlyOperators: Array.isArray(rawValue.costlyOperators)
      ? rawValue.costlyOperators
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.operator !== "string" ||
              typeof item.totalCostMad !== "number" ||
              !Number.isFinite(item.totalCostMad) ||
              typeof item.suspiciousCalls !== "number" ||
              typeof item.roamingLines !== "number" ||
              typeof item.reason !== "string"
            ) {
              return null;
            }
            return {
              operator: item.operator,
              totalCostMad: item.totalCostMad,
              suspiciousCalls: item.suspiciousCalls,
              roamingLines: item.roamingLines,
              reason: item.reason,
            };
          })
          .filter(
            (
              item,
            ): item is {
              operator: string;
              totalCostMad: number;
              suspiciousCalls: number;
              roamingLines: number;
              reason: string;
            } => item !== null,
          )
      : [],
    majorAnomalies: Array.isArray(rawValue.majorAnomalies)
      ? rawValue.majorAnomalies
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.title !== "string" ||
              typeof item.source !== "string" ||
              typeof item.reason !== "string"
            ) {
              return null;
            }
            return {
              title: item.title,
              severity: sanitizeRiskLevel(item.severity),
              source: item.source,
              reason: item.reason,
            };
          })
          .filter(
            (
              item,
            ): item is {
              title: string;
              severity: "low" | "medium" | "high" | "critical";
              source: string;
              reason: string;
            } => item !== null,
          )
      : [],
    fraudSignals: Array.isArray(rawValue.fraudSignals)
      ? rawValue.fraudSignals
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.title !== "string" ||
              typeof item.reason !== "string"
            ) {
              return null;
            }
            return {
              title: item.title,
              severity: sanitizeRiskLevel(item.severity),
              operator:
                typeof item.operator === "string" ? item.operator : item.operator === null ? null : undefined,
              department:
                typeof item.department === "string"
                  ? item.department
                  : item.department === null
                    ? null
                    : undefined,
              estimatedExposureMad:
                typeof item.estimatedExposureMad === "number" &&
                Number.isFinite(item.estimatedExposureMad)
                  ? item.estimatedExposureMad
                  : item.estimatedExposureMad === null
                    ? null
                    : undefined,
              reason: item.reason,
            };
          })
          .filter(
            (
              item,
            ): item is {
              title: string;
              severity: "low" | "medium" | "high" | "critical";
              operator?: string | null;
              department?: string | null;
              estimatedExposureMad?: number | null;
              reason: string;
            } => item !== null,
          )
      : [],
    priorityRisks: sanitizeStringArray(rawValue.priorityRisks),
    optimizationOpportunities: Array.isArray(rawValue.optimizationOpportunities)
      ? rawValue.optimizationOpportunities
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.title !== "string" ||
              typeof item.justification !== "string"
            ) {
              return null;
            }
            return {
              title: item.title,
              estimatedSavingMad:
                typeof item.estimatedSavingMad === "number" && Number.isFinite(item.estimatedSavingMad)
                  ? item.estimatedSavingMad
                  : item.estimatedSavingMad === null
                    ? null
                    : undefined,
              justification: item.justification,
            };
          })
          .filter(
            (
              item,
            ): item is {
              title: string;
              estimatedSavingMad?: number | null;
              justification: string;
            } => item !== null,
          )
      : [],
    topRecommendations: Array.isArray(rawValue.topRecommendations)
      ? rawValue.topRecommendations
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.title !== "string" ||
              typeof item.justification !== "string" ||
              typeof item.action !== "string"
            ) {
              return null;
            }
            return {
              title: item.title,
              priority: sanitizeRiskLevel(item.priority),
              justification: item.justification,
              action: item.action,
              estimatedSavingMad:
                typeof item.estimatedSavingMad === "number" &&
                Number.isFinite(item.estimatedSavingMad)
                  ? item.estimatedSavingMad
                  : item.estimatedSavingMad === null
                    ? null
                    : undefined,
            };
          })
          .filter(
            (
              item,
            ): item is {
              title: string;
              priority: "low" | "medium" | "high" | "critical";
              justification: string;
              action: string;
              estimatedSavingMad?: number | null;
            } => item !== null,
          )
      : [],
    estimatedSavings:
      typeof rawValue.estimatedSavings === "string" ? rawValue.estimatedSavings : "0 MAD",
    estimatedSavingsMad:
      typeof rawValue.estimatedSavingsMad === "number" &&
      Number.isFinite(rawValue.estimatedSavingsMad)
        ? rawValue.estimatedSavingsMad
        : 0,
    multimodalHighlights: sanitizeStringArray(rawValue.multimodalHighlights),
    multimodalAnalysisCount:
      typeof rawValue.multimodalAnalysisCount === "number" &&
      Number.isFinite(rawValue.multimodalAnalysisCount)
        ? rawValue.multimodalAnalysisCount
        : 0,
    scoreExplanations: Array.isArray(rawValue.scoreExplanations)
      ? rawValue.scoreExplanations
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.label !== "string" ||
              typeof item.score !== "number" ||
              !Number.isFinite(item.score) ||
              typeof item.explanation !== "string"
            ) {
              return null;
            }
            return {
              label: item.label,
              score: item.score,
              level: sanitizeLevel(item.level),
              direction:
                item.direction === "higher_is_better" ? "higher_is_better" : "higher_is_worse",
              explanation: item.explanation,
            };
          })
          .filter(
            (
              item,
            ): item is {
              label: string;
              score: number;
              level: "excellent" | "bon" | "moyen" | "critique";
              direction: "higher_is_better" | "higher_is_worse";
              explanation: string;
            } => item !== null,
          )
      : [],
    charts: isObjectLike(rawValue.charts)
      ? {
          costEvolution: sanitizeExecutiveChartPoints(rawValue.charts.costEvolution),
          departmentRisk: sanitizeExecutiveChartPoints(rawValue.charts.departmentRisk),
          operatorCosts: sanitizeExecutiveChartPoints(rawValue.charts.operatorCosts),
          scoreBreakdown: sanitizeExecutiveChartPoints(rawValue.charts.scoreBreakdown),
        }
      : {
          costEvolution: [],
          departmentRisk: [],
          operatorCosts: [],
          scoreBreakdown: [],
        },
    model: typeof rawValue.model === "string" ? rawValue.model : "llama3.2:3b",
    sources: sanitizeStringArray(rawValue.sources),
    summaryUpdatedAt: normalizeIsoDate(rawValue.summaryUpdatedAt),
    cached: Boolean(rawValue.cached),
    fallbackUsed: Boolean(rawValue.fallbackUsed),
    durationMs:
      typeof rawValue.durationMs === "number" && Number.isFinite(rawValue.durationMs)
        ? rawValue.durationMs
        : null,
  };
}

function sanitizeExplainability(rawValue: unknown): TelecomChatExplainability | null {
  if (!isObjectLike(rawValue) || typeof rawValue.answer !== "string") {
    return null;
  }

  const sanitizeStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const sanitizeRiskLevel = (
    value: unknown,
  ): "low" | "medium" | "high" | "critical" =>
    value === "low" || value === "medium" || value === "high" ? value : "critical";

  return {
    answer: rawValue.answer,
    confidence:
      typeof rawValue.confidence === "number" && Number.isFinite(rawValue.confidence)
        ? rawValue.confidence
        : 0,
    riskLevel: sanitizeRiskLevel(rawValue.riskLevel),
    reasoning: sanitizeStringArray(rawValue.reasoning),
    causes: sanitizeStringArray(rawValue.causes),
    influencingFactors: Array.isArray(rawValue.influencingFactors)
      ? rawValue.influencingFactors
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.label !== "string" ||
              typeof item.category !== "string" ||
              typeof item.value !== "string" ||
              typeof item.impactScore !== "number" ||
              !Number.isFinite(item.impactScore) ||
              typeof item.evidence !== "string"
            ) {
              return null;
            }
            return {
              label: item.label,
              category: item.category,
              value: item.value,
              impactScore: item.impactScore,
              severity: sanitizeRiskLevel(item.severity),
              evidence: item.evidence,
            };
          })
          .filter(
            (
              item,
            ): item is TelecomChatExplainability["influencingFactors"][number] => item !== null,
          )
      : [],
    explanationGraph: isObjectLike(rawValue.explanationGraph)
      ? {
          summary:
            typeof rawValue.explanationGraph.summary === "string"
              ? rawValue.explanationGraph.summary
              : "",
          dominantFactor:
            typeof rawValue.explanationGraph.dominantFactor === "string"
              ? rawValue.explanationGraph.dominantFactor
              : rawValue.explanationGraph.dominantFactor === null
                ? null
                : undefined,
          nodes: Array.isArray(rawValue.explanationGraph.nodes)
            ? rawValue.explanationGraph.nodes
                .map((item) => {
                  if (
                    !isObjectLike(item) ||
                    typeof item.nodeId !== "string" ||
                    typeof item.label !== "string" ||
                    typeof item.nodeType !== "string" ||
                    typeof item.weight !== "number" ||
                    !Number.isFinite(item.weight)
                  ) {
                    return null;
                  }
                  return {
                    nodeId: item.nodeId,
                    label: item.label,
                    nodeType:
                      item.nodeType === "signal" ||
                      item.nodeType === "cause" ||
                      item.nodeType === "impact" ||
                      item.nodeType === "zone"
                        ? item.nodeType
                        : "decision",
                    severity: sanitizeRiskLevel(item.severity),
                    weight: item.weight,
                  };
                })
                .filter(
                  (
                    item,
                  ): item is TelecomChatExplainability["explanationGraph"]["nodes"][number] =>
                    item !== null,
                )
            : [],
          edges: Array.isArray(rawValue.explanationGraph.edges)
            ? rawValue.explanationGraph.edges
                .map((item) => {
                  if (
                    !isObjectLike(item) ||
                    typeof item.source !== "string" ||
                    typeof item.target !== "string" ||
                    typeof item.relation !== "string"
                  ) {
                    return null;
                  }
                  return {
                    source: item.source,
                    target: item.target,
                    relation: item.relation,
                  };
                })
                .filter(
                  (
                    item,
                  ): item is TelecomChatExplainability["explanationGraph"]["edges"][number] =>
                    item !== null,
                )
            : [],
        }
      : {
          summary: "",
          nodes: [],
          edges: [],
        },
    criticalZones: Array.isArray(rawValue.criticalZones)
      ? rawValue.criticalZones
          .map((item) => {
            if (
              !isObjectLike(item) ||
              typeof item.label !== "string" ||
              typeof item.zoneType !== "string" ||
              typeof item.detail !== "string"
            ) {
              return null;
            }
            return {
              label: item.label,
              zoneType: item.zoneType,
              severity: sanitizeRiskLevel(item.severity),
              detail: item.detail,
              value:
                typeof item.value === "string"
                  ? item.value
                  : item.value === null
                    ? null
                    : undefined,
            };
          })
          .filter(
            (
              item,
            ): item is TelecomChatExplainability["criticalZones"][number] => item !== null,
          )
      : [],
    recommendations: sanitizeStringArray(rawValue.recommendations),
    dataPointsUsed: sanitizeStringArray(rawValue.dataPointsUsed),
    confidenceScore:
      typeof rawValue.confidenceScore === "number" && Number.isFinite(rawValue.confidenceScore)
        ? rawValue.confidenceScore
        : 0,
    fraudScore:
      typeof rawValue.fraudScore === "number" && Number.isFinite(rawValue.fraudScore)
        ? rawValue.fraudScore
        : 0,
    anomalyScore:
      typeof rawValue.anomalyScore === "number" && Number.isFinite(rawValue.anomalyScore)
        ? rawValue.anomalyScore
        : 0,
    optimizationScore:
      typeof rawValue.optimizationScore === "number" && Number.isFinite(rawValue.optimizationScore)
        ? rawValue.optimizationScore
        : 0,
    riskScore:
      typeof rawValue.riskScore === "number" && Number.isFinite(rawValue.riskScore)
        ? rawValue.riskScore
        : 0,
    equipmentScore:
      typeof rawValue.equipmentScore === "number" && Number.isFinite(rawValue.equipmentScore)
        ? rawValue.equipmentScore
        : 0,
    charts: isObjectLike(rawValue.charts)
      ? {
          factorBreakdown: sanitizeExecutiveChartPoints(rawValue.charts.factorBreakdown),
          riskTimeline: sanitizeExecutiveChartPoints(rawValue.charts.riskTimeline),
          criticalZoneHeatmap: sanitizeExecutiveChartPoints(rawValue.charts.criticalZoneHeatmap),
          scoreRadar: sanitizeExecutiveChartPoints(rawValue.charts.scoreRadar),
        }
      : {
          factorBreakdown: [],
          riskTimeline: [],
          criticalZoneHeatmap: [],
          scoreRadar: [],
        },
    model: typeof rawValue.model === "string" ? rawValue.model : "llama3.2:3b",
    sources: sanitizeStringArray(rawValue.sources),
    summaryUpdatedAt: normalizeIsoDate(rawValue.summaryUpdatedAt),
    cached: Boolean(rawValue.cached),
    fallbackUsed: Boolean(rawValue.fallbackUsed),
    durationMs:
      typeof rawValue.durationMs === "number" && Number.isFinite(rawValue.durationMs)
        ? rawValue.durationMs
        : null,
  };
}

function sanitizeMessage(rawValue: unknown): TelecomChatMessage | null {
  if (!isObjectLike(rawValue)) {
    return null;
  }

  if (typeof rawValue.id !== "string" || typeof rawValue.text !== "string") {
    return null;
  }

  const role = rawValue.role === "user" ? "user" : "assistant";
  const rawAttachment = isObjectLike(rawValue.attachment) ? rawValue.attachment : null;
  const rawImageAnalysis = isObjectLike(rawValue.imageAnalysis) ? rawValue.imageAnalysis : null;
  const inferDocumentType = (
    attachmentValue: Record<string, unknown>,
  ): TelecomChatDocumentType | undefined => {
    if (
      attachmentValue.documentType === "pdf" ||
      attachmentValue.documentType === "csv" ||
      attachmentValue.documentType === "xlsx" ||
      attachmentValue.documentType === "xls"
    ) {
      return attachmentValue.documentType;
    }

    const normalizedName =
      typeof attachmentValue.name === "string" ? attachmentValue.name.trim().toLowerCase() : "";
    if (normalizedName.endsWith(".pdf")) {
      return "pdf";
    }
    if (normalizedName.endsWith(".csv")) {
      return "csv";
    }
    if (normalizedName.endsWith(".xlsx")) {
      return "xlsx";
    }
    if (normalizedName.endsWith(".xls")) {
      return "xls";
    }

    const normalizedMimeType =
      typeof attachmentValue.mimeType === "string"
        ? attachmentValue.mimeType.trim().toLowerCase()
        : "";
    if (normalizedMimeType === "application/pdf") {
      return "pdf";
    }
    if (normalizedMimeType === "text/csv") {
      return "csv";
    }
    if (
      normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      return "xlsx";
    }
    if (normalizedMimeType === "application/vnd.ms-excel") {
      return "xls";
    }

    return undefined;
  };
  const requestKind =
    rawValue.requestKind === "executive_report"
      ? "executive_report"
      : rawValue.requestKind === "document" || rawValue.requestKind === "pdf"
        ? "document"
      : rawValue.requestKind === "image"
        ? "image"
        : rawAttachment
          ? rawAttachment.kind === "document" || rawAttachment.kind === "pdf"
            ? "document"
            : "image"
          : "text";

  return {
    id: rawValue.id,
    role,
    text: rawValue.text,
    createdAt: normalizeIsoDate(rawValue.createdAt),
    status: rawValue.status === "error" ? "error" : "complete",
    bullets: Array.isArray(rawValue.bullets)
      ? rawValue.bullets.filter((item): item is string => typeof item === "string")
      : undefined,
    recommendation: typeof rawValue.recommendation === "string" ? rawValue.recommendation : undefined,
    ctaLabel: typeof rawValue.ctaLabel === "string" ? rawValue.ctaLabel : undefined,
    ctaPath: typeof rawValue.ctaPath === "string" ? rawValue.ctaPath : undefined,
    sources: Array.isArray(rawValue.sources)
      ? rawValue.sources.filter((item): item is string => typeof item === "string")
      : undefined,
    linkedUserMessageId:
      typeof rawValue.linkedUserMessageId === "string" ? rawValue.linkedUserMessageId : null,
    requestKind,
    isEdited: Boolean(rawValue.isEdited) || typeof rawValue.editedAt === "string",
    editedAt:
      typeof rawValue.editedAt === "string" && rawValue.editedAt.trim() !== ""
        ? normalizeIsoDate(rawValue.editedAt)
        : null,
    loadingLabel:
      typeof rawValue.loadingLabel === "string" && rawValue.loadingLabel.trim() !== ""
        ? rawValue.loadingLabel.trim()
        : null,
    attachment:
      rawAttachment &&
      typeof rawAttachment.name === "string" &&
      typeof rawAttachment.mimeType === "string" &&
      typeof rawAttachment.previewUrl === "string"
        ? {
            kind:
              rawAttachment.kind === "document" || rawAttachment.kind === "pdf"
                ? "document"
                : "image",
            name: rawAttachment.name,
            mimeType: rawAttachment.mimeType,
            previewUrl: normalizeAttachmentPreviewUrl(rawAttachment.previewUrl),
            sizeBytes:
              typeof rawAttachment.sizeBytes === "number" && Number.isFinite(rawAttachment.sizeBytes)
                ? rawAttachment.sizeBytes
                : undefined,
            ...(
              rawAttachment.kind === "document" || rawAttachment.kind === "pdf"
              ? {
                  documentType: inferDocumentType(rawAttachment),
                  pageCount:
                    typeof rawAttachment.pageCount === "number" &&
                    Number.isFinite(rawAttachment.pageCount)
                      ? rawAttachment.pageCount
                      : undefined,
                }
              : {}
            ),
          }
        : null,
    imageAnalysis:
      rawImageAnalysis &&
      typeof rawImageAnalysis.imageType === "string"
        ? {
            imageType: rawImageAnalysis.imageType,
            confidence:
              typeof rawImageAnalysis.confidence === "number" &&
              Number.isFinite(rawImageAnalysis.confidence)
                ? rawImageAnalysis.confidence
                : null,
            ocrConfidence:
              typeof rawImageAnalysis.ocrConfidence === "number" &&
              Number.isFinite(rawImageAnalysis.ocrConfidence)
                ? rawImageAnalysis.ocrConfidence
                : null,
            detectedOperator:
              typeof rawImageAnalysis.detectedOperator === "string"
                ? rawImageAnalysis.detectedOperator
                : undefined,
            detectedAnomalies: Array.isArray(rawImageAnalysis.detectedAnomalies)
              ? rawImageAnalysis.detectedAnomalies.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            analysisMetadata:
              isObjectLike(rawImageAnalysis.analysisMetadata) &&
              typeof rawImageAnalysis.analysisMetadata.sourceMode === "string"
                ? {
                    sourceMode: rawImageAnalysis.analysisMetadata.sourceMode,
                    visibleKpisUsed: Array.isArray(rawImageAnalysis.analysisMetadata.visibleKpisUsed)
                      ? rawImageAnalysis.analysisMetadata.visibleKpisUsed.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : [],
                    blockedGlobalContext: Boolean(
                      rawImageAnalysis.analysisMetadata.blockedGlobalContext,
                    ),
                    removedUnverifiedClaims: Array.isArray(
                      rawImageAnalysis.analysisMetadata.removedUnverifiedClaims,
                    )
                      ? rawImageAnalysis.analysisMetadata.removedUnverifiedClaims.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : [],
                    filteredNumbers: Array.isArray(rawImageAnalysis.analysisMetadata.filteredNumbers)
                      ? rawImageAnalysis.analysisMetadata.filteredNumbers.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : [],
                    confidenceScore:
                      typeof rawImageAnalysis.analysisMetadata.confidenceScore === "number" &&
                      Number.isFinite(rawImageAnalysis.analysisMetadata.confidenceScore)
                        ? rawImageAnalysis.analysisMetadata.confidenceScore
                        : 0,
                  }
                : undefined,
            ocrText:
              typeof rawImageAnalysis.ocrText === "string"
                ? rawImageAnalysis.ocrText
                : undefined,
            visionAnalysis:
              typeof rawImageAnalysis.visionAnalysis === "string"
                ? rawImageAnalysis.visionAnalysis
                : undefined,
            detectedKpis: Array.isArray(rawImageAnalysis.detectedKpis)
              ? rawImageAnalysis.detectedKpis.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            recommendations: Array.isArray(rawImageAnalysis.recommendations)
              ? rawImageAnalysis.recommendations.filter(
                  (item): item is string => typeof item === "string",
                )
              : undefined,
            decisionRecommendations: Array.isArray(rawImageAnalysis.decisionRecommendations)
              ? rawImageAnalysis.decisionRecommendations
                  .map((recommendation) => {
                    if (
                      !isObjectLike(recommendation) ||
                      typeof recommendation.title !== "string" ||
                      typeof recommendation.priority !== "string" ||
                      typeof recommendation.impact !== "string" ||
                      typeof recommendation.reason !== "string"
                    ) {
                      return null;
                    }
                    return {
                      title: recommendation.title,
                      priority:
                        recommendation.priority === "critical" ||
                        recommendation.priority === "high" ||
                        recommendation.priority === "medium"
                          ? recommendation.priority
                          : "low",
                      impact: recommendation.impact,
                      estimatedSaving:
                        typeof recommendation.estimatedSaving === "string"
                          ? recommendation.estimatedSaving
                          : recommendation.estimatedSaving === null
                            ? null
                            : undefined,
                      reason: recommendation.reason,
                    };
                  })
                  .filter(
                    (
                      item,
                    ): item is {
                      title: string;
                      priority: "low" | "medium" | "high" | "critical";
                      impact: string;
                      estimatedSaving?: string | null;
                      reason: string;
                    } => item !== null,
                  )
              : undefined,
            recommendationNotice:
              typeof rawImageAnalysis.recommendationNotice === "string"
                ? rawImageAnalysis.recommendationNotice
                : rawImageAnalysis.recommendationNotice === null
                  ? null
                  : undefined,
            riskLevel:
              rawImageAnalysis.riskLevel === "critical" ||
              rawImageAnalysis.riskLevel === "high" ||
              rawImageAnalysis.riskLevel === "medium" ||
              rawImageAnalysis.riskLevel === "low"
                ? rawImageAnalysis.riskLevel
                : rawImageAnalysis.riskLevel === null
                  ? null
                  : undefined,
            optimizationScore:
              typeof rawImageAnalysis.optimizationScore === "number" &&
              Number.isFinite(rawImageAnalysis.optimizationScore)
                ? rawImageAnalysis.optimizationScore
                : null,
            anomalyScore:
              typeof rawImageAnalysis.anomalyScore === "number" &&
              Number.isFinite(rawImageAnalysis.anomalyScore)
                ? rawImageAnalysis.anomalyScore
                : null,
            fraudScore:
              typeof rawImageAnalysis.fraudScore === "number" &&
              Number.isFinite(rawImageAnalysis.fraudScore)
                ? rawImageAnalysis.fraudScore
                : null,
            costScore:
              typeof rawImageAnalysis.costScore === "number" &&
              Number.isFinite(rawImageAnalysis.costScore)
                ? rawImageAnalysis.costScore
                : null,
            highlightedImage:
              typeof rawImageAnalysis.highlightedImage === "string"
                ? rawImageAnalysis.highlightedImage
                : rawImageAnalysis.highlightedImage === null
                  ? null
                  : undefined,
            annotations: Array.isArray(rawImageAnalysis.annotations)
              ? rawImageAnalysis.annotations
                  .map((annotation) => {
                    if (!isObjectLike(annotation) || typeof annotation.label !== "string" || typeof annotation.type !== "string" || !Array.isArray(annotation.bbox) || annotation.bbox.length !== 4) {
                      return null;
                    }
                    const bboxValues = annotation.bbox.map((value) =>
                      typeof value === "number" && Number.isFinite(value) ? Math.round(value) : NaN,
                    );
                    if (bboxValues.some((value) => Number.isNaN(value))) {
                      return null;
                    }
                    return {
                      label: annotation.label,
                      type: annotation.type,
                      bbox: bboxValues as [number, number, number, number],
                      confidence:
                        typeof annotation.confidence === "number" &&
                        Number.isFinite(annotation.confidence)
                          ? annotation.confidence
                          : 0,
                    };
                  })
                  .filter(
                    (
                      item,
                    ): item is {
                      label: string;
                      type: string;
                      bbox: [number, number, number, number];
                      confidence: number;
                    } => item !== null,
                  )
              : undefined,
            invoiceDetails:
              isObjectLike(rawImageAnalysis.invoiceDetails)
                ? {
                    operator:
                      typeof rawImageAnalysis.invoiceDetails.operator === "string"
                        ? rawImageAnalysis.invoiceDetails.operator
                        : undefined,
                    invoiceNumber:
                      typeof rawImageAnalysis.invoiceDetails.invoiceNumber === "string"
                        ? rawImageAnalysis.invoiceDetails.invoiceNumber
                        : undefined,
                    invoiceDate:
                      typeof rawImageAnalysis.invoiceDetails.invoiceDate === "string"
                        ? rawImageAnalysis.invoiceDetails.invoiceDate
                        : undefined,
                    billingPeriod:
                      typeof rawImageAnalysis.invoiceDetails.billingPeriod === "string"
                        ? rawImageAnalysis.invoiceDetails.billingPeriod
                        : undefined,
                    amountHtMad:
                      typeof rawImageAnalysis.invoiceDetails.amountHtMad === "string"
                        ? rawImageAnalysis.invoiceDetails.amountHtMad
                        : undefined,
                    vatAmountMad:
                      typeof rawImageAnalysis.invoiceDetails.vatAmountMad === "string"
                        ? rawImageAnalysis.invoiceDetails.vatAmountMad
                        : undefined,
                    amountTtcMad:
                      typeof rawImageAnalysis.invoiceDetails.amountTtcMad === "string"
                        ? rawImageAnalysis.invoiceDetails.amountTtcMad
                        : undefined,
                    totalAmountMad:
                      typeof rawImageAnalysis.invoiceDetails.totalAmountMad === "string"
                        ? rawImageAnalysis.invoiceDetails.totalAmountMad
                        : undefined,
                    billedLines: Array.isArray(rawImageAnalysis.invoiceDetails.billedLines)
                      ? rawImageAnalysis.invoiceDetails.billedLines.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    additionalFees: Array.isArray(rawImageAnalysis.invoiceDetails.additionalFees)
                      ? rawImageAnalysis.invoiceDetails.additionalFees.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    overageItems: Array.isArray(rawImageAnalysis.invoiceDetails.overageItems)
                      ? rawImageAnalysis.invoiceDetails.overageItems.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    anomalies: Array.isArray(rawImageAnalysis.invoiceDetails.anomalies)
                      ? rawImageAnalysis.invoiceDetails.anomalies.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                  }
                : undefined,
            incidentDetails:
              isObjectLike(rawImageAnalysis.incidentDetails)
                ? {
                    alertType:
                      typeof rawImageAnalysis.incidentDetails.alertType === "string"
                        ? rawImageAnalysis.incidentDetails.alertType
                        : undefined,
                    severity:
                      typeof rawImageAnalysis.incidentDetails.severity === "string"
                        ? rawImageAnalysis.incidentDetails.severity
                        : undefined,
                    detectedAt:
                      typeof rawImageAnalysis.incidentDetails.detectedAt === "string"
                        ? rawImageAnalysis.incidentDetails.detectedAt
                        : undefined,
                    operator:
                      typeof rawImageAnalysis.incidentDetails.operator === "string"
                        ? rawImageAnalysis.incidentDetails.operator
                        : undefined,
                    lineReference:
                      typeof rawImageAnalysis.incidentDetails.lineReference === "string"
                        ? rawImageAnalysis.incidentDetails.lineReference
                        : undefined,
                    suspectCostMad:
                      typeof rawImageAnalysis.incidentDetails.suspectCostMad === "string"
                        ? rawImageAnalysis.incidentDetails.suspectCostMad
                        : undefined,
                    callVolume:
                      typeof rawImageAnalysis.incidentDetails.callVolume === "string"
                        ? rawImageAnalysis.incidentDetails.callVolume
                        : undefined,
                    dataOverage:
                      typeof rawImageAnalysis.incidentDetails.dataOverage === "string"
                        ? rawImageAnalysis.incidentDetails.dataOverage
                        : undefined,
                    errorMessage:
                      typeof rawImageAnalysis.incidentDetails.errorMessage === "string"
                        ? rawImageAnalysis.incidentDetails.errorMessage
                        : undefined,
                    priority:
                      typeof rawImageAnalysis.incidentDetails.priority === "string"
                        ? rawImageAnalysis.incidentDetails.priority
                        : undefined,
                    summary:
                      typeof rawImageAnalysis.incidentDetails.summary === "string"
                        ? rawImageAnalysis.incidentDetails.summary
                        : undefined,
                    criticalAlertCount:
                      typeof rawImageAnalysis.incidentDetails.criticalAlertCount === "number"
                        ? rawImageAnalysis.incidentDetails.criticalAlertCount
                        : null,
                    exposureRate:
                      typeof rawImageAnalysis.incidentDetails.exposureRate === "string"
                        ? rawImageAnalysis.incidentDetails.exposureRate
                        : undefined,
                    exposureRatePct:
                      typeof rawImageAnalysis.incidentDetails.exposureRatePct === "number"
                        ? rawImageAnalysis.incidentDetails.exposureRatePct
                        : null,
                    financialImpactMad:
                      typeof rawImageAnalysis.incidentDetails.financialImpactMad === "string"
                        ? rawImageAnalysis.incidentDetails.financialImpactMad
                        : undefined,
                    financialImpactValueMad:
                      typeof rawImageAnalysis.incidentDetails.financialImpactValueMad === "number"
                        ? rawImageAnalysis.incidentDetails.financialImpactValueMad
                        : null,
                    averageScore:
                      typeof rawImageAnalysis.incidentDetails.averageScore === "string"
                        ? rawImageAnalysis.incidentDetails.averageScore
                        : undefined,
                    averageScoreValue:
                      typeof rawImageAnalysis.incidentDetails.averageScoreValue === "number"
                        ? rawImageAnalysis.incidentDetails.averageScoreValue
                        : null,
                    riskScore:
                      typeof rawImageAnalysis.incidentDetails.riskScore === "string"
                        ? rawImageAnalysis.incidentDetails.riskScore
                        : undefined,
                    maxRiskScores: Array.isArray(rawImageAnalysis.incidentDetails.maxRiskScores)
                      ? rawImageAnalysis.incidentDetails.maxRiskScores.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    riskyEntities: Array.isArray(rawImageAnalysis.incidentDetails.riskyEntities)
                      ? rawImageAnalysis.incidentDetails.riskyEntities.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    repeatedAnomalies: Array.isArray(
                      rawImageAnalysis.incidentDetails.repeatedAnomalies,
                    )
                      ? rawImageAnalysis.incidentDetails.repeatedAnomalies.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    visibleStatuses: Array.isArray(rawImageAnalysis.incidentDetails.visibleStatuses)
                      ? rawImageAnalysis.incidentDetails.visibleStatuses.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    criticalSignals: Array.isArray(rawImageAnalysis.incidentDetails.criticalSignals)
                      ? rawImageAnalysis.incidentDetails.criticalSignals.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    probableCauses: Array.isArray(rawImageAnalysis.incidentDetails.probableCauses)
                      ? rawImageAnalysis.incidentDetails.probableCauses.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                  }
                : undefined,
            alertIntelligence:
              isObjectLike(rawImageAnalysis.alertIntelligence)
                ? {
                    alertFamily:
                      typeof rawImageAnalysis.alertIntelligence.alertFamily === "string"
                        ? rawImageAnalysis.alertIntelligence.alertFamily
                        : undefined,
                    aiRiskScore:
                      typeof rawImageAnalysis.alertIntelligence.aiRiskScore === "number" &&
                      Number.isFinite(rawImageAnalysis.alertIntelligence.aiRiskScore)
                        ? rawImageAnalysis.alertIntelligence.aiRiskScore
                        : null,
                    ocrConfidenceScore:
                      typeof rawImageAnalysis.alertIntelligence.ocrConfidenceScore === "number" &&
                      Number.isFinite(rawImageAnalysis.alertIntelligence.ocrConfidenceScore)
                        ? rawImageAnalysis.alertIntelligence.ocrConfidenceScore
                        : null,
                    criticity:
                      rawImageAnalysis.alertIntelligence.criticity === "critical" ||
                      rawImageAnalysis.alertIntelligence.criticity === "high" ||
                      rawImageAnalysis.alertIntelligence.criticity === "medium" ||
                      rawImageAnalysis.alertIntelligence.criticity === "low"
                        ? rawImageAnalysis.alertIntelligence.criticity
                        : rawImageAnalysis.alertIntelligence.criticity === null
                          ? null
                          : undefined,
                    executiveSummary:
                      typeof rawImageAnalysis.alertIntelligence.executiveSummary === "string"
                        ? rawImageAnalysis.alertIntelligence.executiveSummary
                        : undefined,
                    businessRisk:
                      typeof rawImageAnalysis.alertIntelligence.businessRisk === "string"
                        ? rawImageAnalysis.alertIntelligence.businessRisk
                        : undefined,
                    financialExposureMad:
                      typeof rawImageAnalysis.alertIntelligence.financialExposureMad === "string"
                        ? rawImageAnalysis.alertIntelligence.financialExposureMad
                        : undefined,
                    potentialLossMad:
                      typeof rawImageAnalysis.alertIntelligence.potentialLossMad === "string"
                        ? rawImageAnalysis.alertIntelligence.potentialLossMad
                        : undefined,
                    possibleSavingsMad:
                      typeof rawImageAnalysis.alertIntelligence.possibleSavingsMad === "string"
                        ? rawImageAnalysis.alertIntelligence.possibleSavingsMad
                        : undefined,
                    priorityKpis: Array.isArray(rawImageAnalysis.alertIntelligence.priorityKpis)
                      ? rawImageAnalysis.alertIntelligence.priorityKpis.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    visibleEvidence: Array.isArray(rawImageAnalysis.alertIntelligence.visibleEvidence)
                      ? rawImageAnalysis.alertIntelligence.visibleEvidence.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    atRiskEntities: Array.isArray(rawImageAnalysis.alertIntelligence.atRiskEntities)
                      ? rawImageAnalysis.alertIntelligence.atRiskEntities.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    immediateActions: Array.isArray(rawImageAnalysis.alertIntelligence.immediateActions)
                      ? rawImageAnalysis.alertIntelligence.immediateActions.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    recommendedControls: Array.isArray(rawImageAnalysis.alertIntelligence.recommendedControls)
                      ? rawImageAnalysis.alertIntelligence.recommendedControls.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    alertTimeline: Array.isArray(rawImageAnalysis.alertIntelligence.alertTimeline)
                      ? rawImageAnalysis.alertIntelligence.alertTimeline
                          .filter(isObjectLike)
                          .map((item) => ({
                            label: typeof item.label === "string" ? item.label : "",
                            detail: typeof item.detail === "string" ? item.detail : "",
                            status:
                              item.status === "critical" ||
                              item.status === "watch" ||
                              item.status === "action" ||
                              item.status === "observed"
                                ? item.status
                                : undefined,
                          }))
                          .filter((item) => item.label && item.detail)
                      : undefined,
                    auditFocus:
                      typeof rawImageAnalysis.alertIntelligence.auditFocus === "string"
                        ? rawImageAnalysis.alertIntelligence.auditFocus
                        : undefined,
                  }
                : undefined,
            workflowDetails:
              isObjectLike(rawImageAnalysis.workflowDetails)
                ? {
                    workflowType:
                      typeof rawImageAnalysis.workflowDetails.workflowType === "string"
                        ? rawImageAnalysis.workflowDetails.workflowType
                        : undefined,
                    complexityScore:
                      typeof rawImageAnalysis.workflowDetails.complexityScore === "number" &&
                      Number.isFinite(rawImageAnalysis.workflowDetails.complexityScore)
                        ? rawImageAnalysis.workflowDetails.complexityScore
                        : null,
                    complexityLevel:
                      rawImageAnalysis.workflowDetails.complexityLevel === "critical" ||
                      rawImageAnalysis.workflowDetails.complexityLevel === "high" ||
                      rawImageAnalysis.workflowDetails.complexityLevel === "medium" ||
                      rawImageAnalysis.workflowDetails.complexityLevel === "low"
                        ? rawImageAnalysis.workflowDetails.complexityLevel
                        : rawImageAnalysis.workflowDetails.complexityLevel === null
                          ? null
                          : undefined,
                    criticalSteps: Array.isArray(rawImageAnalysis.workflowDetails.criticalSteps)
                      ? rawImageAnalysis.workflowDetails.criticalSteps.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    detectedDepartments: Array.isArray(rawImageAnalysis.workflowDetails.detectedDepartments)
                      ? rawImageAnalysis.workflowDetails.detectedDepartments.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    detectedRoles: Array.isArray(rawImageAnalysis.workflowDetails.detectedRoles)
                      ? rawImageAnalysis.workflowDetails.detectedRoles.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    automationOpportunities: Array.isArray(rawImageAnalysis.workflowDetails.automationOpportunities)
                      ? rawImageAnalysis.workflowDetails.automationOpportunities.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    bottlenecks: Array.isArray(rawImageAnalysis.workflowDetails.bottlenecks)
                      ? rawImageAnalysis.workflowDetails.bottlenecks.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    repeatedValidations: Array.isArray(rawImageAnalysis.workflowDetails.repeatedValidations)
                      ? rawImageAnalysis.workflowDetails.repeatedValidations.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    summary:
                      typeof rawImageAnalysis.workflowDetails.summary === "string"
                        ? rawImageAnalysis.workflowDetails.summary
                        : undefined,
                  }
                : undefined,
            equipmentDetails:
              isObjectLike(rawImageAnalysis.equipmentDetails)
                ? {
                    equipmentType:
                      typeof rawImageAnalysis.equipmentDetails.equipmentType === "string"
                        ? rawImageAnalysis.equipmentDetails.equipmentType
                        : undefined,
                    brand:
                      typeof rawImageAnalysis.equipmentDetails.brand === "string"
                        ? rawImageAnalysis.equipmentDetails.brand
                        : undefined,
                    model:
                      typeof rawImageAnalysis.equipmentDetails.model === "string"
                        ? rawImageAnalysis.equipmentDetails.model
                        : undefined,
                    serialNumber:
                      typeof rawImageAnalysis.equipmentDetails.serialNumber === "string"
                        ? rawImageAnalysis.equipmentDetails.serialNumber
                        : undefined,
                    operator:
                      typeof rawImageAnalysis.equipmentDetails.operator === "string"
                        ? rawImageAnalysis.equipmentDetails.operator
                        : undefined,
                    visibleCondition:
                      typeof rawImageAnalysis.equipmentDetails.visibleCondition === "string"
                        ? rawImageAnalysis.equipmentDetails.visibleCondition
                        : undefined,
                    deviceVersion:
                      typeof rawImageAnalysis.equipmentDetails.deviceVersion === "string"
                        ? rawImageAnalysis.equipmentDetails.deviceVersion
                        : undefined,
                    simInformation:
                      typeof rawImageAnalysis.equipmentDetails.simInformation === "string"
                        ? rawImageAnalysis.equipmentDetails.simInformation
                        : undefined,
                    labelInformation:
                      typeof rawImageAnalysis.equipmentDetails.labelInformation === "string"
                        ? rawImageAnalysis.equipmentDetails.labelInformation
                        : undefined,
                    usageSummary:
                      typeof rawImageAnalysis.equipmentDetails.usageSummary === "string"
                        ? rawImageAnalysis.equipmentDetails.usageSummary
                        : undefined,
                    detectedIssues: Array.isArray(rawImageAnalysis.equipmentDetails.detectedIssues)
                      ? rawImageAnalysis.equipmentDetails.detectedIssues.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    maintenanceRecommendations: Array.isArray(
                      rawImageAnalysis.equipmentDetails.maintenanceRecommendations,
                    )
                      ? rawImageAnalysis.equipmentDetails.maintenanceRecommendations.filter(
                          (item): item is string => typeof item === "string",
                        )
                      : undefined,
                    replacementNeeded:
                      typeof rawImageAnalysis.equipmentDetails.replacementNeeded === "boolean"
                        ? rawImageAnalysis.equipmentDetails.replacementNeeded
                        : undefined,
                    conditionScore:
                      typeof rawImageAnalysis.equipmentDetails.conditionScore === "number" &&
                      Number.isFinite(rawImageAnalysis.equipmentDetails.conditionScore)
                        ? rawImageAnalysis.equipmentDetails.conditionScore
                        : null,
                    criticalityScore:
                      typeof rawImageAnalysis.equipmentDetails.criticalityScore === "number" &&
                      Number.isFinite(rawImageAnalysis.equipmentDetails.criticalityScore)
                        ? rawImageAnalysis.equipmentDetails.criticalityScore
                        : null,
                    obsolescenceScore:
                      typeof rawImageAnalysis.equipmentDetails.obsolescenceScore === "number" &&
                      Number.isFinite(rawImageAnalysis.equipmentDetails.obsolescenceScore)
                        ? rawImageAnalysis.equipmentDetails.obsolescenceScore
                        : null,
                    maintenanceScore:
                      typeof rawImageAnalysis.equipmentDetails.maintenanceScore === "number" &&
                      Number.isFinite(rawImageAnalysis.equipmentDetails.maintenanceScore)
                        ? rawImageAnalysis.equipmentDetails.maintenanceScore
                        : null,
                    summary:
                      typeof rawImageAnalysis.equipmentDetails.summary === "string"
                        ? rawImageAnalysis.equipmentDetails.summary
                        : undefined,
                  }
                : undefined,
        }
      : null,
    executiveReport: sanitizeExecutiveReport(rawValue.executiveReport),
    explainability: sanitizeExplainability(rawValue.explainability),
  };
}

function sanitizeConversation(rawValue: unknown): TelecomChatConversation | null {
  if (!isObjectLike(rawValue)) {
    return null;
  }

  if (typeof rawValue.id !== "string") {
    return null;
  }

  const messages = Array.isArray(rawValue.messages)
    ? rawValue.messages
        .map((message) => sanitizeMessage(message))
        .filter((message): message is TelecomChatMessage => message !== null)
    : [];

  const createdAt = normalizeIsoDate(rawValue.createdAt);
  const updatedAtCandidate =
    messages[messages.length - 1]?.createdAt ?? normalizeIsoDate(rawValue.updatedAt);

  return {
    id: rawValue.id,
    title:
      typeof rawValue.title === "string" && rawValue.title.trim() !== ""
        ? rawValue.title.trim()
        : DEFAULT_CONVERSATION_TITLE,
    createdAt,
    updatedAt: updatedAtCandidate,
    messages,
  };
}

function readRootStorage(): RootChatStorage {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(CHATBOT_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!isObjectLike(parsedValue)) {
      return {};
    }

    return parsedValue as RootChatStorage;
  } catch {
    return {};
  }
}

function writeRootStorage(nextValue: RootChatStorage): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CHATBOT_STORAGE_KEY, JSON.stringify(nextValue));
  } catch {
    // Ignore storage quota and private mode issues to keep the assistant usable.
  }
}

export function sortTelecomConversations(
  conversations: TelecomChatConversation[],
): TelecomChatConversation[] {
  return [...conversations].sort((leftConversation, rightConversation) => {
    return (
      new Date(rightConversation.updatedAt).getTime() -
        new Date(leftConversation.updatedAt).getTime() ||
      new Date(rightConversation.createdAt).getTime() -
        new Date(leftConversation.createdAt).getTime()
    );
  });
}

export function loadStoredTelecomChatState(scope: string): TelecomChatStoredState {
  const rootStorage = readRootStorage();
  const scopedStorage = rootStorage[scope];

  if (!scopedStorage) {
    return {
      lastConversationId: null,
      conversations: [],
    };
  }

  const conversations = Array.isArray(scopedStorage.conversations)
    ? scopedStorage.conversations
        .map((conversation) => sanitizeConversation(conversation))
        .filter((conversation): conversation is TelecomChatConversation => conversation !== null)
    : [];

  return {
    lastConversationId:
      typeof scopedStorage.lastConversationId === "string"
        ? scopedStorage.lastConversationId
        : conversations[0]?.id ?? null,
    conversations: sortTelecomConversations(conversations),
  };
}

export function saveStoredTelecomChatState(
  scope: string,
  state: TelecomChatStoredState,
): void {
  const rootStorage = readRootStorage();
  const nextConversations = sortTelecomConversations(state.conversations)
    .map((conversation) => sanitizeConversationForStorage(conversation))
    .slice(0, MAX_STORED_CONVERSATIONS);
  const nextState: TelecomChatStoredState = {
    lastConversationId:
      state.lastConversationId &&
      nextConversations.some((conversation) => conversation.id === state.lastConversationId)
        ? state.lastConversationId
        : nextConversations[0]?.id ?? null,
    conversations: nextConversations,
  };

  writeRootStorage({
    ...rootStorage,
    [scope]: nextState,
  });
}

export function createTelecomConversation(
  welcomeMessage: TelecomChatMessage,
): TelecomChatConversation {
  const now = welcomeMessage.createdAt || new Date().toISOString();

  return {
    id: createUuid(),
    title: DEFAULT_CONVERSATION_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [welcomeMessage],
  };
}

export function deriveTelecomConversationTitle(
  question: string,
  suggestedTitle?: string | null,
): string {
  const normalizedSuggestion = suggestedTitle?.trim();
  if (normalizedSuggestion) {
    return normalizedSuggestion.length > 58
      ? `${normalizedSuggestion.slice(0, 58).trim()}...`
      : normalizedSuggestion;
  }

  const normalizedQuestion = question.replace(/\s+/g, " ").trim();
  if (normalizedQuestion === "") {
    return DEFAULT_CONVERSATION_TITLE;
  }

  return normalizedQuestion.length > 58
    ? `${normalizedQuestion.slice(0, 58).trim()}...`
    : normalizedQuestion;
}

export function collectRecentTelecomPrompts(
  conversations: TelecomChatConversation[],
  limit = 8,
): string[] {
  const uniquePrompts = new Set<string>();
  const recentPrompts: string[] = [];

  sortTelecomConversations(conversations).forEach((conversation) => {
    [...conversation.messages]
      .reverse()
      .filter((message) => message.role === "user")
      .forEach((message) => {
        const normalizedPrompt = message.text.trim();
        if (normalizedPrompt === "" || uniquePrompts.has(normalizedPrompt)) {
          return;
        }

        uniquePrompts.add(normalizedPrompt);
        recentPrompts.push(normalizedPrompt);
      });
  });

  return recentPrompts.slice(0, limit);
}
