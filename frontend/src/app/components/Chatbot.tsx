import {
  ArrowUpRight,
  Brain,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  FileText,
  FileImage,
  History,
  ImagePlus,
  Link2,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Mic,
  MicOff,
  Minimize2,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Repeat,
  RotateCcw,
  SendHorizontal,
  SlidersHorizontal,
  Square,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import {
  assistantQuestionSuggestions,
} from "../lib/chatbot-engine";
import {
  loadTelecomAssistantDataset,
  type TelecomAssistantDataset,
} from "../lib/chatbot-data";
import {
  ApiError,
  type ApiChatActionPlanItem,
  type ApiChatActionPlanResponse,
  chatApi,
  type ApiChatImageResponse,
  type ApiImageAnalysisMode,
  type ApiReportGenerateResponse,
  type ApiReportType,
  type ApiChatResponse,
  type ApiExplainRecommendationResponse,
  type ApiExplainabilityExecutiveContext,
  type ApiExplainabilityResponse,
  type ApiExecutiveReportImageContext,
  type ApiExecutiveReportResponse,
  type ApiRoamingIntelligenceResponse,
  type ApiVoiceSpeakResponse,
  type ApiVoiceStreamAudio,
  reportsApi,
  roamingApi,
} from "../lib/api";
import { exportExecutiveReportPdf } from "../lib/executive-report-export";
import {
  buildGeoQuestionAssistantContent,
  buildGeoQuestionUnavailableContent,
  isGeoQuestion,
} from "../lib/chatbot-geo";
import {
  collectRecentTelecomPrompts,
  createTelecomConversation,
  DEFAULT_CONVERSATION_TITLE,
  deriveTelecomConversationTitle,
  loadStoredTelecomChatState,
  saveStoredTelecomChatState,
  sortTelecomConversations,
  type TelecomChatConversation,
  type TelecomChatExplainability,
  type TelecomChatAttachment,
  type TelecomChatDocumentType,
  type TelecomChatImageAnalysis,
  type TelecomChatImageAttachment,
  type TelecomChatMessage,
  type TelecomChatPdfAttachment,
  type TelecomExecutiveReport,
} from "../lib/chatbot-storage";
import { createUuid } from "../lib/uuid";
import CopilotActionPlanCard from "./chatbot/CopilotActionPlanCard";
import ExplainabilityCard from "./chatbot/ExplainabilityCard";
import AiReportGenerationCard from "./chatbot/AiReportGenerationCard";
import ExecutiveReportCard from "./chatbot/ExecutiveReportCard";
import { ExplainRecommendationModal } from "./ExplainRecommendationModal";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { cn } from "./ui/utils";

const CONVERSATION_PAGE_SIZE = 10;
const INITIAL_VISIBLE_MESSAGE_COUNT = 14;
const VISIBLE_MESSAGE_STEP = 12;
const INLINE_SUGGESTION_COUNT = 3;
const MAX_CONVERSATION_TITLE_LENGTH = 50;
const MAX_COMPOSER_IMAGE_INPUT_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_COMPRESSED_COMPOSER_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_COMPOSER_DOCUMENT_INPUT_SIZE_BYTES = 30 * 1024 * 1024;
const COMPOSER_IMAGE_MAX_WIDTH = 1200;
const COMPOSER_IMAGE_JPEG_QUALITY = 0.75;
const MAX_VOICE_AUDIO_SIZE_BYTES = 12 * 1024 * 1024;
const COMPOSER_DOCUMENT_ACCEPT =
  ".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SUPPORTED_COMPOSER_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const SUPPORTED_COMPOSER_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const SUPPORTED_COMPOSER_DOCUMENT_EXTENSIONS = new Set(["pdf", "csv", "xlsx", "xls"]);
const SUPPORTED_VOICE_RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const VOICE_VISUALIZER_BAR_COUNT = 16;
const IDLE_VOICE_VISUALIZER_LEVELS = [
  0.22, 0.34, 0.2, 0.42, 0.28, 0.46, 0.24, 0.38,
  0.26, 0.44, 0.22, 0.36, 0.2, 0.32, 0.18, 0.28,
];
const ENABLE_CHATBOT_DEBUG_LOGS = import.meta.env.DEV;

function debugChatbot(label: string, payload?: Record<string, unknown>): void {
  if (!ENABLE_CHATBOT_DEBUG_LOGS) {
    return;
  }

  if (payload) {
    console.debug(label, payload);
    return;
  }

  console.debug(label);
}

function formatConversationDate(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: isSameDay ? undefined : "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMessageTimestamp(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildChatScope(userId: number | null | undefined): string {
  return userId ? `telecom-assistant:user:${userId}` : "telecom-assistant:guest";
}

function buildWelcomeMessage(firstName?: string | null): TelecomChatMessage {
  const createdAt = new Date().toISOString();

  return {
    id: `assistant-welcome-${createUuid()}`,
    role: "assistant",
    text: firstName
      ? `Bonjour ${firstName}. Je peux vous aider a analyser votre flotte telecom.`
      : "Je peux vous aider a analyser votre flotte telecom.",
    createdAt,
    status: "complete",
    bullets: [
      "Budget operateur et departement",
      "Etat des lignes libres ou critiques",
      "Forfaits trop chers et optimisations",
      "Explication des alertes importantes",
    ],
    recommendation: "Posez une question metier courte ou utilisez une suggestion ci-dessous.",
    sources: ["Memoire locale de l'assistant initialisee"],
    linkedUserMessageId: null,
  };
}

interface AssistantResponseContent {
  text: string;
  bullets?: string[];
  recommendation?: string;
  ctaLabel?: string;
  ctaPath?: string;
  sources?: string[];
  imageAnalysis?: TelecomChatImageAnalysis | null;
  executiveReport?: TelecomExecutiveReport | null;
  requestKind?: "text" | "image" | "document" | "executive_report";
}

interface ActiveChatStream {
  mode: "text" | "image" | "document" | "executive_report" | "voice";
  controller: AbortController;
  requestId: string;
  conversationId: string;
  assistantMessageId: string;
  question: string;
  startedAt: number;
}

interface ZoomedChatImage {
  src: string;
  title: string;
}

interface PreviewedPdfAttachment {
  src: string;
  title: string;
}

type ImageAnalysisMode = ApiImageAnalysisMode;

interface ComposerImageDraft extends TelecomChatImageAttachment {
  file: File;
  source: "upload" | "paste";
  analysisMode: ImageAnalysisMode;
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compressionDurationMs: number;
}

interface ComposerPdfDraft extends TelecomChatPdfAttachment {
  file: File;
  source: "upload" | "drop";
  analysisMode: ImageAnalysisMode;
}

type VoiceComposerState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
type AudioPlaybackState = "idle" | "loading" | "playing" | "paused";

interface CachedVoicePlayback {
  audioUrl: string;
  duration: number;
  format: string;
}

interface VoicePlaybackSnapshot extends CachedVoicePlayback {
  text: string;
  messageId: string | null;
}

type VoicePermissionState = PermissionState | "unsupported";
type VoiceCaptureFeedback = "idle" | "success" | "error";

interface PendingVoiceDraft {
  blob: Blob;
  mimeType: string;
  transcript: string | null;
  message: string;
}

interface BrowserSpeechRecognitionResultItem {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0: BrowserSpeechRecognitionResultItem;
}

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: ((event: Event) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

const QUICK_IMAGE_ANALYSIS_STAGES = [
  "Analyse strategique en cours...",
  "Interpretation des KPI visibles...",
  "Evaluation des premiers risques...",
  "Construction de la synthese decisionnelle...",
];

const DEFAULT_IMAGE_ANALYSIS_STAGES = [
  "Analyse strategique en cours...",
  "Interpretation des KPI...",
  "Evaluation des risques...",
  "Generation des recommandations IA...",
  "Construction du rapport decisionnel...",
];

const DASHBOARD_IMAGE_ANALYSIS_STAGES = [
  "Analyse strategique en cours...",
  "Interpretation du radar et des KPI...",
  "Evaluation des desequilibres...",
  "Generation des recommandations IA...",
  "Construction du rapport decisionnel...",
];

const WORKFLOW_IMAGE_ANALYSIS_STAGES = [
  "Analyse strategique en cours...",
  "Analyse des dependances...",
  "Evaluation de la complexite...",
  "Generation des recommandations IA...",
];

const EQUIPMENT_IMAGE_ANALYSIS_STAGES = [
  "Analyse strategique en cours...",
  "Interpretation des KPI visibles...",
  "Evaluation des risques materiels...",
  "Generation des recommandations IA...",
];

const PDF_ANALYSIS_STAGES = [
  "Lecture du document...",
  "Extraction OCR...",
  "Analyse des KPI...",
  "Detection des anomalies...",
  "Construction du rapport decisionnel...",
];

const SPREADSHEET_ANALYSIS_STAGES = [
  "Chargement du document tabulaire...",
  "Lecture pandas du dataframe...",
  "Analyse des colonnes et des couts...",
  "Detection des anomalies et ecarts...",
  "Generation des recommandations IA...",
];

const GEO_ANALYSIS_STAGES = [
  "Analyse geospatiale en cours...",
  "Lecture de la cartographie roaming...",
  "Qualification des zones critiques...",
  "Preparation de la reponse geographique...",
];

function normalizeImageAnalysisMode(value: string | null | undefined): ImageAnalysisMode {
  if (value === "advanced" || value === "dashboard_analysis") {
    return value;
  }
  return "quick";
}

function getImageAnalysisModeLabel(mode: ImageAnalysisMode): string {
  if (mode === "dashboard_analysis") {
    return "audit dashboard";
  }
  if (mode === "advanced") {
    return "audit approfondi";
  }
  return "lecture initiale";
}

function getImageAnalysisModeBadge(mode: ImageAnalysisMode): string {
  if (mode === "dashboard_analysis") {
    return "Audit dashboard";
  }
  return mode === "advanced" ? "Audit approfondi" : "Lecture initiale";
}

const EXECUTIVE_REPORT_STAGES = [
  "Analyse strategique IA...",
  "Calcul des scores executifs...",
  "Detection des risques prioritaires...",
  "Generation recommandations DSI...",
  "Construction du rapport executif...",
];

const EXPLAINABILITY_STAGES = [
  "Identification des facteurs dominants...",
  "Qualification des causes probables...",
  "Construction de la cartographie explicative...",
  "Preparation de la note de justification...",
];

const COPILOT_ACTION_PLAN_STAGES = [
  "Analyse des priorites...",
  "Construction du plan d'action...",
  "Classification des risques...",
  "Generation des taches DSI...",
];

const AI_REPORT_STAGES = [
  "Construction du rapport IA...",
  "Generation graphiques...",
  "Analyse executive...",
  "Export PDF entreprise...",
];

function buildAssistantMessage(
  reply: AssistantResponseContent,
  linkedUserMessageId: string,
  existingMessageId?: string,
): TelecomChatMessage {
  return {
    id: existingMessageId ?? `assistant-${createUuid()}`,
    role: "assistant",
    text: reply.text,
    createdAt: new Date().toISOString(),
    status: "complete",
    bullets: reply.bullets,
    recommendation: reply.recommendation,
    ctaLabel: reply.ctaLabel,
    ctaPath: reply.ctaPath,
    sources: reply.sources,
    linkedUserMessageId,
    requestKind:
      reply.requestKind ?? (reply.imageAnalysis ? "image" : reply.executiveReport ? "executive_report" : "text"),
    imageAnalysis: reply.imageAnalysis ?? null,
    executiveReport: reply.executiveReport ?? null,
    loadingLabel: null,
  };
}

function buildAssistantErrorMessage(
  message: string,
  linkedUserMessageId: string,
  existingMessageId?: string,
  requestKind: "text" | "image" | "document" | "executive_report" = "text",
): TelecomChatMessage {
  return {
    id: existingMessageId ?? `assistant-error-${createUuid()}`,
    role: "assistant",
    text: message,
    createdAt: new Date().toISOString(),
    status: "error",
    sources: ["Modele local Ollama", "Backend /chat"],
    linkedUserMessageId,
    requestKind,
    imageAnalysis: null,
    executiveReport: null,
    loadingLabel: null,
  };
}

function extractApiFallbackAnswer(error: unknown): string | null {
  if (!(error instanceof ApiError) || typeof error.details !== "object" || error.details === null) {
    return null;
  }

  if (
    "fallback_answer" in error.details &&
    typeof error.details.fallback_answer === "string" &&
    error.details.fallback_answer.trim() !== ""
  ) {
    return error.details.fallback_answer;
  }

  return null;
}

function buildAssistantImageErrorMessage(
  error: unknown,
  linkedUserMessageId: string,
  analysisMode: ImageAnalysisMode,
  existingMessageId?: string,
  requestKind: "image" | "document" = "image",
): TelecomChatMessage {
  const message = getChatErrorMessage(error);
  const fallbackAnswer = extractApiFallbackAnswer(error);
  const errorCode = error instanceof ApiError ? error.code ?? null : null;
  return {
    id: existingMessageId ?? `assistant-error-${createUuid()}`,
    role: "assistant",
    text: message,
    createdAt: new Date().toISOString(),
    status: "error",
    sources: [
      "Modele local Ollama",
      requestKind === "document" ? "Backend /chat/upload-document" : "Backend /chat/image",
    ],
    linkedUserMessageId,
    requestKind,
    imageAnalysis: {
      imageType: "indisponible",
      confidence: null,
      analysisMode,
      analysisStatus: "fallback",
      advancedAnalysisAvailable: errorCode !== "OLLAMA_OFFLINE",
      advancedAnalysisCompleted: false,
      processingMessage: message,
      processingNotices: fallbackAnswer ? [fallbackAnswer] : [],
      errorType: errorCode,
      fallbackAnswer,
      detectedAnomalies: [],
      detectedKpis: [],
      recommendations: [],
    },
    executiveReport: null,
    loadingLabel: null,
  };
}

function buildStreamingAssistantMessage(
  linkedUserMessageId: string,
  existingMessageId?: string,
  loadingLabel?: string | null,
  requestKind: "text" | "image" | "document" | "executive_report" = "text",
): TelecomChatMessage {
  return {
    id: existingMessageId ?? `assistant-stream-${createUuid()}`,
    role: "assistant",
    text: "",
    createdAt: new Date().toISOString(),
    status: "streaming",
    linkedUserMessageId,
    requestKind,
    loadingLabel: loadingLabel ?? null,
  };
}

function formatConfidenceLabel(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return `${Math.round(value * 100)}%`;
}

function formatReliabilityLabel(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value >= 0.88) {
    return "tres elevee";
  }
  if (value >= 0.72) {
    return "elevee";
  }
  if (value >= 0.55) {
    return "solide";
  }
  if (value >= 0.35) {
    return "prudente";
  }
  return "mesuree";
}

function formatMadValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value)} MAD`;
}

function formatRiskLevelLabel(
  value: "low" | "medium" | "high" | "critical" | null | undefined,
): string | null {
  if (value === "critical") {
    return "Critique";
  }
  if (value === "high") {
    return "Eleve";
  }
  if (value === "medium") {
    return "Moyen";
  }
  if (value === "low") {
    return "Faible";
  }
  return null;
}

function formatComplexityLevelLabel(
  value: "low" | "medium" | "high" | "critical" | null | undefined,
): string | null {
  return formatRiskLevelLabel(value);
}

function formatImpactLabel(value: string | null | undefined): string {
  const normalizedValue = (value ?? "").trim().toLowerCase();
  if (normalizedValue === "economies") {
    return "Economies";
  }
  if (normalizedValue === "fraud") {
    return "Fraude";
  }
  if (normalizedValue === "risk") {
    return "Risque";
  }
  if (normalizedValue === "optimization") {
    return "Optimisation";
  }
  if (normalizedValue === "prevention") {
    return "Prevention";
  }
  if (normalizedValue === "analysis") {
    return "Analyse";
  }
  if (!normalizedValue) {
    return "Impact";
  }

  return normalizedValue.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function getPriorityBadgeClass(
  priority: "low" | "medium" | "high" | "critical" | null | undefined,
): string {
  if (priority === "critical") {
    return "border-[#F87171]/40 bg-[#FEE2E2] text-[#B91C1C] dark:border-[#EF4444]/30 dark:bg-[#3A0D12] dark:text-[#FCA5A5]";
  }
  if (priority === "high") {
    return "border-[#FB923C]/40 bg-[#FFEDD5] text-[#C2410C] dark:border-[#F97316]/30 dark:bg-[#3A1A0C] dark:text-[#FDBA74]";
  }
  if (priority === "medium") {
    return "border-[#FACC15]/40 bg-[#FEF9C3] text-[#A16207] dark:border-[#EAB308]/30 dark:bg-[#332A08] dark:text-[#FDE047]";
  }
  return "border-[#4ADE80]/40 bg-[#DCFCE7] text-[#15803D] dark:border-[#22C55E]/30 dark:bg-[#0D2A16] dark:text-[#86EFAC]";
}

function formatImageTypeLabel(imageType: string | null | undefined): string {
  const normalizedType = (imageType ?? "").trim().toLowerCase();
  if (normalizedType === "facture") {
    return "Facture telecom";
  }
  if (normalizedType === "equipement") {
    return "Equipement telecom";
  }
  if (normalizedType === "workflow") {
    return "Workflow";
  }
  if (normalizedType === "alert_dashboard") {
    return "Dashboard alertes";
  }
  if (normalizedType === "appel_suspect") {
    return "Appel suspect";
  }
  if (normalizedType === "depassement_quota") {
    return "Depassement quota";
  }
  if (normalizedType === "erreur_systeme") {
    return "Erreur systeme";
  }
  if (normalizedType === "capture_interface") {
    return "Capture interface";
  }
  if (!normalizedType) {
    return "Image";
  }

  return normalizedType.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function isVisionOnlyEquipmentAnalysis(
  analysis: TelecomChatImageAnalysis | null | undefined,
): boolean {
  const imageType = (analysis?.imageType ?? "").trim().toLowerCase();
  const sourceMode = (analysis?.analysisMetadata?.sourceMode ?? "").trim().toLowerCase();

  return (imageType === "equipement" || imageType === "equipment") && sourceMode === "vision_only";
}

function formatImageAnalysisSourceLabel(source: string): string | null {
  if (source === "multimodal:image") {
    return "Lecture multimodale de l'image";
  }
  if (source === "multimodal:pdf") {
    return "Lecture documentaire multimodale";
  }
  if (source === "tabular:document") {
    return "Analyse tabulaire pandas";
  }
  if (source === "parser:pandas") {
    return "Lecture dataframe pandas";
  }
  if (source === "analysis-mode:quick") {
    return "Lecture decisionnelle de premier niveau";
  }
  if (source === "analysis-mode:advanced") {
    return "Lecture approfondie consolidee";
  }
  if (source === "analysis-mode:dashboard_analysis") {
    return "Audit dashboard consolide";
  }
  if (source === "vision:llava") {
    return "Interpretation visuelle consolidee";
  }
  if (source === "vision:vision-fallback") {
    return "Interpretation image partielle";
  }
  if (source === "vision:ocr-quick") {
    return null;
  }
  if (source.startsWith("ocr:")) {
    return null;
  }
  if (source.startsWith("decision-engine:")) {
    const riskLevel = source.split(":").at(-1);
    return riskLevel ? `Priorisation des risques: ${formatRiskLevelLabel(riskLevel as "low" | "medium" | "high" | "critical")}` : null;
  }
  if (source.startsWith("annotation:opencv:")) {
    const annotationCount = source.split(":").at(-1);
    return annotationCount ? `Zones d'attention annotees: ${annotationCount}` : "Zones d'attention annotees";
  }
  if (source.startsWith("workflow:")) {
    return "Workflow reconnu dans la capture";
  }
  if (source.startsWith("equipment:")) {
    return "Equipement reconnu dans la capture";
  }
  if (source === "fallback_rapide") {
    return "Lecture de secours securisee";
  }
  return null;
}

function formatEquipmentTypeLabel(equipmentType: string | null | undefined): string | null {
  const normalizedType = (equipmentType ?? "").trim().toLowerCase();
  if (!normalizedType) {
    return null;
  }
  if (normalizedType === "smartphone") {
    return "Smartphone";
  }
  if (normalizedType === "routeur") {
    return "Routeur";
  }
  if (normalizedType === "modem") {
    return "Modem";
  }
  if (normalizedType === "sim") {
    return "Carte SIM";
  }
  if (normalizedType === "switch") {
    return "Switch";
  }
  if (normalizedType === "borne_wifi") {
    return "Borne WiFi";
  }
  if (normalizedType === "antenne") {
    return "Antenne";
  }
  if (normalizedType === "appareil_inconnu") {
    return "Equipement non identifie";
  }
  return normalizedType.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function formatWorkflowTypeLabel(workflowType: string | null | undefined): string | null {
  const normalizedType = (workflowType ?? "").trim().toLowerCase();
  if (!normalizedType) {
    return null;
  }
  if (normalizedType === "workflow") {
    return "Workflow";
  }
  if (normalizedType === "organigramme") {
    return "Organigramme";
  }
  if (normalizedType === "diagramme_technique") {
    return "Diagramme technique";
  }
  if (normalizedType === "architecture") {
    return "Architecture";
  }
  if (normalizedType === "processus_metier") {
    return "Processus metier";
  }

  return normalizedType.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

function buildImageAnalysisStages(
  question: string,
  attachmentName?: string | null,
  analysisMode: ImageAnalysisMode = "quick",
): string[] {
  if (analysisMode === "quick") {
    return QUICK_IMAGE_ANALYSIS_STAGES;
  }
  if (analysisMode === "dashboard_analysis") {
    return DASHBOARD_IMAGE_ANALYSIS_STAGES;
  }
  const hint = `${question} ${attachmentName ?? ""}`.toLowerCase();
  if (
    /workflow|organigram|diagramme|schema|processus|architecture|validation|support it|audit/.test(
      hint,
    )
  ) {
    return WORKFLOW_IMAGE_ANALYSIS_STAGES;
  }
  if (
    /equip|materiel|smartphone|telephone|iphone|galaxy|routeur|router|modem|sim|switch|wifi|wi-fi|antenne|batterie|terminal/.test(
      hint,
    )
  ) {
    return EQUIPMENT_IMAGE_ANALYSIS_STAGES;
  }
  return DEFAULT_IMAGE_ANALYSIS_STAGES;
}

function getFileExtension(fileName: string | null | undefined): string {
  const normalizedName = (fileName || "").trim().toLowerCase();
  const separatorIndex = normalizedName.lastIndexOf(".");
  if (separatorIndex < 0) {
    return "";
  }
  return normalizedName.slice(separatorIndex + 1);
}

function inferDocumentType(
  fileLike: Pick<File, "name" | "type"> | Pick<TelecomChatPdfAttachment, "name" | "mimeType">,
): TelecomChatDocumentType | undefined {
  const mimeType = ("mimeType" in fileLike ? fileLike.mimeType : fileLike.type).trim().toLowerCase();
  const extension = getFileExtension(fileLike.name);
  if (extension === "pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (extension === "csv" || mimeType === "text/csv") {
    return "csv";
  }
  if (
    extension === "xlsx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  if (extension === "xls" || mimeType === "application/vnd.ms-excel") {
    return "xls";
  }
  return undefined;
}

function formatDocumentTypeLabel(documentType: TelecomChatDocumentType | undefined): string {
  if (documentType === "xlsx") {
    return "XLSX";
  }
  if (documentType === "xls") {
    return "XLS";
  }
  if (documentType === "csv") {
    return "CSV";
  }
  return "PDF";
}

function buildDocumentAnalysisStages(
  attachment: TelecomChatAttachment,
  question: string,
  analysisMode: ImageAnalysisMode,
): string[] {
  if (attachment.kind === "document") {
    return attachment.documentType === "pdf"
      ? PDF_ANALYSIS_STAGES
      : SPREADSHEET_ANALYSIS_STAGES;
  }
  return buildImageAnalysisStages(question, attachment.name, analysisMode);
}

function formatFileSize(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} Mo`;
  }
  return `${Math.max(1, Math.round(value / 1024))} Ko`;
}

function pickSupportedVoiceRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }

  return SUPPORTED_VOICE_RECORDING_TYPES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}

function inferVoiceRecordingExtension(mimeType: string): string {
  const normalizedType = mimeType.toLowerCase();
  if (normalizedType.includes("mp4")) {
    return "m4a";
  }
  if (normalizedType.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

function getBrowserSpeechRecognitionConstructor():
  | BrowserSpeechRecognitionConstructor
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const browserWindow = window as Window &
    typeof globalThis & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };

  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
}

function normalizeVoiceTranscript(value: string | null | undefined): string {
  return (value ?? "").split(/\s+/).filter(Boolean).join(" ").trim();
}

function resolveVoiceRecognitionLanguage(localeCode: string): string {
  if (localeCode.toLowerCase().startsWith("ar")) {
    return "ar-MA";
  }
  if (localeCode.toLowerCase().startsWith("en")) {
    return "en-US";
  }
  return "fr-FR";
}

function getBrowserVoiceSupport() {
  const hasMediaDevices =
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const hasMediaRecorder = typeof MediaRecorder !== "undefined";
  const hasSpeechRecognition = getBrowserSpeechRecognitionConstructor() !== null;

  return {
    hasMediaDevices,
    hasMediaRecorder,
    hasSpeechRecognition,
    isSupported: hasMediaDevices && hasMediaRecorder,
  };
}

function getBrowserSpeechRecognitionErrorMessage(errorCode: string | null | undefined): string {
  switch ((errorCode ?? "").toLowerCase()) {
    case "no-speech":
      return "Aucune voix detectee.";
    case "audio-capture":
      return "Microphone inaccessible.";
    case "not-allowed":
    case "service-not-allowed":
      return "Permission refusee.";
    case "network":
      return "Erreur reseau transcription.";
    case "aborted":
      return "Ecoute interrompue.";
    default:
      return "Reconnaissance vocale indisponible.";
  }
}

function mergeVoiceTranscriptWithComposer(currentValue: string, transcript: string): string {
  const normalizedCurrentValue = currentValue.trim();
  if (!normalizedCurrentValue) {
    return transcript;
  }
  return `${normalizedCurrentValue} ${transcript}`;
}

function buildVoiceAudioFileFromBlob(voiceBlob: Blob): File {
  const mimeType = voiceBlob.type || "audio/webm";
  const extension = inferVoiceRecordingExtension(mimeType);
  return new File([voiceBlob], `voice-question-${Date.now()}.${extension}`, {
    type: mimeType,
  });
}

function formatVoiceDurationLabel(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value < 10) {
    return `${value.toFixed(1)} s`;
  }

  return `${Math.round(value)} s`;
}

function buildVoiceVisualizerLevels(): number[] {
  return IDLE_VOICE_VISUALIZER_LEVELS.slice(0, VOICE_VISUALIZER_BAR_COUNT);
}

function buildVoiceNarrationText(message: TelecomChatMessage): string {
  const sections: string[] = [];
  const baseText = message.text.trim();
  if (baseText) {
    sections.push(baseText);
  }

  if (message.executiveReport) {
    const report = message.executiveReport;
    sections.push(
      `Score sante flotte ${report.fleetHealthScore} sur 100. Niveau de risque ${formatRiskLevelLabel(report.riskLevel) ?? "non precise"}.`,
    );
    if (report.estimatedSavings) {
      sections.push(`Economies potentielles estimees: ${report.estimatedSavings}.`);
    }
    if (report.priorityRisks.length > 0) {
      sections.push(`Risques prioritaires: ${report.priorityRisks.slice(0, 3).join(". ")}.`);
    }
    if (report.topRecommendations.length > 0) {
      sections.push(
        `Recommandations prioritaires: ${report.topRecommendations
          .slice(0, 3)
          .map((recommendation) => recommendation.title)
          .join(". ")}.`,
      );
    }
  }

  if (message.imageAnalysis) {
    const analysis = message.imageAnalysis;
    if (analysis.detectedAnomalies && analysis.detectedAnomalies.length > 0) {
      sections.push(`Anomalies detectees: ${analysis.detectedAnomalies.slice(0, 3).join(". ")}.`);
    }
    if (analysis.detectedKpis && analysis.detectedKpis.length > 0) {
      sections.push(`KPI visibles: ${analysis.detectedKpis.slice(0, 3).join(". ")}.`);
    }
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      sections.push(`Actions conseillees: ${analysis.recommendations.slice(0, 3).join(". ")}.`);
    }
    if (analysis.workflowDetails?.complexityScore) {
      sections.push(`Complexite workflow ${analysis.workflowDetails.complexityScore} sur 100.`);
    }
    if (analysis.equipmentDetails?.replacementNeeded) {
      sections.push("Remplacement equipement recommande.");
    }
  }

  if (message.bullets && message.bullets.length > 0) {
    sections.push(`Points cles: ${message.bullets.slice(0, 4).join(". ")}.`);
  }

  if (message.recommendation) {
    sections.push(`Recommandation: ${message.recommendation}.`);
  }

  if (message.explainability) {
    sections.push(message.explainability.answer);
    if (message.explainability.reasoning.length > 0) {
      sections.push(
        `Facteurs ayant influence l'analyse: ${message.explainability.reasoning.slice(0, 3).join(". ")}.`,
      );
    }
    if (message.explainability.recommendations.length > 0) {
      sections.push(
        `Actions recommandees: ${message.explainability.recommendations.slice(0, 3).join(". ")}.`,
      );
    }
  }

  return sections.join(" ").slice(0, 2600);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Impossible de lire l'image selectionnee."));
    };
    reader.onerror = () => reject(new Error("Impossible de lire l'image selectionnee."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(attachment: TelecomChatAttachment): File {
  const [header, rawData] = attachment.previewUrl.split(",", 2);
  if (!header || !rawData) {
    throw new Error(
      attachment.kind === "document" ? "Document attache invalide." : "Image attachee invalide.",
    );
  }

  const mimeTypeMatch = /data:(.*?);base64/.exec(header);
  const mimeType =
    mimeTypeMatch?.[1] ||
    attachment.mimeType ||
    (attachment.kind === "document"
      ? attachment.documentType === "pdf"
        ? "application/pdf"
        : "application/octet-stream"
      : "image/png");
  const binary = window.atob(rawData);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], attachment.name, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

async function previewUrlToFile(attachment: TelecomChatAttachment): Promise<File> {
  if (attachment.previewUrl.startsWith("data:")) {
    return dataUrlToFile(attachment);
  }
  if (!attachment.previewUrl.trim()) {
    throw new Error(
      attachment.kind === "document"
        ? "Le document d'origine n'est plus disponible apres rechargement. Rechargez le fichier pour relancer l'analyse."
        : "L'image d'origine n'est plus disponible apres rechargement. Rechargez le fichier pour relancer l'analyse.",
    );
  }

  const response = await fetch(attachment.previewUrl);
  if (!response.ok) {
    throw new Error(
      attachment.kind === "document"
        ? "Document indisponible. Reattachez le fichier."
        : "Image attachee invalide.",
    );
  }
  const blob = await response.blob();
  return new File([blob], attachment.name, {
    type: attachment.mimeType || blob.type,
    lastModified: Date.now(),
  });
}

function buildImageAttachmentPreview(
  file: File,
  previewUrl: string,
): TelecomChatImageAttachment {
  return {
    kind: "image",
    name: file.name || "image-chatbot.png",
    mimeType: file.type || "image/png",
    previewUrl,
    sizeBytes: file.size,
  };
}

function buildDocumentAttachmentPreview(
  file: File,
  previewUrl: string,
): TelecomChatPdfAttachment {
  const documentType = inferDocumentType(file);
  return {
    kind: "document",
    name: file.name || "document-chatbot",
    mimeType: file.type || (documentType === "pdf" ? "application/pdf" : "application/octet-stream"),
    previewUrl,
    sizeBytes: file.size,
    documentType,
  };
}

function hasUsableAttachmentPreviewUrl(
  attachment: TelecomChatAttachment | null | undefined,
): boolean {
  return typeof attachment?.previewUrl === "string" && attachment.previewUrl.trim() !== "";
}


async function compressComposerImage(
  file: File,
  source: ComposerImageDraft["source"],
): Promise<ComposerImageDraft> {
  const startedAt = performance.now();
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Impossible de compresser l'image selectionnee."));
      element.src = sourceUrl;
    });

    const originalWidth = Math.max(1, image.naturalWidth || image.width || COMPOSER_IMAGE_MAX_WIDTH);
    const originalHeight = Math.max(1, image.naturalHeight || image.height || COMPOSER_IMAGE_MAX_WIDTH);
    const scale = Math.min(1, COMPOSER_IMAGE_MAX_WIDTH / originalWidth);
    const targetWidth = Math.max(1, Math.round(originalWidth * scale));
    const targetHeight = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Compression image indisponible dans ce navigateur.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const compressedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error("Impossible de compresser l'image selectionnee."));
        },
        "image/jpeg",
        COMPOSER_IMAGE_JPEG_QUALITY,
      );
    });

    if (compressedBlob.size > MAX_COMPRESSED_COMPOSER_IMAGE_SIZE_BYTES) {
      throw new Error("L'image reste trop volumineuse apres compression. Limite: 5 Mo.");
    }

    const compressedFileName = `${
      (file.name || (source === "paste" ? "image-collee" : "image-chatbot")).replace(/\.[^.]+$/, "")
    }.jpg`;
    const normalizedName = normalizeComposerImageFile(
      new File([compressedBlob], compressedFileName, {
        type: "image/jpeg",
        lastModified: Date.now(),
      }),
      source,
    );
    const previewUrl = await fileToDataUrl(normalizedName);

    return {
      ...buildImageAttachmentPreview(normalizedName, previewUrl),
      file: normalizedName,
      source,
      analysisMode: "advanced",
      originalSizeBytes: file.size,
      compressedSizeBytes: normalizedName.size,
      compressionDurationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}


function normalizeComposerImageFile(
  file: File,
  source: ComposerImageDraft["source"],
): File {
  const normalizedType = file.type.toLowerCase();
  const extension =
    normalizedType === "image/png"
      ? "png"
      : normalizedType === "image/webp"
        ? "webp"
        : "jpg";
  const normalizedName =
    file.name?.trim() ||
    `${source === "paste" ? "image-collee" : "image-chatbot"}.${extension}`;

  return new File([file], normalizedName, {
    type: file.type,
    lastModified: file.lastModified || Date.now(),
  });
}


function getComposerImageValidationError(file: File): string | null {
  const normalizedType = file.type.toLowerCase();
  if (!SUPPORTED_COMPOSER_IMAGE_TYPES.has(normalizedType)) {
    return "Formats acceptes: PNG, JPG, JPEG ou WEBP.";
  }
  if (file.size > MAX_COMPOSER_IMAGE_INPUT_SIZE_BYTES) {
    return "L'image source est trop volumineuse. Limite avant optimisation: 20 Mo.";
  }
  return null;
}

function getComposerDocumentValidationError(file: File): string | null {
  const normalizedType = file.type.toLowerCase();
  const extension = getFileExtension(file.name);
  if (
    !SUPPORTED_COMPOSER_DOCUMENT_TYPES.has(normalizedType) &&
    !SUPPORTED_COMPOSER_DOCUMENT_EXTENSIONS.has(extension)
  ) {
    return "Seuls les fichiers PDF, CSV et Excel sont acceptes pour cette analyse documentaire ou tabulaire.";
  }
  if (file.size > MAX_COMPOSER_DOCUMENT_INPUT_SIZE_BYTES) {
    return "Le document est trop volumineux. Limite actuelle: 30 Mo.";
  }
  return null;
}


function getPastedImageFile(event: ClipboardEvent<HTMLTextAreaElement>): File | null {
  const items = Array.from(event.clipboardData.items ?? []);
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  return imageItem?.getAsFile() ?? null;
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  return error instanceof Error && error.name === "AbortError";
}

function buildAssistantContentFromApi(response: ApiChatResponse): AssistantResponseContent {
  const lines = response.answer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets: string[] = [];
  const textBlocks: string[] = [];
  const recommendationBlocks: string[] = [];

  lines.forEach((line) => {
    if (/^(?:[-*•]|\d+\.)\s+/.test(line)) {
      bullets.push(line.replace(/^(?:[-*•]|\d+\.)\s+/, "").trim());
      return;
    }

    if (/^recommandation\s*[:\-]/i.test(line)) {
      recommendationBlocks.push(line.replace(/^recommandation\s*[:\-]\s*/i, "").trim());
      return;
    }

    textBlocks.push(line);
  });

  return {
    text: textBlocks.join("\n\n") || response.answer.trim(),
    bullets: bullets.length > 0 ? bullets : undefined,
    recommendation:
      recommendationBlocks.length > 0 ? recommendationBlocks.join(" ") : undefined,
    sources: [
      ...(response.cached ? ["Reponse instantanee depuis le cache"] : []),
      ...(response.fallback_used ? ["Lecture de secours basee sur les signaux les plus fiables"] : []),
      `Modele local: ${response.model}`,
      ...response.sources.map((source) => `Source: ${source}`),
      `Synthese chargee: ${formatConversationDate(response.summary_updated_at)}`,
      ...(response.duration_ms !== null ? [`Temps de reponse: ${response.duration_ms} ms`] : []),
    ],
  };
}

function buildAssistantContentFromImageApi(
  response: ApiChatImageResponse,
): AssistantResponseContent {
  const analysisModeLabel = getImageAnalysisModeLabel(response.analysis_mode);
  const isCompactEquipmentVisionOnly =
    ["equipement", "equipment"].includes((response.image_type ?? "").trim().toLowerCase()) &&
    (response.analysis_metadata?.source_mode ?? "").trim().toLowerCase() === "vision_only";
  const mappedBusinessSources = response.sources
    .map((source) => formatImageAnalysisSourceLabel(source))
    .filter((source): source is string => Boolean(source));
  const processingSources = [
    ...(response.analysis_metadata?.source_mode === "image_strict"
      ? ["Analyse KPI verifiee"]
      : []),
    ...(response.processing_message ? [response.processing_message] : []),
    ...(response.processing_notices ?? []),
    `Profondeur d'analyse: ${analysisModeLabel}`,
    ...(response.advanced_analysis_completed
      ? [
          response.analysis_mode === "dashboard_analysis"
            ? "Audit dashboard consolide"
            : "Audit approfondi consolide",
        ]
      : response.analysis_mode === "advanced" || response.analysis_mode === "dashboard_analysis"
        ? [
            response.analysis_mode === "dashboard_analysis"
              ? "Audit dashboard a approfondir"
              : "Audit approfondi a approfondir",
          ]
        : response.advanced_analysis_available
          ? ["Audit approfondi disponible sur demande"]
          : []),
  ];
  const compactSources = [
    ...(response.cached ? ["Reponse instantanee depuis le cache"] : []),
    ...(response.analysis_status === "fallback"
      ? ["Analyse prudente basee uniquement sur les elements visibles."]
      : []),
    `Modele local: ${response.model}`,
    `Type image: ${formatImageTypeLabel(response.image_type)}`,
    `Profondeur d'analyse: ${analysisModeLabel}`,
    `Synthese chargee: ${formatConversationDate(response.summary_updated_at)}`,
    ...(response.duration_ms !== null ? [`Temps de reponse: ${response.duration_ms} ms`] : []),
  ];

  return {
    text: response.answer.trim(),
    requestKind:
      response.sources.includes("multimodal:pdf") || response.sources.includes("tabular:document")
        ? "document"
        : "image",
    bullets:
      isCompactEquipmentVisionOnly || response.detected_kpis.length === 0
        ? undefined
        : response.detected_kpis,
    recommendation: isCompactEquipmentVisionOnly
      ? undefined
      : response.decision_recommendations && response.decision_recommendations.length > 0
        ? response.decision_recommendations[0].reason
        : response.recommendations.length > 0
          ? response.recommendations[0]
          : response.recommendation_notice ?? undefined,
    sources: isCompactEquipmentVisionOnly
      ? compactSources
      : [
          ...(response.cached ? ["Reponse instantanee depuis le cache"] : []),
          `Modele local: ${response.model}`,
          ...processingSources,
          `Type image: ${formatImageTypeLabel(response.image_type)}`,
          ...(response.detected_operator ? [`Operateur detecte: ${response.detected_operator}`] : []),
          ...(response.analysis_metadata?.visible_kpis_used?.length
            ? [
                `Indicateurs visibles utilises: ${response.analysis_metadata.visible_kpis_used
                  .slice(0, 4)
                  .join(", ")}`,
              ]
            : []),
          ...(formatRiskLevelLabel(response.risk_level)
            ? [`Risque: ${formatRiskLevelLabel(response.risk_level)}`]
            : []),
          ...(response.incident_details?.severity
            ? [`Gravite detectee: ${response.incident_details.severity}`]
            : []),
          ...(response.incident_details?.priority
            ? [`Priorite de traitement: ${response.incident_details.priority}`]
            : []),
          ...(response.workflow_details?.workflow_type
            ? [`Type workflow: ${formatWorkflowTypeLabel(response.workflow_details.workflow_type)}`]
            : []),
          ...(typeof response.workflow_details?.complexity_score === "number"
            ? [`Complexite workflow: ${response.workflow_details.complexity_score}/100`]
            : []),
          ...(response.equipment_details?.equipment_type
            ? [`Type equipement: ${formatEquipmentTypeLabel(response.equipment_details.equipment_type)}`]
            : []),
          ...(typeof response.equipment_details?.condition_score === "number"
            ? [`Etat equipement: ${response.equipment_details.condition_score}/100`]
            : []),
          ...(typeof response.equipment_details?.criticality_score === "number"
            ? [`Criticite equipement: ${response.equipment_details.criticality_score}/100`]
            : []),
          ...((response.annotations?.length ?? 0) > 0
            ? [`Reperes graphiques detectes: ${response.annotations?.length ?? 0}`]
            : []),
          ...(formatReliabilityLabel(response.confidence)
            ? [`Fiabilite de lecture: ${formatReliabilityLabel(response.confidence)}`]
            : []),
          ...mappedBusinessSources,
          `Synthese chargee: ${formatConversationDate(response.summary_updated_at)}`,
          ...(response.duration_ms !== null ? [`Temps de reponse: ${response.duration_ms} ms`] : []),
        ],
    imageAnalysis: {
      imageType: response.image_type,
      confidence: response.confidence,
      ocrConfidence: response.ocr_confidence ?? null,
      analysisMode: response.analysis_mode,
      analysisStatus: response.analysis_status,
      advancedAnalysisAvailable: response.advanced_analysis_available,
      advancedAnalysisCompleted: response.advanced_analysis_completed,
      processingMessage: response.processing_message ?? null,
      processingNotices: response.processing_notices ?? [],
      errorType: response.error_type ?? null,
      fallbackAnswer: response.fallback_answer ?? null,
      detectedOperator: response.detected_operator ?? undefined,
      detectedAnomalies: response.detected_anomalies ?? [],
      analysisMetadata: response.analysis_metadata
        ? {
            sourceMode: response.analysis_metadata.source_mode,
            visibleKpisUsed: response.analysis_metadata.visible_kpis_used ?? [],
            blockedGlobalContext: response.analysis_metadata.blocked_global_context ?? false,
            removedUnverifiedClaims:
              response.analysis_metadata.removed_unverified_claims ?? [],
            filteredNumbers: response.analysis_metadata.filtered_numbers ?? [],
            confidenceScore: response.analysis_metadata.confidence_score ?? 0,
          }
        : undefined,
      ocrText: response.ocr_text,
      visionAnalysis: response.vision_analysis,
      detectedKpis: response.detected_kpis,
      recommendations: response.recommendations,
      decisionRecommendations: (response.decision_recommendations ?? []).map((recommendation) => ({
        title: recommendation.title,
        priority: recommendation.priority,
        impact: recommendation.impact,
        estimatedSaving: recommendation.estimated_saving ?? null,
        reason: recommendation.reason,
      })),
      recommendationNotice: response.recommendation_notice ?? null,
      riskLevel: response.risk_level ?? null,
      optimizationScore: response.optimization_score ?? null,
      anomalyScore: response.anomaly_score ?? null,
      fraudScore: response.fraud_score ?? null,
      costScore: response.cost_score ?? null,
      highlightedImage: response.highlighted_image ?? null,
      annotations: (response.annotations ?? [])
        .filter((annotation) => Array.isArray(annotation.bbox) && annotation.bbox.length === 4)
        .map((annotation) => ({
          label: annotation.label,
          type: annotation.type,
          bbox: [
            Math.round(annotation.bbox[0] ?? 0),
            Math.round(annotation.bbox[1] ?? 0),
            Math.round(annotation.bbox[2] ?? 0),
            Math.round(annotation.bbox[3] ?? 0),
          ] as [number, number, number, number],
          confidence: annotation.confidence,
        })),
      invoiceDetails: response.invoice_details
        ? {
            operator: response.invoice_details.operator ?? undefined,
            invoiceNumber: response.invoice_details.invoice_number ?? undefined,
            invoiceDate: response.invoice_details.invoice_date ?? undefined,
            billingPeriod: response.invoice_details.billing_period ?? undefined,
            amountHtMad: response.invoice_details.amount_ht_mad ?? undefined,
            vatAmountMad: response.invoice_details.vat_amount_mad ?? undefined,
            amountTtcMad: response.invoice_details.amount_ttc_mad ?? undefined,
            totalAmountMad: response.invoice_details.total_amount_mad ?? undefined,
            billedLines: response.invoice_details.billed_lines ?? [],
            additionalFees: response.invoice_details.additional_fees ?? [],
            overageItems: response.invoice_details.overage_items ?? [],
            anomalies: response.invoice_details.anomalies ?? [],
          }
        : undefined,
      incidentDetails: response.incident_details
        ? {
            alertType: response.incident_details.alert_type ?? undefined,
            severity: response.incident_details.severity ?? undefined,
            detectedAt: response.incident_details.detected_at ?? undefined,
            operator: response.incident_details.operator ?? undefined,
            lineReference: response.incident_details.line_reference ?? undefined,
            suspectCostMad: response.incident_details.suspect_cost_mad ?? undefined,
            callVolume: response.incident_details.call_volume ?? undefined,
            dataOverage: response.incident_details.data_overage ?? undefined,
            errorMessage: response.incident_details.error_message ?? undefined,
            priority: response.incident_details.priority ?? undefined,
            summary: response.incident_details.summary ?? undefined,
            criticalAlertCount: response.incident_details.critical_alert_count ?? null,
            exposureRate: response.incident_details.exposure_rate ?? undefined,
            exposureRatePct: response.incident_details.exposure_rate_pct ?? null,
            financialImpactMad: response.incident_details.financial_impact_mad ?? undefined,
            financialImpactValueMad:
              response.incident_details.financial_impact_value_mad ?? null,
            averageScore: response.incident_details.average_score ?? undefined,
            averageScoreValue: response.incident_details.average_score_value ?? null,
            riskScore: response.incident_details.risk_score ?? undefined,
            maxRiskScores: response.incident_details.max_risk_scores ?? [],
            riskyEntities: response.incident_details.risky_entities ?? [],
            repeatedAnomalies: response.incident_details.repeated_anomalies ?? [],
            visibleStatuses: response.incident_details.visible_statuses ?? [],
            criticalSignals: response.incident_details.critical_signals ?? [],
            probableCauses: response.incident_details.probable_causes ?? [],
          }
        : undefined,
      alertIntelligence: response.alert_intelligence
        ? {
            alertFamily: response.alert_intelligence.alert_family ?? undefined,
            aiRiskScore: response.alert_intelligence.ai_risk_score ?? null,
            ocrConfidenceScore: response.alert_intelligence.ocr_confidence_score ?? null,
            criticity: response.alert_intelligence.criticity ?? null,
            executiveSummary: response.alert_intelligence.executive_summary ?? undefined,
            businessRisk: response.alert_intelligence.business_risk ?? undefined,
            financialExposureMad: response.alert_intelligence.financial_exposure_mad ?? undefined,
            potentialLossMad: response.alert_intelligence.potential_loss_mad ?? undefined,
            possibleSavingsMad: response.alert_intelligence.possible_savings_mad ?? undefined,
            priorityKpis: response.alert_intelligence.priority_kpis ?? [],
            visibleEvidence: response.alert_intelligence.visible_evidence ?? [],
            atRiskEntities: response.alert_intelligence.at_risk_entities ?? [],
            immediateActions: response.alert_intelligence.immediate_actions ?? [],
            recommendedControls: response.alert_intelligence.recommended_controls ?? [],
            alertTimeline: (response.alert_intelligence.alert_timeline ?? []).map((item) => ({
              label: item.label,
              detail: item.detail,
              status: item.status ?? "observed",
            })),
            auditFocus: response.alert_intelligence.audit_focus ?? undefined,
          }
        : undefined,
      workflowDetails: response.workflow_details
        ? {
            workflowType: response.workflow_details.workflow_type ?? undefined,
            complexityScore: response.workflow_details.complexity_score ?? null,
            complexityLevel: response.workflow_details.complexity_level ?? null,
            criticalSteps: response.workflow_details.critical_steps ?? [],
            detectedDepartments: response.workflow_details.detected_departments ?? [],
            detectedRoles: response.workflow_details.detected_roles ?? [],
            automationOpportunities: response.workflow_details.automation_opportunities ?? [],
            bottlenecks: response.workflow_details.bottlenecks ?? [],
            repeatedValidations: response.workflow_details.repeated_validations ?? [],
            summary: response.workflow_details.summary ?? undefined,
          }
        : undefined,
      equipmentDetails: response.equipment_details
        ? {
            equipmentType: response.equipment_details.equipment_type ?? undefined,
            brand: response.equipment_details.brand ?? undefined,
            model: response.equipment_details.model ?? undefined,
            serialNumber: response.equipment_details.serial_number ?? undefined,
            operator: response.equipment_details.operator ?? undefined,
            visibleCondition: response.equipment_details.visible_condition ?? undefined,
            deviceVersion: response.equipment_details.device_version ?? undefined,
            simInformation: response.equipment_details.sim_information ?? undefined,
            labelInformation: response.equipment_details.label_information ?? undefined,
            usageSummary: response.equipment_details.usage_summary ?? undefined,
            detectedIssues: response.equipment_details.detected_issues ?? [],
            maintenanceRecommendations: response.equipment_details.maintenance_recommendations ?? [],
            replacementNeeded: response.equipment_details.replacement_needed ?? false,
            conditionScore: response.equipment_details.condition_score ?? null,
            criticalityScore: response.equipment_details.criticality_score ?? null,
            obsolescenceScore: response.equipment_details.obsolescence_score ?? null,
            maintenanceScore: response.equipment_details.maintenance_score ?? null,
            summary: response.equipment_details.summary ?? undefined,
          }
        : undefined,
    },
  };
}

function buildExecutiveReportImageContextFromAnalysis(
  analysis: TelecomChatImageAnalysis,
): ApiExecutiveReportImageContext {
  return {
    image_type: analysis.imageType,
    detected_operator: analysis.detectedOperator ?? null,
    detected_kpis: analysis.detectedKpis ?? [],
    detected_anomalies: analysis.detectedAnomalies ?? [],
    recommendations: analysis.recommendations ?? [],
    annotations: (analysis.annotations ?? []).map((annotation) => ({
      label: annotation.label,
      type: annotation.type,
      bbox: annotation.bbox,
      confidence: annotation.confidence,
    })),
    decision_recommendations: (analysis.decisionRecommendations ?? []).map((recommendation) => ({
      title: recommendation.title,
      priority: recommendation.priority,
      impact: recommendation.impact,
      estimated_saving: recommendation.estimatedSaving ?? null,
      reason: recommendation.reason,
    })),
    risk_level: analysis.riskLevel ?? null,
    optimization_score: analysis.optimizationScore ?? null,
    anomaly_score: analysis.anomalyScore ?? null,
    fraud_score: analysis.fraudScore ?? null,
    cost_score: analysis.costScore ?? null,
    invoice_details: analysis.invoiceDetails
      ? {
          operator: analysis.invoiceDetails.operator ?? null,
          invoice_number: analysis.invoiceDetails.invoiceNumber ?? null,
          invoice_date: analysis.invoiceDetails.invoiceDate ?? null,
          billing_period: analysis.invoiceDetails.billingPeriod ?? null,
          amount_ht_mad: analysis.invoiceDetails.amountHtMad ?? null,
          vat_amount_mad: analysis.invoiceDetails.vatAmountMad ?? null,
          amount_ttc_mad: analysis.invoiceDetails.amountTtcMad ?? null,
          total_amount_mad: analysis.invoiceDetails.totalAmountMad ?? null,
          billed_lines: analysis.invoiceDetails.billedLines ?? [],
          additional_fees: analysis.invoiceDetails.additionalFees ?? [],
          overage_items: analysis.invoiceDetails.overageItems ?? [],
          anomalies: analysis.invoiceDetails.anomalies ?? [],
        }
      : null,
    incident_details: analysis.incidentDetails
      ? {
          alert_type: analysis.incidentDetails.alertType ?? null,
          severity: analysis.incidentDetails.severity ?? null,
          detected_at: analysis.incidentDetails.detectedAt ?? null,
          operator: analysis.incidentDetails.operator ?? null,
          line_reference: analysis.incidentDetails.lineReference ?? null,
          suspect_cost_mad: analysis.incidentDetails.suspectCostMad ?? null,
          call_volume: analysis.incidentDetails.callVolume ?? null,
          data_overage: analysis.incidentDetails.dataOverage ?? null,
          error_message: analysis.incidentDetails.errorMessage ?? null,
          priority: analysis.incidentDetails.priority ?? null,
          summary: analysis.incidentDetails.summary ?? null,
          critical_alert_count: analysis.incidentDetails.criticalAlertCount ?? null,
          exposure_rate: analysis.incidentDetails.exposureRate ?? null,
          exposure_rate_pct: analysis.incidentDetails.exposureRatePct ?? null,
          financial_impact_mad: analysis.incidentDetails.financialImpactMad ?? null,
          financial_impact_value_mad: analysis.incidentDetails.financialImpactValueMad ?? null,
          average_score: analysis.incidentDetails.averageScore ?? null,
          average_score_value: analysis.incidentDetails.averageScoreValue ?? null,
          risk_score: analysis.incidentDetails.riskScore ?? null,
          max_risk_scores: analysis.incidentDetails.maxRiskScores ?? [],
          risky_entities: analysis.incidentDetails.riskyEntities ?? [],
          repeated_anomalies: analysis.incidentDetails.repeatedAnomalies ?? [],
          visible_statuses: analysis.incidentDetails.visibleStatuses ?? [],
          critical_signals: analysis.incidentDetails.criticalSignals ?? [],
          probable_causes: analysis.incidentDetails.probableCauses ?? [],
        }
      : null,
    workflow_details: analysis.workflowDetails
      ? {
          workflow_type: analysis.workflowDetails.workflowType ?? null,
          complexity_score: analysis.workflowDetails.complexityScore ?? null,
          complexity_level: analysis.workflowDetails.complexityLevel ?? null,
          critical_steps: analysis.workflowDetails.criticalSteps ?? [],
          detected_departments: analysis.workflowDetails.detectedDepartments ?? [],
          detected_roles: analysis.workflowDetails.detectedRoles ?? [],
          automation_opportunities: analysis.workflowDetails.automationOpportunities ?? [],
          bottlenecks: analysis.workflowDetails.bottlenecks ?? [],
          repeated_validations: analysis.workflowDetails.repeatedValidations ?? [],
          summary: analysis.workflowDetails.summary ?? null,
        }
      : null,
    equipment_details: analysis.equipmentDetails
      ? {
          equipment_type: analysis.equipmentDetails.equipmentType ?? null,
          brand: analysis.equipmentDetails.brand ?? null,
          model: analysis.equipmentDetails.model ?? null,
          serial_number: analysis.equipmentDetails.serialNumber ?? null,
          operator: analysis.equipmentDetails.operator ?? null,
          visible_condition: analysis.equipmentDetails.visibleCondition ?? null,
          device_version: analysis.equipmentDetails.deviceVersion ?? null,
          sim_information: analysis.equipmentDetails.simInformation ?? null,
          label_information: analysis.equipmentDetails.labelInformation ?? null,
          usage_summary: analysis.equipmentDetails.usageSummary ?? null,
          detected_issues: analysis.equipmentDetails.detectedIssues ?? [],
          maintenance_recommendations: analysis.equipmentDetails.maintenanceRecommendations ?? [],
          replacement_needed: analysis.equipmentDetails.replacementNeeded ?? false,
          condition_score: analysis.equipmentDetails.conditionScore ?? null,
          criticality_score: analysis.equipmentDetails.criticalityScore ?? null,
          obsolescence_score: analysis.equipmentDetails.obsolescenceScore ?? null,
          maintenance_score: analysis.equipmentDetails.maintenanceScore ?? null,
          summary: analysis.equipmentDetails.summary ?? null,
        }
      : null,
  };
}

function buildExplainabilityExecutiveContextFromReport(
  report: TelecomExecutiveReport,
): ApiExplainabilityExecutiveContext {
  return {
    executive_summary: report.executiveSummary,
    fleet_health_score: report.fleetHealthScore,
    risk_level: report.riskLevel,
    risk_score: report.riskScore,
    fraud_score: report.fraudScore,
    optimization_score: report.optimizationScore,
    anomaly_score: report.anomalyScore,
    equipment_score: report.equipmentScore,
    estimated_savings: report.estimatedSavings,
    critical_costs: report.criticalCosts.map((item) => ({
      title: item.title,
      amount_mad: item.amountMad,
      category: item.category,
      owner: item.owner ?? null,
      reason: item.reason,
    })),
    high_risk_departments: report.highRiskDepartments.map((item) => ({
      department: item.department,
      risk_score: item.riskScore,
      monthly_cost_mad: item.monthlyCostMad ?? null,
      alert_count: item.alertCount,
      reason: item.reason,
    })),
    costly_operators: report.costlyOperators.map((item) => ({
      operator: item.operator,
      total_cost_mad: item.totalCostMad,
      suspicious_calls: item.suspiciousCalls,
      roaming_lines: item.roamingLines,
      reason: item.reason,
    })),
    major_anomalies: report.majorAnomalies.map((item) => ({
      title: item.title,
      severity: item.severity,
      source: item.source,
      reason: item.reason,
    })),
    fraud_signals: report.fraudSignals.map((item) => ({
      title: item.title,
      severity: item.severity,
      operator: item.operator ?? null,
      department: item.department ?? null,
      estimated_exposure_mad: item.estimatedExposureMad ?? null,
      reason: item.reason,
    })),
    priority_risks: report.priorityRisks,
    top_recommendations: report.topRecommendations.map((item) => ({
      title: item.title,
      priority: item.priority,
      justification: item.justification,
      action: item.action,
      estimated_saving_mad: item.estimatedSavingMad ?? null,
    })),
    score_explanations: report.scoreExplanations.map((item) => ({
      label: item.label,
      score: item.score,
      level: item.level,
      direction: item.direction,
      explanation: item.explanation,
    })),
    sources: report.sources,
    summary_updated_at: report.summaryUpdatedAt,
  };
}

function buildExplainabilityFromApi(
  response: ApiExplainabilityResponse,
): TelecomChatExplainability {
  return {
    answer: response.answer.trim(),
    confidence: response.confidence,
    riskLevel: response.risk_level,
    reasoning: response.reasoning ?? [],
    causes: response.causes ?? [],
    influencingFactors: (response.influencing_factors ?? []).map((factor) => ({
      label: factor.label,
      category: factor.category,
      value: factor.value,
      impactScore: factor.impact_score,
      severity: factor.severity,
      evidence: factor.evidence,
    })),
    explanationGraph: {
      summary: response.explanation_graph.summary,
      dominantFactor: response.explanation_graph.dominant_factor ?? null,
      nodes: (response.explanation_graph.nodes ?? []).map((node) => ({
        nodeId: node.node_id,
        label: node.label,
        nodeType: node.node_type,
        severity: node.severity,
        weight: node.weight,
      })),
      edges: (response.explanation_graph.edges ?? []).map((edge) => ({
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
      })),
    },
    criticalZones: (response.critical_zones ?? []).map((zone) => ({
      label: zone.label,
      zoneType: zone.zone_type,
      severity: zone.severity,
      detail: zone.detail,
      value: zone.value ?? null,
    })),
    recommendations: response.recommendations ?? [],
    dataPointsUsed: response.data_points_used ?? [],
    confidenceScore: response.confidence_score,
    fraudScore: response.fraud_score,
    anomalyScore: response.anomaly_score,
    optimizationScore: response.optimization_score,
    riskScore: response.risk_score,
    equipmentScore: response.equipment_score,
    charts: {
      factorBreakdown: (response.charts.factor_breakdown ?? []).map((point) => ({
        label: point.label,
        value: point.value,
        secondaryValue: point.secondary_value ?? null,
      })),
      riskTimeline: (response.charts.risk_timeline ?? []).map((point) => ({
        label: point.label,
        value: point.value,
        secondaryValue: point.secondary_value ?? null,
      })),
      criticalZoneHeatmap: (response.charts.critical_zone_heatmap ?? []).map((point) => ({
        label: point.label,
        value: point.value,
        secondaryValue: point.secondary_value ?? null,
      })),
      scoreRadar: (response.charts.score_radar ?? []).map((point) => ({
        label: point.label,
        value: point.value,
        secondaryValue: point.secondary_value ?? null,
      })),
    },
    model: response.model,
    sources: response.sources,
    summaryUpdatedAt: response.summary_updated_at,
    cached: response.cached,
    fallbackUsed: response.fallback_used,
    durationMs: response.duration_ms,
  };
}

function buildExecutiveReportApiPayloadFromStoredReport(
  report: TelecomExecutiveReport,
): ApiExecutiveReportResponse {
  return {
    executive_summary: report.executiveSummary,
    fleet_health_score: report.fleetHealthScore,
    fleet_health_level: report.fleetHealthLevel,
    risk_level: report.riskLevel,
    risk_score: report.riskScore,
    fraud_score: report.fraudScore,
    optimization_score: report.optimizationScore,
    anomaly_score: report.anomalyScore,
    equipment_score: report.equipmentScore,
    critical_costs: report.criticalCosts.map((item) => ({
      title: item.title,
      amount_mad: item.amountMad,
      category: item.category,
      owner: item.owner ?? null,
      reason: item.reason,
    })),
    high_risk_departments: report.highRiskDepartments.map((item) => ({
      department: item.department,
      risk_score: item.riskScore,
      monthly_cost_mad: item.monthlyCostMad ?? null,
      alert_count: item.alertCount,
      reason: item.reason,
    })),
    costly_operators: report.costlyOperators.map((item) => ({
      operator: item.operator,
      total_cost_mad: item.totalCostMad,
      suspicious_calls: item.suspiciousCalls,
      roaming_lines: item.roamingLines,
      reason: item.reason,
    })),
    major_anomalies: report.majorAnomalies.map((item) => ({
      title: item.title,
      severity: item.severity,
      source: item.source,
      reason: item.reason,
    })),
    fraud_signals: report.fraudSignals.map((item) => ({
      title: item.title,
      severity: item.severity,
      operator: item.operator ?? null,
      department: item.department ?? null,
      estimated_exposure_mad: item.estimatedExposureMad ?? null,
      reason: item.reason,
    })),
    priority_risks: report.priorityRisks,
    optimization_opportunities: report.optimizationOpportunities.map((item) => ({
      title: item.title,
      estimated_saving_mad: item.estimatedSavingMad ?? null,
      justification: item.justification,
    })),
    top_recommendations: report.topRecommendations.map((item) => ({
      title: item.title,
      priority: item.priority,
      justification: item.justification,
      action: item.action,
      estimated_saving_mad: item.estimatedSavingMad ?? null,
    })),
    estimated_savings: report.estimatedSavings,
    estimated_savings_mad: report.estimatedSavingsMad,
    multimodal_highlights: report.multimodalHighlights,
    multimodal_analysis_count: report.multimodalAnalysisCount,
    score_explanations: report.scoreExplanations.map((item) => ({
      label: item.label,
      score: item.score,
      level: item.level,
      direction: item.direction,
      explanation: item.explanation,
    })),
    charts: {
      cost_evolution: report.charts.costEvolution.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
      department_risk: report.charts.departmentRisk.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
      operator_costs: report.charts.operatorCosts.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
      score_breakdown: report.charts.scoreBreakdown.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
    },
    model: report.model,
    sources: report.sources,
    summary_updated_at: report.summaryUpdatedAt,
    cached: report.cached,
    fallback_used: report.fallbackUsed,
    duration_ms: report.durationMs,
  };
}

function buildExplainabilityApiPayloadFromStoredExplanation(
  explanation: TelecomChatExplainability,
): ApiExplainabilityResponse {
  return {
    answer: explanation.answer,
    confidence: explanation.confidence,
    risk_level: explanation.riskLevel,
    reasoning: explanation.reasoning,
    causes: explanation.causes,
    influencing_factors: explanation.influencingFactors.map((factor) => ({
      label: factor.label,
      category: factor.category,
      value: factor.value,
      impact_score: factor.impactScore,
      severity: factor.severity,
      evidence: factor.evidence,
    })),
    explanation_graph: {
      summary: explanation.explanationGraph.summary,
      dominant_factor: explanation.explanationGraph.dominantFactor ?? null,
      nodes: explanation.explanationGraph.nodes.map((node) => ({
        node_id: node.nodeId,
        label: node.label,
        node_type: node.nodeType,
        severity: node.severity,
        weight: node.weight,
      })),
      edges: explanation.explanationGraph.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
      })),
    },
    critical_zones: explanation.criticalZones.map((zone) => ({
      label: zone.label,
      zone_type: zone.zoneType,
      severity: zone.severity,
      detail: zone.detail,
      value: zone.value ?? null,
    })),
    recommendations: explanation.recommendations,
    data_points_used: explanation.dataPointsUsed,
    confidence_score: explanation.confidenceScore,
    fraud_score: explanation.fraudScore,
    anomaly_score: explanation.anomalyScore,
    optimization_score: explanation.optimizationScore,
    risk_score: explanation.riskScore,
    equipment_score: explanation.equipmentScore,
    charts: {
      factor_breakdown: explanation.charts.factorBreakdown.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
      risk_timeline: explanation.charts.riskTimeline.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
      critical_zone_heatmap: explanation.charts.criticalZoneHeatmap.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
      score_radar: explanation.charts.scoreRadar.map((item) => ({
        label: item.label,
        value: item.value,
        secondary_value: item.secondaryValue ?? null,
      })),
    },
    model: explanation.model,
    sources: explanation.sources,
    summary_updated_at: explanation.summaryUpdatedAt,
    cached: explanation.cached,
    fallback_used: explanation.fallbackUsed,
    duration_ms: explanation.durationMs,
  };
}

function collectLatestExecutiveReport(
  conversations: TelecomChatConversation[],
): TelecomExecutiveReport | null {
  return (
    sortTelecomConversations(conversations)
      .flatMap((conversation) => [...conversation.messages].reverse())
      .find((message): message is TelecomChatMessage & { executiveReport: TelecomExecutiveReport } =>
        Boolean(message.executiveReport),
      )?.executiveReport ?? null
  );
}

function collectLatestExplainability(
  conversations: TelecomChatConversation[],
): TelecomChatExplainability | null {
  return (
    sortTelecomConversations(conversations)
      .flatMap((conversation) => [...conversation.messages].reverse())
      .find((message): message is TelecomChatMessage & { explainability: TelecomChatExplainability } =>
        Boolean(message.explainability),
      )?.explainability ?? null
  );
}

function buildAssistantContentFromExecutiveApi(
  response: ApiExecutiveReportResponse,
): AssistantResponseContent {
  return {
    text: response.executive_summary.trim(),
    bullets: response.priority_risks.length > 0 ? response.priority_risks.slice(0, 4) : undefined,
    recommendation:
      response.top_recommendations.length > 0
        ? response.top_recommendations[0].action
        : response.optimization_opportunities[0]?.justification,
    sources: [
      ...(response.cached ? ["Rapport executif charge depuis le cache"] : []),
      ...(response.fallback_used ? ["Resume executif en fallback securise"] : []),
      `Modele local: ${response.model}`,
      `Fleet Health Score: ${response.fleet_health_score}/100`,
      `Risque global: ${formatRiskLevelLabel(response.risk_level) ?? response.risk_level}`,
      `Economies estimees: ${response.estimated_savings}`,
      `Analyses multimodales: ${response.multimodal_analysis_count}`,
      ...response.sources.map((source) => `Source: ${source}`),
      `Synthese chargee: ${formatConversationDate(response.summary_updated_at)}`,
      ...(response.duration_ms !== null ? [`Temps de reponse: ${response.duration_ms} ms`] : []),
    ],
    executiveReport: {
      executiveSummary: response.executive_summary,
      fleetHealthScore: response.fleet_health_score,
      fleetHealthLevel: response.fleet_health_level,
      riskLevel: response.risk_level,
      riskScore: response.risk_score,
      fraudScore: response.fraud_score,
      optimizationScore: response.optimization_score,
      anomalyScore: response.anomaly_score,
      equipmentScore: response.equipment_score,
      criticalCosts: response.critical_costs.map((item) => ({
        title: item.title,
        amountMad: item.amount_mad,
        category: item.category,
        owner: item.owner ?? null,
        reason: item.reason,
      })),
      highRiskDepartments: response.high_risk_departments.map((item) => ({
        department: item.department,
        riskScore: item.risk_score,
        monthlyCostMad: item.monthly_cost_mad ?? null,
        alertCount: item.alert_count,
        reason: item.reason,
      })),
      costlyOperators: response.costly_operators.map((item) => ({
        operator: item.operator,
        totalCostMad: item.total_cost_mad,
        suspiciousCalls: item.suspicious_calls,
        roamingLines: item.roaming_lines,
        reason: item.reason,
      })),
      majorAnomalies: response.major_anomalies.map((item) => ({
        title: item.title,
        severity: item.severity,
        source: item.source,
        reason: item.reason,
      })),
      fraudSignals: response.fraud_signals.map((item) => ({
        title: item.title,
        severity: item.severity,
        operator: item.operator ?? null,
        department: item.department ?? null,
        estimatedExposureMad: item.estimated_exposure_mad ?? null,
        reason: item.reason,
      })),
      priorityRisks: response.priority_risks,
      optimizationOpportunities: response.optimization_opportunities.map((item) => ({
        title: item.title,
        estimatedSavingMad: item.estimated_saving_mad ?? null,
        justification: item.justification,
      })),
      topRecommendations: response.top_recommendations.map((item) => ({
        title: item.title,
        priority: item.priority,
        justification: item.justification,
        action: item.action,
        estimatedSavingMad: item.estimated_saving_mad ?? null,
      })),
      estimatedSavings: response.estimated_savings,
      estimatedSavingsMad: response.estimated_savings_mad,
      multimodalHighlights: response.multimodal_highlights,
      multimodalAnalysisCount: response.multimodal_analysis_count,
      scoreExplanations: response.score_explanations.map((item) => ({
        label: item.label,
        score: item.score,
        level: item.level,
        direction: item.direction,
        explanation: item.explanation,
      })),
      charts: {
        costEvolution: response.charts.cost_evolution.map((item) => ({
          label: item.label,
          value: item.value,
          secondaryValue: item.secondary_value ?? null,
        })),
        departmentRisk: response.charts.department_risk.map((item) => ({
          label: item.label,
          value: item.value,
          secondaryValue: item.secondary_value ?? null,
        })),
        operatorCosts: response.charts.operator_costs.map((item) => ({
          label: item.label,
          value: item.value,
          secondaryValue: item.secondary_value ?? null,
        })),
        scoreBreakdown: response.charts.score_breakdown.map((item) => ({
          label: item.label,
          value: item.value,
          secondaryValue: item.secondary_value ?? null,
        })),
      },
      model: response.model,
      sources: response.sources,
      summaryUpdatedAt: response.summary_updated_at,
      cached: response.cached,
      fallbackUsed: response.fallback_used,
      durationMs: response.duration_ms,
    },
    requestKind: "executive_report",
  };
}

function getChatErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "AUTH_ERROR" || error.code === "UNAUTHORIZED") {
      return error.message || "Session expiree. Reconnectez-vous puis reessayez.";
    }
    if (error.code === "AUTH_ERROR") {
      return "Session expirée. Reconnectez-vous puis réessayez.";
    }
    if (error.code === "IMAGE_INVALID") {
      return "Format image non supporté.";
    }
    if (error.code === "IMAGE_TOO_LARGE") {
      return "Image trop lourde pour analyse.";
    }
    if (error.code === "OLLAMA_OFFLINE") {
      return error.message || "Ollama non lance ou inaccessible.";
    }
    if (error.code === "OLLAMA_OFFLINE") {
      return "Connexion Ollama impossible.";
    }
    if (error.code === "OCR_UNAVAILABLE") {
      return error.message || "La capture ne contient pas assez d'elements exploitables pour une analyse fiable.";
    }
    if (error.code === "OCR_UNAVAILABLE") {
      return "La capture ne contient pas assez d'elements exploitables pour une analyse fiable.";
    }
    if (error.code === "TIMEOUT") {
      return error.message || "Analyse image trop longue.";
    }
    if (error.code === "VISION_UNAVAILABLE") {
      return error.message || "LLaVA indisponible.";
    }
    if (error.code === "VISION_UNAVAILABLE") {
      return "Analyse visuelle indisponible.";
    }
    if (error.code === "MEMORY_ERROR") {
      return "Mémoire insuffisante pour analyser l’image.";
    }
    if (error.code === "MULTIPART_INVALID") {
      return "Image ou formulaire invalide.";
    }
    if (error.code === "NETWORK_ERROR") {
      return error.message || "Connexion backend impossible.";
    }
    if (error.code === "SERVER_ERROR") {
      return error.message || "Une erreur est survenue côté serveur.";
    }

    return error.message || "Une erreur est survenue côté serveur.";
  }

  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "Une erreur est survenue côté serveur.";
}

function getVoiceErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "AUDIO_INVALID") {
      return error.message || "Format audio non supporte.";
    }
    if (error.code === "AUDIO_TOO_LARGE") {
      return error.message || "Fichier audio trop lourd.";
    }
    if (error.code === "NO_AUDIO_DETECTED") {
      return error.message || "Aucun son detecte.";
    }
    if (error.code === "TRANSCRIPTION_UNAVAILABLE" || error.code === "VOICE_STT_UNAVAILABLE") {
      return error.message || "La transcription vocale est temporairement indisponible.";
    }
    if (error.code === "VOICE_STT_DISABLED") {
      return error.message || "La transcription vocale n'est pas active sur ce serveur.";
    }
    if (error.code === "TTS_UNAVAILABLE") {
      return error.message || "Lecture audio indisponible.";
    }
  }

  return getChatErrorMessage(error);
}

function upsertConversation(
  conversations: TelecomChatConversation[],
  nextConversation: TelecomChatConversation,
): TelecomChatConversation[] {
  const exists = conversations.some((conversation) => conversation.id === nextConversation.id);
  const nextConversations = exists
    ? conversations.map((conversation) =>
        conversation.id === nextConversation.id ? nextConversation : conversation,
      )
    : [nextConversation, ...conversations];

  return sortTelecomConversations(nextConversations);
}

function replaceConversationMessages(
  conversation: TelecomChatConversation,
  messages: TelecomChatMessage[],
  updatedAt: string,
  title?: string,
): TelecomChatConversation {
  return {
    ...conversation,
    title: title ?? conversation.title,
    updatedAt,
    messages,
  };
}

function replaceStreamingMessageWithInterruption(
  conversation: TelecomChatConversation,
  assistantMessageId: string,
): TelecomChatConversation {
  const nextMessages = conversation.messages
    .map((message) => {
      if (message.id !== assistantMessageId || message.status !== "streaming") {
        return message;
      }

      if (message.text.trim() === "") {
        return null;
      }

      return {
        ...message,
        status: "complete" as const,
        loadingLabel: null,
      };
    })
    .filter((message): message is TelecomChatMessage => message !== null);
  const updatedAt = nextMessages[nextMessages.length - 1]?.createdAt ?? conversation.updatedAt;

  return {
    ...conversation,
    updatedAt,
    messages: nextMessages,
  };
}

function applyInterruptedStreamToConversation(
  conversation: TelecomChatConversation,
  activeStream: ActiveChatStream | null,
): TelecomChatConversation {
  if (!activeStream || activeStream.conversationId !== conversation.id) {
    return conversation;
  }

  return replaceStreamingMessageWithInterruption(
    conversation,
    activeStream.assistantMessageId,
  );
}

function removeConversationsById(
  conversations: TelecomChatConversation[],
  conversationIds: string[],
): TelecomChatConversation[] {
  const conversationIdSet = new Set(conversationIds);
  return conversations.filter((conversation) => !conversationIdSet.has(conversation.id));
}

function buildApiHistory(
  messages: TelecomChatMessage[],
): Array<{ role: "assistant" | "user"; text: string }> {
  return messages.map((message) => ({
    role: message.role,
    text: message.text,
  }));
}

function collectExecutiveReportImageAnalyses(
  conversations: TelecomChatConversation[],
  limit = 12,
): ApiExecutiveReportImageContext[] {
  const analyses = sortTelecomConversations(conversations)
    .flatMap((conversation) => [...conversation.messages].reverse())
    .filter((message): message is TelecomChatMessage & { imageAnalysis: TelecomChatImageAnalysis } =>
      Boolean(message.imageAnalysis),
    )
    .map((message) => buildExecutiveReportImageContextFromAnalysis(message.imageAnalysis))
    .slice(0, limit);

  return analyses;
}

function collectExecutiveReportExportImages(
  conversations: TelecomChatConversation[],
  limit = 6,
): Array<{ title: string; src: string; caption?: string }> {
  const images = sortTelecomConversations(conversations)
    .flatMap((conversation) => [...conversation.messages].reverse())
    .filter((message) =>
      Boolean(
        message.imageAnalysis?.highlightedImage ||
          (message.attachment?.kind === "image" && message.attachment.previewUrl),
      ),
    )
    .map((message) => ({
      title:
        message.imageAnalysis?.imageType
          ? `Analyse ${formatImageTypeLabel(message.imageAnalysis.imageType)}`
          : message.attachment?.name || "Image annotee",
      src:
        message.imageAnalysis?.highlightedImage ||
        (message.attachment?.kind === "image" ? message.attachment.previewUrl : "") ||
        "",
      caption:
        message.imageAnalysis?.recommendationNotice ||
        message.imageAnalysis?.detectedAnomalies?.[0] ||
        message.recommendation ||
        undefined,
    }))
    .filter((image) => image.src.trim() !== "")
    .slice(0, limit);

  return images;
}

function getConversationMessageIndex(
  conversation: TelecomChatConversation,
  messageId: string,
): number {
  return conversation.messages.findIndex((message) => message.id === messageId);
}

function getContextualSuggestions(pathname: string): string[] {
  if (pathname.startsWith("/forfaits")) {
    return [
      "Quelle est la meilleure optimisation ?",
      "Quels forfaits sont trop chers ?",
      "Pourquoi Maroc Telecom est en depassement ?",
    ];
  }

  if (pathname.startsWith("/lignes")) {
    return [
      "Combien de lignes sont libres ?",
      "Montre-moi les lignes critiques",
      "Quelle ligne doit etre traitee en premier ?",
    ];
  }

  if (pathname.startsWith("/consommations")) {
    return [
      "Quel departement consomme le plus ?",
      "Quel operateur depasse le plus ?",
      "Quelle est la meilleure optimisation ?",
    ];
  }

  if (pathname.startsWith("/anomalies")) {
    return [
      "Explique-moi les alertes importantes",
      "Montre-moi les lignes critiques",
      "Quel departement consomme le plus ?",
    ];
  }

  return assistantQuestionSuggestions;
}

function dedupeStrings(values: string[], limit: number): string[] {
  const uniqueValues = new Set<string>();
  const nextValues: string[] = [];

  values.forEach((value) => {
    const normalizedValue = value.trim();
    const dedupeKey = normalizedValue.toLowerCase().replace(/\s+/g, " ");
    if (!normalizedValue || uniqueValues.has(dedupeKey)) {
      return;
    }

    uniqueValues.add(dedupeKey);
    nextValues.push(normalizedValue);
  });

  return nextValues.slice(0, limit);
}

function buildConversationPreview(conversation: TelecomChatConversation): string {
  const previewMessage =
    [...conversation.messages]
      .reverse()
      .find((message) => message.role === "user" || message.recommendation || message.text) ??
    conversation.messages[0];

  if (!previewMessage) {
    return "Aucun message pour le moment.";
  }

  const previewText = (
    previewMessage.role === "user"
      ? previewMessage.text
      : previewMessage.recommendation || previewMessage.text
  ).replace(/\s+/g, " ").trim();

  return previewText.length > 68 ? `${previewText.slice(0, 68).trim()}...` : previewText;
}

function normalizeConversationTitle(
  nextTitle: string,
  fallbackTitle = DEFAULT_CONVERSATION_TITLE,
): string {
  const normalizedTitle = nextTitle.replace(/\s+/g, " ").trim().slice(0, MAX_CONVERSATION_TITLE_LENGTH);
  return normalizedTitle || fallbackTitle || DEFAULT_CONVERSATION_TITLE;
}

function serializeMessageForCopy(message: TelecomChatMessage): string {
  return [
    message.text,
    message.attachment?.name
      ? `${message.attachment.kind === "document" ? "Document" : "Image"}: ${message.attachment.name}`
      : null,
    ...(message.bullets ?? []),
    message.recommendation ? `Recommandation: ${message.recommendation}` : null,
    ...(message.imageAnalysis?.recommendations ?? []).slice(1).map((item) => `Action: ${item}`),
    message.imageAnalysis?.imageType
      ? `Type image: ${formatImageTypeLabel(message.imageAnalysis.imageType)}`
      : null,
    message.imageAnalysis?.detectedOperator
      ? `Operateur detecte: ${message.imageAnalysis.detectedOperator}`
      : null,
    message.imageAnalysis?.incidentDetails?.severity
      ? `Gravite: ${message.imageAnalysis.incidentDetails.severity}`
      : null,
    message.imageAnalysis?.incidentDetails?.priority
      ? `Priorite: ${message.imageAnalysis.incidentDetails.priority}`
      : null,
    message.imageAnalysis?.incidentDetails?.summary
      ? `Resume alerte: ${message.imageAnalysis.incidentDetails.summary}`
      : null,
    message.imageAnalysis?.alertIntelligence?.executiveSummary
      ? `Synthese alerte IA: ${message.imageAnalysis.alertIntelligence.executiveSummary}`
      : null,
    typeof message.imageAnalysis?.alertIntelligence?.aiRiskScore === "number"
      ? `Risque IA: ${message.imageAnalysis.alertIntelligence.aiRiskScore}/100`
      : null,
    formatRiskLevelLabel(message.imageAnalysis?.alertIntelligence?.criticity)
      ? `Criticite: ${formatRiskLevelLabel(message.imageAnalysis.alertIntelligence?.criticity)}`
      : null,
    message.imageAnalysis?.workflowDetails?.workflowType
      ? `Type workflow: ${formatWorkflowTypeLabel(message.imageAnalysis.workflowDetails.workflowType)}`
      : null,
    typeof message.imageAnalysis?.workflowDetails?.complexityScore === "number"
      ? `Complexite workflow: ${message.imageAnalysis.workflowDetails.complexityScore}/100`
      : null,
    message.imageAnalysis?.workflowDetails?.summary
      ? `Resume workflow: ${message.imageAnalysis.workflowDetails.summary}`
      : null,
    message.imageAnalysis?.equipmentDetails?.equipmentType
      ? `Type equipement: ${formatEquipmentTypeLabel(message.imageAnalysis.equipmentDetails.equipmentType)}`
      : null,
    message.imageAnalysis?.equipmentDetails?.brand
      ? `Marque: ${message.imageAnalysis.equipmentDetails.brand}`
      : null,
    message.imageAnalysis?.equipmentDetails?.model
      ? `Modele: ${message.imageAnalysis.equipmentDetails.model}`
      : null,
    typeof message.imageAnalysis?.equipmentDetails?.conditionScore === "number"
      ? `Etat equipement: ${message.imageAnalysis.equipmentDetails.conditionScore}/100`
      : null,
    typeof message.imageAnalysis?.equipmentDetails?.criticalityScore === "number"
      ? `Criticite equipement: ${message.imageAnalysis.equipmentDetails.criticalityScore}/100`
      : null,
    formatRiskLevelLabel(message.imageAnalysis?.riskLevel)
      ? `Niveau de risque: ${formatRiskLevelLabel(message.imageAnalysis?.riskLevel)}`
      : null,
    typeof message.imageAnalysis?.optimizationScore === "number"
      ? `Risque optimisation: ${message.imageAnalysis.optimizationScore}/100`
      : null,
    typeof message.imageAnalysis?.anomalyScore === "number"
      ? `Risque anomalie: ${message.imageAnalysis.anomalyScore}/100`
      : null,
    typeof message.imageAnalysis?.fraudScore === "number"
      ? `Risque fraude: ${message.imageAnalysis.fraudScore}/100`
      : null,
    typeof message.imageAnalysis?.costScore === "number"
      ? `Risque cout: ${message.imageAnalysis.costScore}/100`
      : null,
    message.imageAnalysis?.invoiceDetails?.billingPeriod
      ? `Periode: ${message.imageAnalysis.invoiceDetails.billingPeriod}`
      : null,
    message.imageAnalysis?.invoiceDetails?.totalAmountMad
      ? `Total facture: ${message.imageAnalysis.invoiceDetails.totalAmountMad}`
      : message.imageAnalysis?.invoiceDetails?.amountTtcMad
        ? `Montant TTC: ${message.imageAnalysis.invoiceDetails.amountTtcMad}`
        : null,
    formatReliabilityLabel(message.imageAnalysis?.confidence)
      ? `Fiabilite de lecture: ${formatReliabilityLabel(message.imageAnalysis?.confidence)}`
      : null,
    ...(message.imageAnalysis?.annotations ?? []).map(
      (item) =>
        `Annotation: ${item.label}${formatReliabilityLabel(item.confidence) ? ` | lecture ${formatReliabilityLabel(item.confidence)}` : ""}`,
    ),
    ...(message.imageAnalysis?.decisionRecommendations ?? []).map(
      (item) =>
        `Recommandation IA: ${item.title} | ${formatRiskLevelLabel(item.priority) ?? item.priority} | ${item.reason}${item.estimatedSaving ? ` | ${item.estimatedSaving}` : ""}`,
    ),
    ...(message.imageAnalysis?.detectedAnomalies ?? []).map((item) => `Anomalie: ${item}`),
    ...(message.imageAnalysis?.incidentDetails?.probableCauses ?? []).map((item) => `Cause probable: ${item}`),
    ...(message.imageAnalysis?.alertIntelligence?.immediateActions ?? []).map(
      (item) => `Action immediate: ${item}`,
    ),
    ...(message.imageAnalysis?.workflowDetails?.criticalSteps ?? []).map((item) => `Etape critique: ${item}`),
    ...(message.imageAnalysis?.workflowDetails?.automationOpportunities ?? []).map(
      (item) => `Automatisation: ${item}`,
    ),
    ...(message.imageAnalysis?.equipmentDetails?.detectedIssues ?? []).map((item) => `Defaut equipement: ${item}`),
    ...(message.imageAnalysis?.equipmentDetails?.maintenanceRecommendations ?? []).map(
      (item) => `Maintenance: ${item}`,
    ),
    message.executiveReport?.executiveSummary
      ? `Resume executif: ${message.executiveReport.executiveSummary}`
      : null,
    typeof message.executiveReport?.fleetHealthScore === "number"
      ? `Fleet Health Score: ${message.executiveReport.fleetHealthScore}/100`
      : null,
    typeof message.executiveReport?.riskScore === "number"
      ? `Score risque: ${message.executiveReport.riskScore}/100`
      : null,
    message.executiveReport?.estimatedSavings
      ? `Economies estimees: ${message.executiveReport.estimatedSavings}`
      : null,
    ...(message.executiveReport?.priorityRisks ?? []).map((item) => `Risque prioritaire: ${item}`),
    ...(message.executiveReport?.topRecommendations ?? []).map(
      (item) =>
        `Recommandation executif: ${item.title} | ${formatRiskLevelLabel(item.priority) ?? item.priority} | ${item.action}${typeof item.estimatedSavingMad === "number" ? ` | ${formatMadValue(item.estimatedSavingMad)}` : ""}`,
    ),
    message.explainability?.answer ? `Lecture explicative: ${message.explainability.answer}` : null,
    typeof message.explainability?.confidenceScore === "number"
      ? `Confiance explicative: ${message.explainability.confidenceScore}/100`
      : null,
    typeof message.explainability?.riskScore === "number"
      ? `Score de risque explicatif: ${message.explainability.riskScore}/100`
      : null,
    ...(message.explainability?.reasoning ?? []).map((item) => `Facteur explicatif: ${item}`),
    ...(message.explainability?.causes ?? []).map((item) => `Cause probable: ${item}`),
    ...(message.explainability?.recommendations ?? []).map((item) => `Action recommandee: ${item}`),
    ...(message.sources ?? []).map((source) => `Source: ${source}`),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}

function getAlertTimelineToneClass(
  status: "observed" | "watch" | "critical" | "action" | undefined,
): string {
  if (status === "critical") {
    return "border-[#F87171]/35 bg-[#FFF1F2] text-[#B91C1C] dark:border-[#EF4444]/30 dark:bg-[#2F0F14] dark:text-[#FCA5A5]";
  }
  if (status === "watch") {
    return "border-[#F59E0B]/35 bg-[#FFFBEB] text-[#B45309] dark:border-[#F59E0B]/30 dark:bg-[#35220A] dark:text-[#FCD34D]";
  }
  if (status === "action") {
    return "border-[#818CF8]/35 bg-[#EEF2FF] text-[#4338CA] dark:border-[#6366F1]/30 dark:bg-[#131B46] dark:text-[#C7D2FE]";
  }
  return "border-[var(--bc-neutral-border)] bg-white/75 text-[var(--bc-neutral-body)] dark:bg-[#08101f]";
}

interface AlertIntelligenceCardProps {
  analysis: TelecomChatImageAnalysis;
  messageId: string;
  canRunAdvancedImageAnalysis: boolean;
  onRunAdvancedImageAnalysis: (messageId: string) => void;
}

function AlertIntelligenceCard({
  analysis,
  messageId,
  canRunAdvancedImageAnalysis,
  onRunAdvancedImageAnalysis,
}: AlertIntelligenceCardProps) {
  const alertIntelligence = analysis.alertIntelligence;
  const incidentDetails = analysis.incidentDetails;

  if (!alertIntelligence) {
    return null;
  }

  const criticity = alertIntelligence.criticity ?? analysis.riskLevel ?? null;
  const criticityLabel = formatRiskLevelLabel(criticity) ?? "A surveiller";
  const aiRiskScore =
    alertIntelligence.aiRiskScore ??
    analysis.fraudScore ??
    analysis.anomalyScore ??
    analysis.costScore ??
    null;
  const ocrConfidenceScore =
    alertIntelligence.ocrConfidenceScore ??
    (typeof analysis.ocrConfidence === "number"
      ? Math.round(analysis.ocrConfidence * 100)
      : null);
  const impactLabel =
    alertIntelligence.financialExposureMad ??
    incidentDetails?.financialImpactMad ??
    incidentDetails?.suspectCostMad ??
    null;
  const headline =
    alertIntelligence.executiveSummary ??
    incidentDetails?.summary ??
    "Les indicateurs visibles de la capture appellent une lecture prioritaire.";
  const businessRisk =
    alertIntelligence.businessRisk ??
    "La capture doit etre traitee comme un sujet de supervision prioritaire.";
  const priorityKpis = dedupeStrings(
    [
      ...(alertIntelligence.priorityKpis ?? []),
      ...(incidentDetails?.criticalSignals ?? []),
    ].filter((item): item is string => item.trim().length > 0),
    6,
  );
  const atRiskEntities = dedupeStrings(
    [
      ...(alertIntelligence.atRiskEntities ?? []),
      ...(incidentDetails?.riskyEntities ?? []),
    ].filter((item): item is string => item.trim().length > 0),
    5,
  );
  const immediateActions = dedupeStrings(
    [
      ...(alertIntelligence.immediateActions ?? []),
      ...((analysis.decisionRecommendations ?? []).map((item) => item.title)),
    ].filter((item): item is string => item.trim().length > 0),
    4,
  );
  const recommendedControls = dedupeStrings(
    [
      ...(alertIntelligence.recommendedControls ?? []),
      ...(alertIntelligence.visibleEvidence ?? []),
    ].filter((item): item is string => item.trim().length > 0),
    5,
  );
  const timeline =
    alertIntelligence.alertTimeline?.filter(
      (item) => item.label.trim().length > 0 && item.detail.trim().length > 0,
    ) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="rounded-[22px] border border-[var(--bc-primary-border)] bg-[linear-gradient(145deg,rgba(238,242,255,0.96),rgba(255,255,255,0.94))] p-3.5 shadow-[0_20px_44px_-34px_rgba(79,70,229,0.45)] dark:bg-[linear-gradient(145deg,rgba(17,24,39,0.96),rgba(8,16,31,0.98))]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-ai-start)]">
            <Brain className="h-3.5 w-3.5" />
            <span>Analyse intelligente des alertes</span>
          </div>
          <p className="mt-2 text-[13px] font-semibold leading-5 text-[var(--bc-neutral-strong)]">
            {headline}
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-[var(--bc-neutral-body)]">
            {businessRisk}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
            getPriorityBadgeClass(criticity),
          )}
        >
          {criticityLabel}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-2.5 dark:bg-[#08101f]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
            Risque IA
          </p>
          <p className="mt-1 text-[22px] font-semibold leading-none text-[var(--bc-neutral-strong)]">
            {typeof aiRiskScore === "number" ? `${aiRiskScore}%` : "n/a"}
          </p>
          <p className="mt-1 text-[11px] text-[var(--bc-neutral-body)]">
            Score consolide sur criticite, exposition et signaux visibles.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-2.5 dark:bg-[#08101f]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
            Confiance OCR
          </p>
          <p className="mt-1 text-[22px] font-semibold leading-none text-[var(--bc-neutral-strong)]">
            {typeof ocrConfidenceScore === "number" ? `${ocrConfidenceScore}%` : "n/a"}
          </p>
          <p className="mt-1 text-[11px] text-[var(--bc-neutral-body)]">
            Fiabilite de lecture textuelle de la capture.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-2.5 dark:bg-[#08101f]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
            Exposition
          </p>
          <p className="mt-1 text-[18px] font-semibold leading-tight text-[var(--bc-neutral-strong)]">
            {impactLabel ?? "Non chiffrable"}
          </p>
          <p className="mt-1 text-[11px] text-[var(--bc-neutral-body)]">
            {alertIntelligence.possibleSavingsMad
              ? `Reduction cible possible: ${alertIntelligence.possibleSavingsMad}.`
              : "Montant financier structure sur les KPI visibles."}
          </p>
        </div>
      </div>

      {priorityKpis.length > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
            KPI critiques visibles
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {priorityKpis.map((item, index) => (
              <span
                key={`${messageId}-alert-kpi-${index}`}
                className="inline-flex items-center rounded-full border border-[var(--bc-primary-border)] bg-white/88 px-2.5 py-1 text-[11px] text-[var(--bc-neutral-body)] dark:bg-[#08101f]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {timeline.length > 0 ? (
        <div className="mt-3">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
            <Radio className="h-3.5 w-3.5" />
            <span>Timeline alertes</span>
          </p>
          <div className="mt-2 space-y-2">
            {timeline.map((item, index) => (
              <div
                key={`${messageId}-alert-timeline-${index}`}
                className={cn(
                  "flex gap-2 rounded-2xl border px-3 py-2",
                  getAlertTimelineToneClass(item.status),
                )}
              >
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-current/75" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em]">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-5">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
            <Clock3 className="h-3.5 w-3.5" />
            <span>Actions immediates</span>
          </p>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-[var(--bc-neutral-body)]">
            {immediateActions.length > 0 ? (
              immediateActions.map((item, index) => (
                <li key={`${messageId}-alert-action-${index}`} className="flex gap-2">
                  <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                  <span>{item}</span>
                </li>
              ))
            ) : (
              <li className="flex gap-2">
                <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                <span>Prioriser les alertes visibles avant escalation.</span>
              </li>
            )}
          </ul>
          {alertIntelligence.auditFocus ? (
            <p className="mt-2 rounded-2xl border border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)]/70 px-3 py-2 text-[11px] leading-5 text-[var(--bc-neutral-body)]">
              {alertIntelligence.auditFocus}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>Exposition metier</span>
          </p>
          {atRiskEntities.length > 0 ? (
            <div className="mt-2">
              <p className="text-[11px] font-semibold text-[var(--bc-neutral-strong)]">
                Lignes ou profils a risque
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--bc-neutral-body)]">
                {atRiskEntities.join(", ")}
              </p>
            </div>
          ) : null}
          <ul className="mt-2 space-y-1.5 text-[12px] leading-5 text-[var(--bc-neutral-body)]">
            {recommendedControls.length > 0 ? (
              recommendedControls.map((item, index) => (
                <li key={`${messageId}-alert-control-${index}`} className="flex gap-2">
                  <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-primary)]" />
                  <span>{item}</span>
                </li>
              ))
            ) : (
              <li className="flex gap-2">
                <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-primary)]" />
                <span>Renforcer la surveillance sur les incidents visibles.</span>
              </li>
            )}
          </ul>
          {canRunAdvancedImageAnalysis ? (
            <button
              type="button"
              onClick={() => void onRunAdvancedImageAnalysis(messageId)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-primary)] transition-colors hover:bg-[var(--bc-primary-soft)]/80"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Audit approfondi</span>
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

export default function Chatbot() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user } = useAuth();
  const { localeCode } = useLanguage();
  const chatScope = useMemo(() => buildChatScope(user?.id), [user?.id]);
  const firstName = useMemo(
    () => user?.full_name?.trim().split(/\s+/)[0] ?? null,
    [user?.full_name],
  );

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [composerImage, setComposerImage] = useState<ComposerImageDraft | null>(null);
  const [composerPdf, setComposerPdf] = useState<ComposerPdfDraft | null>(null);
  const [voiceComposerState, setVoiceComposerState] = useState<VoiceComposerState>("idle");
  const [isContinuousVoiceMode, setIsContinuousVoiceMode] = useState(false);
  const [voiceTranscriptPreview, setVoiceTranscriptPreview] = useState<string | null>(null);
  const [voiceTranscriptConfidence, setVoiceTranscriptConfidence] = useState<number | null>(null);
  const [voicePermissionState, setVoicePermissionState] = useState<VoicePermissionState>("prompt");
  const [voiceCaptureFeedback, setVoiceCaptureFeedback] = useState<VoiceCaptureFeedback>("idle");
  const [pendingVoiceDraft, setPendingVoiceDraft] = useState<PendingVoiceDraft | null>(null);
  const [isVoiceFallbackConverting, setIsVoiceFallbackConverting] = useState(false);
  const [voiceVisualizerLevels, setVoiceVisualizerLevels] = useState<number[]>(
    buildVoiceVisualizerLevels,
  );
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [conversations, setConversations] = useState<TelecomChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [visibleConversationCount, setVisibleConversationCount] =
    useState(CONVERSATION_PAGE_SIZE);
  const [visibleMessageCount, setVisibleMessageCount] = useState(
    INITIAL_VISIBLE_MESSAGE_COUNT,
  );
  const [suggestions, setSuggestions] = useState<string[]>(assistantQuestionSuggestions);
  const [dataset, setDataset] = useState<TelecomAssistantDataset | null>(null);
  const [isDatasetLoading, setIsDatasetLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingCopilotActionPlan, setIsGeneratingCopilotActionPlan] = useState(false);
  const [copilotActionPlan, setCopilotActionPlan] = useState<ApiChatActionPlanResponse | null>(null);
  const [copilotActionPlanError, setCopilotActionPlanError] = useState<string | null>(null);
  const [copilotLoadingLabel, setCopilotLoadingLabel] = useState<string | null>(null);
  const [selectedAiReportType, setSelectedAiReportType] = useState<ApiReportType>("executive");
  const [isGeneratingAiReport, setIsGeneratingAiReport] = useState(false);
  const [aiReport, setAiReport] = useState<ApiReportGenerateResponse | null>(null);
  const [aiReportError, setAiReportError] = useState<string | null>(null);
  const [aiReportLoadingLabel, setAiReportLoadingLabel] = useState<string | null>(null);
  const [thinkingConversationId, setThinkingConversationId] = useState<string | null>(null);
  const [slowConversationId, setSlowConversationId] = useState<string | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedSourceMessageIds, setExpandedSourceMessageIds] = useState<string[]>([]);
  const [expandedOcrMessageIds, setExpandedOcrMessageIds] = useState<string[]>([]);
  const [expandedVisionMessageIds, setExpandedVisionMessageIds] = useState<string[]>([]);
  const [expandedAnnotatedMessageIds, setExpandedAnnotatedMessageIds] = useState<string[]>([]);
  const [expandedExplainabilityMessageIds, setExpandedExplainabilityMessageIds] = useState<string[]>([]);
  const [compareAnnotatedMessageIds, setCompareAnnotatedMessageIds] = useState<string[]>([]);
  const [expandedDecisionRecommendationKeys, setExpandedDecisionRecommendationKeys] = useState<string[]>([]);
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renamingConversationValue, setRenamingConversationValue] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageValue, setEditingMessageValue] = useState("");
  const [explainingMessageId, setExplainingMessageId] = useState<string | null>(null);
  const [xaiLoadingMessageId, setXaiLoadingMessageId] = useState<string | null>(null);
  const [xaiLoadingLabel, setXaiLoadingLabel] = useState<string | null>(null);
  const [sendRipple, setSendRipple] = useState<{ id: number; x: number; y: number } | null>(null);
  const [zoomedChatImage, setZoomedChatImage] = useState<ZoomedChatImage | null>(null);
  const [previewedPdfAttachment, setPreviewedPdfAttachment] = useState<PreviewedPdfAttachment | null>(null);
  const [previewViewerScale, setPreviewViewerScale] = useState(1);
  const [isPreviewViewerLoading, setIsPreviewViewerLoading] = useState(false);
  const [audioPlaybackState, setAudioPlaybackState] = useState<AudioPlaybackState>("idle");
  const [audioPlaybackMessageId, setAudioPlaybackMessageId] = useState<string | null>(null);
  const [audioPlaybackDuration, setAudioPlaybackDuration] = useState<number | null>(null);
  const [voicePlaybackVolume, setVoicePlaybackVolume] = useState(1);
  const [voicePlaybackRate, setVoicePlaybackRate] = useState(1);
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const editingInputRef = useRef<HTMLTextAreaElement | null>(null);
  const renamingTitleInputRef = useRef<HTMLInputElement | null>(null);
  const renamingTitleContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechRecognitionTranscriptRef = useRef("");
  const speechRecognitionErrorRef = useRef<string | null>(null);
  const voiceCaptureSuccessTimerRef = useRef<number | null>(null);
  const recordedVoiceChunksRef = useRef<Blob[]>([]);
  const voiceTranscriptionControllerRef = useRef<AbortController | null>(null);
  const voiceSpeakControllerRef = useRef<AbortController | null>(null);
  const explainabilityControllerRef = useRef<AbortController | null>(null);
  const copilotActionPlanControllerRef = useRef<AbortController | null>(null);
  const aiReportControllerRef = useRef<AbortController | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioStopRequestedRef = useRef(false);
  const audioCacheRef = useRef<Record<string, CachedVoicePlayback>>({});
  const lastVoicePlaybackRef = useRef<VoicePlaybackSnapshot | null>(null);
  const continuousVoiceModeRef = useRef(false);
  const continuousVoiceRestartTimerRef = useRef<number | null>(null);
  const voiceVisualizerFrameRef = useRef<number | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceMediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const startVoiceRecordingRef = useRef<(() => void) | null>(null);
  const hasHydratedRef = useRef(false);
  const scrollModeRef = useRef<"bottom" | "none">("bottom");
  const isOpenRef = useRef(isOpen);
  const isMinimizedRef = useRef(isMinimized);
  const activeStreamRef = useRef<ActiveChatStream | null>(null);
  const imageStageIntervalRef = useRef<number | null>(null);
  const xaiStageIntervalRef = useRef<number | null>(null);
  const copilotStageIntervalRef = useRef<number | null>(null);
  const aiReportStageIntervalRef = useRef<number | null>(null);
  const aiReportObjectUrlRef = useRef<string | null>(null);
  const aiReportObjectUrlReportIdRef = useRef<string | null>(null);

  const isPanelVisible = isOpen && !isMinimized;
  const composerAttachment: ComposerImageDraft | ComposerPdfDraft | null =
    composerPdf ?? composerImage;

  useEffect(() => {
    continuousVoiceModeRef.current = isContinuousVoiceMode;
  }, [isContinuousVoiceMode]);

  const resetVoiceVisualizer = useCallback(() => {
    setVoiceVisualizerLevels(buildVoiceVisualizerLevels());
  }, []);

  const clearContinuousVoiceRestart = useCallback(() => {
    if (continuousVoiceRestartTimerRef.current !== null) {
      window.clearTimeout(continuousVoiceRestartTimerRef.current);
      continuousVoiceRestartTimerRef.current = null;
    }
  }, []);

  const clearVoiceCaptureSuccessFeedback = useCallback(() => {
    if (voiceCaptureSuccessTimerRef.current !== null) {
      window.clearTimeout(voiceCaptureSuccessTimerRef.current);
      voiceCaptureSuccessTimerRef.current = null;
    }
    setVoiceCaptureFeedback("idle");
  }, []);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    scrollModeRef.current = "bottom";
    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior,
        block: "end",
      });
    });
  }, []);

  const stopVoiceVisualizer = useCallback(() => {
    if (voiceVisualizerFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceVisualizerFrameRef.current);
      voiceVisualizerFrameRef.current = null;
    }

    voiceMediaSourceRef.current?.disconnect();
    voiceMediaSourceRef.current = null;
    voiceAnalyserRef.current?.disconnect();
    voiceAnalyserRef.current = null;

    if (voiceAudioContextRef.current) {
      void voiceAudioContextRef.current.close().catch(() => {
        // Ignore browser audio context teardown errors.
      });
      voiceAudioContextRef.current = null;
    }

    resetVoiceVisualizer();
  }, [resetVoiceVisualizer]);

  const startVoiceVisualizer = useCallback(
    async (stream: MediaStream) => {
      stopVoiceVisualizer();

      const AudioContextConstructor =
        window.AudioContext ||
        (
          window as Window &
            typeof globalThis & {
              webkitAudioContext?: typeof AudioContext;
            }
        ).webkitAudioContext;

      if (!AudioContextConstructor) {
        return;
      }

      try {
        const audioContext = new AudioContextConstructor();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.78;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        voiceAudioContextRef.current = audioContext;
        voiceAnalyserRef.current = analyser;
        voiceMediaSourceRef.current = source;

        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        const updateLevels = () => {
          if (!voiceAnalyserRef.current) {
            return;
          }

          voiceAnalyserRef.current.getByteFrequencyData(frequencyData);
          const sliceSize = Math.max(1, Math.floor(frequencyData.length / VOICE_VISUALIZER_BAR_COUNT));
          const nextLevels = Array.from({ length: VOICE_VISUALIZER_BAR_COUNT }, (_, index) => {
            const startIndex = index * sliceSize;
            const slice = frequencyData.slice(startIndex, startIndex + sliceSize);
            const averageLevel =
              slice.length > 0
                ? slice.reduce((total, value) => total + value, 0) / slice.length
                : 0;
            return Math.min(1, Math.max(0.12, averageLevel / 190));
          });
          setVoiceVisualizerLevels(nextLevels);
          voiceVisualizerFrameRef.current = window.requestAnimationFrame(updateLevels);
        };

        updateLevels();
      } catch {
        resetVoiceVisualizer();
      }
    },
    [resetVoiceVisualizer, stopVoiceVisualizer],
  );

  const interruptStreamingMessage = useCallback(
    (conversationId: string, assistantMessageId: string) => {
      startTransition(() => {
        setConversations((currentConversations) => {
          const currentConversation = currentConversations.find(
            (conversation) => conversation.id === conversationId,
          );
          if (!currentConversation) {
            return currentConversations;
          }

          return upsertConversation(currentConversations, {
            ...replaceStreamingMessageWithInterruption(
              currentConversation,
              assistantMessageId,
            ),
          });
        });
      });
    },
    [],
  );

  const clearImageStageInterval = useCallback(() => {
    if (imageStageIntervalRef.current !== null) {
      window.clearInterval(imageStageIntervalRef.current);
      imageStageIntervalRef.current = null;
    }
  }, []);

  const clearExplainabilityStageInterval = useCallback(() => {
    if (xaiStageIntervalRef.current !== null) {
      window.clearInterval(xaiStageIntervalRef.current);
      xaiStageIntervalRef.current = null;
    }
    setXaiLoadingMessageId(null);
    setXaiLoadingLabel(null);
  }, []);

  const clearCopilotStageInterval = useCallback(() => {
    if (copilotStageIntervalRef.current !== null) {
      window.clearInterval(copilotStageIntervalRef.current);
      copilotStageIntervalRef.current = null;
    }
    setCopilotLoadingLabel(null);
  }, []);

  const clearAiReportStageInterval = useCallback(() => {
    if (aiReportStageIntervalRef.current !== null) {
      window.clearInterval(aiReportStageIntervalRef.current);
      aiReportStageIntervalRef.current = null;
    }
    setAiReportLoadingLabel(null);
  }, []);

  const revokeAiReportObjectUrl = useCallback(() => {
    if (aiReportObjectUrlRef.current) {
      URL.revokeObjectURL(aiReportObjectUrlRef.current);
      aiReportObjectUrlRef.current = null;
      aiReportObjectUrlReportIdRef.current = null;
    }
  }, []);

  const abortExplainabilityRequest = useCallback(() => {
    if (explainabilityControllerRef.current) {
      explainabilityControllerRef.current.abort();
      explainabilityControllerRef.current = null;
    }
    setExplainingMessageId(null);
    clearExplainabilityStageInterval();
  }, [clearExplainabilityStageInterval]);

  const abortCopilotActionPlanRequest = useCallback(() => {
    if (copilotActionPlanControllerRef.current) {
      copilotActionPlanControllerRef.current.abort();
      copilotActionPlanControllerRef.current = null;
    }
    clearCopilotStageInterval();
    setIsGeneratingCopilotActionPlan(false);
  }, [clearCopilotStageInterval]);

  const abortAiReportRequest = useCallback(() => {
    if (aiReportControllerRef.current) {
      aiReportControllerRef.current.abort();
      aiReportControllerRef.current = null;
    }
    clearAiReportStageInterval();
    setIsGeneratingAiReport(false);
  }, [clearAiReportStageInterval]);

  const updateStreamingMessageLoadingLabel = useCallback(
    (conversationId: string, assistantMessageId: string, loadingLabel: string) => {
      startTransition(() => {
        setConversations((currentConversations) => {
          const currentConversation = currentConversations.find(
            (conversation) => conversation.id === conversationId,
          );
          if (!currentConversation) {
            return currentConversations;
          }

          return upsertConversation(currentConversations, {
            ...currentConversation,
            messages: currentConversation.messages.map((message) =>
              message.id === assistantMessageId && message.status === "streaming"
                ? {
                    ...message,
                    loadingLabel,
                  }
                : message,
            ),
          });
        });
      });
    },
    [],
  );

  const abortActiveStream = useCallback(() => {
    const activeStream = activeStreamRef.current;
    if (!activeStream) {
      return null;
    }

    debugChatbot("[chatbot] request_cancelled", {
      requestId: activeStream.requestId,
      mode: activeStream.mode,
      conversationId: activeStream.conversationId,
      durationMs: Date.now() - activeStream.startedAt,
      question: activeStream.question,
    });
    activeStreamRef.current = null;
    activeStream.controller.abort();
    clearImageStageInterval();
    setIsGenerating(false);
    setThinkingConversationId(null);
    setSlowConversationId((currentConversationId) =>
      currentConversationId === activeStream.conversationId ? null : currentConversationId,
    );
    setRegeneratingMessageId(null);
    interruptStreamingMessage(activeStream.conversationId, activeStream.assistantMessageId);
    return activeStream;
  }, [clearImageStageInterval, interruptStreamingMessage]);

  const stopVoiceMediaTracks = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStreamRef.current = null;
  }, []);

  const resolveMicrophonePermission = useCallback(async (): Promise<VoicePermissionState> => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      setVoicePermissionState("unsupported");
      return "unsupported";
    }

    try {
      const permissionStatus = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      const nextState = permissionStatus.state as VoicePermissionState;
      setVoicePermissionState(nextState);
      return nextState;
    } catch {
      setVoicePermissionState("unsupported");
      return "unsupported";
    }
  }, []);

  const injectVoiceTranscriptIntoComposer = useCallback(
    (transcript: string) => {
      const normalizedTranscript = normalizeVoiceTranscript(transcript);
      if (!normalizedTranscript) {
        return;
      }

      setInputValue((currentValue) =>
        mergeVoiceTranscriptWithComposer(currentValue, normalizedTranscript),
      );
      setVoiceTranscriptPreview(normalizedTranscript);
      setVoiceTranscriptConfidence(1);
      setPendingVoiceDraft(null);
      setErrorMessage(null);
      clearVoiceCaptureSuccessFeedback();
      setVoiceCaptureFeedback("success");

      voiceCaptureSuccessTimerRef.current = window.setTimeout(() => {
        setVoiceCaptureFeedback("idle");
        voiceCaptureSuccessTimerRef.current = null;
      }, 2200);

      window.setTimeout(() => {
        inputRef.current?.focus();
        const textLength = inputRef.current?.value.length ?? 0;
        inputRef.current?.setSelectionRange(textLength, textLength);
      }, 60);

      scrollChatToBottom();
    },
    [clearVoiceCaptureSuccessFeedback, scrollChatToBottom],
  );

  const applyVoiceCaptureFailure = useCallback(
    (message: string, voiceBlob?: Blob | null, transcriptOverride?: string | null) => {
      const hasRecoverableVoiceDraft = Boolean(voiceBlob && voiceBlob.size > 0);
      setVoiceComposerState("idle");
      setVoiceCaptureFeedback("error");
      setVoiceTranscriptConfidence(null);
      setVoiceTranscriptPreview(null);
      setErrorMessage(hasRecoverableVoiceDraft ? null : message);
      setPendingVoiceDraft(
        hasRecoverableVoiceDraft && voiceBlob
          ? {
              blob: voiceBlob,
              mimeType: voiceBlob.type || "audio/webm",
              transcript:
                normalizeVoiceTranscript(transcriptOverride ?? speechRecognitionTranscriptRef.current) ||
                null,
              message,
            }
          : null,
      );
      scrollChatToBottom();
    },
    [scrollChatToBottom],
  );

  const stopBrowserSpeechRecognition = useCallback((mode: "stop" | "abort" = "abort") => {
    const activeRecognition = speechRecognitionRef.current;
    if (!activeRecognition) {
      return;
    }

    activeRecognition.onresult = null;
    activeRecognition.onerror = null;
    activeRecognition.onend = null;

    try {
      if (mode === "stop") {
        activeRecognition.stop();
      } else {
        activeRecognition.abort();
      }
    } catch {
      // Ignore browser-level shutdown errors for speech recognition.
    }

    speechRecognitionRef.current = null;
  }, []);

  const startBrowserSpeechRecognition = useCallback((): boolean => {
    const SpeechRecognitionConstructor = getBrowserSpeechRecognitionConstructor();
    if (!SpeechRecognitionConstructor) {
      debugChatbot("[chatbot] browser_speech_recognition_unavailable");
      speechRecognitionTranscriptRef.current = "";
      speechRecognitionErrorRef.current = null;
      return false;
    }

    stopBrowserSpeechRecognition();
    speechRecognitionTranscriptRef.current = "";
    speechRecognitionErrorRef.current = null;

    const recognition = new SpeechRecognitionConstructor();
    recognition.lang = resolveVoiceRecognitionLanguage(localeCode);
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setVoiceComposerState("listening");
      setErrorMessage(null);
    };
    recognition.onresult = (event) => {
      const transcriptParts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const candidate = event.results[index]?.[0]?.transcript;
        if (candidate) {
          transcriptParts.push(candidate);
        }
      }
      const normalizedTranscript = normalizeVoiceTranscript(transcriptParts.join(" "));
      if (!normalizedTranscript) {
        return;
      }
      speechRecognitionTranscriptRef.current = normalizedTranscript;
      setVoiceTranscriptPreview(normalizedTranscript);
      setVoiceTranscriptConfidence(1);
    };
    recognition.onerror = (event) => {
      speechRecognitionErrorRef.current = getBrowserSpeechRecognitionErrorMessage(event.error);
      debugChatbot("[chatbot] browser_speech_recognition_failed", {
        error: event.error,
        localeCode,
        recorderState: mediaRecorderRef.current?.state ?? "inactive",
      });
    };
    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null;
      }
      debugChatbot("[chatbot] browser_speech_recognition_ended", {
        localeCode,
        recorderState: mediaRecorderRef.current?.state ?? "inactive",
      });
    };

    try {
      recognition.start();
      speechRecognitionRef.current = recognition;
      return true;
    } catch (error) {
      speechRecognitionErrorRef.current = null;
      debugChatbot("[chatbot] browser_speech_recognition_start_failed", {
        localeCode,
        error: error instanceof Error ? error.message : String(error),
      });
      speechRecognitionRef.current = null;
      return false;
    }
  }, [localeCode, stopBrowserSpeechRecognition]);

  const abortVoiceTranscriptionRequest = useCallback(() => {
    if (voiceTranscriptionControllerRef.current) {
      voiceTranscriptionControllerRef.current.abort();
      voiceTranscriptionControllerRef.current = null;
    }
  }, []);

  const abortVoiceSpeakRequest = useCallback(() => {
    if (voiceSpeakControllerRef.current) {
      voiceSpeakControllerRef.current.abort();
      voiceSpeakControllerRef.current = null;
    }
  }, []);

  const transcribeVoiceBlobToComposer = useCallback(
    async (
      voiceBlob: Blob,
      options: {
        fallbackTranscript?: string | null;
        failureMessage?: string | null;
        source: "manual" | "recording_stop";
      },
    ) => {
      if (!token) {
        setVoiceComposerState("idle");
        setErrorMessage("Session indisponible. Reconnectez-vous puis reessayez.");
        return;
      }

      if (voiceBlob.size === 0) {
        applyVoiceCaptureFailure("Aucun son detecte.");
        return;
      }

      abortVoiceTranscriptionRequest();
      const controller = new AbortController();
      voiceTranscriptionControllerRef.current = controller;
      setIsVoiceFallbackConverting(true);
      setVoiceComposerState("transcribing");
      setErrorMessage(null);
      debugChatbot("[chatbot] voice_blob_transcription_started", {
        source: options.source,
        blobSize: voiceBlob.size,
        mimeType: voiceBlob.type || "audio/webm",
        fallbackTranscriptChars: normalizeVoiceTranscript(options.fallbackTranscript).length,
      });

      try {
        const audioFile = buildVoiceAudioFileFromBlob(voiceBlob);
        const transcription = await chatApi.transcribeVoice(token, audioFile, controller.signal);
        debugChatbot("[chatbot] voice_blob_transcription_succeeded", {
          source: options.source,
          transcriptChars: transcription.transcript.length,
          language: transcription.language,
          confidence: transcription.confidence,
        });
        injectVoiceTranscriptIntoComposer(transcription.transcript);
        setPendingVoiceDraft(null);
        setVoiceComposerState("idle");
      } catch (error) {
        if (isAbortLikeError(error)) {
          setVoiceComposerState("idle");
          return;
        }

        const nextMessage = getVoiceErrorMessage(error);
        debugChatbot("[chatbot] voice_blob_transcription_failed", {
          source: options.source,
          message: nextMessage,
          error,
        });
        setVoiceCaptureFeedback("error");
        applyVoiceCaptureFailure(
          options.failureMessage || nextMessage,
          voiceBlob,
          options.fallbackTranscript,
        );
      } finally {
        if (voiceTranscriptionControllerRef.current === controller) {
          voiceTranscriptionControllerRef.current = null;
        }
        setIsVoiceFallbackConverting(false);
      }
    },
    [
      abortVoiceTranscriptionRequest,
      applyVoiceCaptureFailure,
      injectVoiceTranscriptIntoComposer,
      token,
    ],
  );

  const stopAssistantAudioPlayback = useCallback(() => {
    clearContinuousVoiceRestart();
    abortVoiceSpeakRequest();
    audioStopRequestedRef.current = true;

    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      audioElementRef.current.onended = null;
      audioElementRef.current.onpause = null;
      audioElementRef.current.onplay = null;
      audioElementRef.current = null;
    }

    setAudioPlaybackState("idle");
    setAudioPlaybackMessageId(null);
    setAudioPlaybackDuration(null);
    setVoiceComposerState((currentState) =>
      currentState === "speaking" ? "idle" : currentState,
    );

    window.setTimeout(() => {
      audioStopRequestedRef.current = false;
    }, 0);
  }, [abortVoiceSpeakRequest, clearContinuousVoiceRestart]);

  const cancelVoiceCapture = useCallback(() => {
    abortVoiceTranscriptionRequest();
    recordedVoiceChunksRef.current = [];
    stopBrowserSpeechRecognition();
    speechRecognitionTranscriptRef.current = "";
    speechRecognitionErrorRef.current = null;
    clearVoiceCaptureSuccessFeedback();

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // Ignore browser-level recorder stop errors during teardown.
      }
      mediaRecorderRef.current = null;
    }

    stopVoiceVisualizer();
    stopVoiceMediaTracks();
    setVoiceComposerState((currentState) =>
      currentState === "listening" || currentState === "transcribing" ? "idle" : currentState,
    );
  }, [
    abortVoiceTranscriptionRequest,
    clearVoiceCaptureSuccessFeedback,
    stopBrowserSpeechRecognition,
    stopVoiceMediaTracks,
    stopVoiceVisualizer,
  ]);

  const syncComposerHeight = useCallback(() => {
    const inputElement = inputRef.current;
    if (!inputElement) {
      return;
    }

    inputElement.style.height = "0px";
    const nextHeight = Math.min(Math.max(inputElement.scrollHeight, 52), 128);
    inputElement.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    return () => {
      abortAiReportRequest();
      abortCopilotActionPlanRequest();
      clearContinuousVoiceRestart();
      clearVoiceCaptureSuccessFeedback();
      cancelVoiceCapture();
      revokeAiReportObjectUrl();
      stopAssistantAudioPlayback();
      stopVoiceVisualizer();
    };
  }, [
    abortAiReportRequest,
    abortCopilotActionPlanRequest,
    cancelVoiceCapture,
    clearContinuousVoiceRestart,
    clearVoiceCaptureSuccessFeedback,
    revokeAiReportObjectUrl,
    stopAssistantAudioPlayback,
    stopVoiceVisualizer,
  ]);

  useEffect(() => {
    if (!audioElementRef.current) {
      return;
    }

    audioElementRef.current.volume = isVoiceMuted ? 0 : voicePlaybackVolume;
  }, [isVoiceMuted, voicePlaybackVolume]);

  useEffect(() => {
    if (!audioElementRef.current) {
      return;
    }

    audioElementRef.current.playbackRate = voicePlaybackRate;
  }, [voicePlaybackRate]);

  useEffect(() => {
    if (!isContinuousVoiceMode) {
      clearContinuousVoiceRestart();
    }
  }, [clearContinuousVoiceRestart, isContinuousVoiceMode]);

  const ensureDatasetLoaded = useCallback(
    async (forceRefresh = false): Promise<TelecomAssistantDataset> => {
      if (dataset && !forceRefresh) {
        return dataset;
      }

      setIsDatasetLoading(true);
      setErrorMessage(null);

      try {
        const nextDataset = await loadTelecomAssistantDataset(token);
        setDataset(nextDataset);
        return nextDataset;
      } catch (error) {
        const description =
          error instanceof Error
            ? error.message
            : "Impossible de charger le contexte metier du chatbot.";
        setErrorMessage(description);
        throw error;
      } finally {
        setIsDatasetLoading(false);
      }
    },
    [dataset, token],
  );

  useEffect(() => {
    revokeAiReportObjectUrl();
    const storedState = loadStoredTelecomChatState(chatScope);
    const initialConversations =
      storedState.conversations.length > 0
        ? storedState.conversations
        : [createTelecomConversation(buildWelcomeMessage(firstName))];
    const initialActiveConversationId =
      storedState.lastConversationId &&
      initialConversations.some(
        (conversation) => conversation.id === storedState.lastConversationId,
      )
        ? storedState.lastConversationId
        : initialConversations[0]?.id ?? null;

    setConversations(sortTelecomConversations(initialConversations));
    setActiveConversationId(initialActiveConversationId);
    setVisibleConversationCount(CONVERSATION_PAGE_SIZE);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
    setExpandedSourceMessageIds([]);
    setExpandedOcrMessageIds([]);
    setExpandedVisionMessageIds([]);
    setExpandedAnnotatedMessageIds([]);
    setExpandedExplainabilityMessageIds([]);
    setCompareAnnotatedMessageIds([]);
    setExpandedDecisionRecommendationKeys([]);
    setSelectedConversationIds([]);
    setRenamingConversationId(null);
    setRenamingConversationValue("");
    setSuggestions(assistantQuestionSuggestions);
    setShowAllSuggestions(false);
    setInputValue("");
    setComposerImage(null);
    setComposerPdf(null);
    setEditingMessageId(null);
    setEditingMessageValue("");
    setAiReport(null);
    setAiReportError(null);
    setAiReportLoadingLabel(null);
    setSelectedAiReportType("executive");
    setZoomedChatImage(null);
    setPreviewedPdfAttachment(null);
    setUnreadCount(0);
    hasHydratedRef.current = true;
  }, [chatScope, firstName, revokeAiReportObjectUrl]);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return;
    }

    if (thinkingConversationId !== null) {
      return;
    }

    saveStoredTelecomChatState(chatScope, {
      lastConversationId: activeConversationId,
      conversations,
    });
  }, [activeConversationId, chatScope, conversations, thinkingConversationId]);

  useEffect(() => {
    setDataset(null);
  }, [token]);

  useEffect(() => {
    isOpenRef.current = isOpen;
    isMinimizedRef.current = isMinimized;
  }, [isMinimized, isOpen]);

  useEffect(() => {
    return () => {
      abortExplainabilityRequest();
      abortAiReportRequest();
      clearImageStageInterval();
      activeStreamRef.current?.controller.abort();
      activeStreamRef.current = null;
    };
  }, [abortAiReportRequest, abortExplainabilityRequest, clearImageStageInterval]);

  useEffect(() => {
    if (!isPanelVisible || dataset || isDatasetLoading) {
      return;
    }

    void ensureDatasetLoaded();
  }, [dataset, ensureDatasetLoaded, isDatasetLoading, isPanelVisible]);

  useEffect(() => {
    if (!isPanelVisible) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      syncComposerHeight();
      inputRef.current?.focus();
    }, 150);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeConversationId, isFullscreen, isPanelVisible, syncComposerHeight]);

  useEffect(() => {
    if (!editingMessageId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      editingInputRef.current?.focus();
      editingInputRef.current?.setSelectionRange(
        editingInputRef.current.value.length,
        editingInputRef.current.value.length,
      );
    }, 60);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [editingMessageId]);

  useEffect(() => {
    if (!renamingConversationId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      renamingTitleInputRef.current?.focus();
      renamingTitleInputRef.current?.select();
    }, 40);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [renamingConversationId]);

  useEffect(() => {
    syncComposerHeight();
  }, [inputValue, syncComposerHeight]);

  useEffect(() => {
    if (!isPanelVisible) {
      return;
    }

    setUnreadCount(0);
  }, [activeConversationId, isPanelVisible]);

  useEffect(() => {
    if (!zoomedChatImage && !previewedPdfAttachment) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomedChatImage(null);
        setPreviewedPdfAttachment(null);
        setPreviewViewerScale(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewedPdfAttachment, zoomedChatImage]);

  useEffect(() => {
    if (!isPanelVisible || typeof window === "undefined") {
      return;
    }

    if (!isFullscreen && !window.matchMedia("(max-width: 1023px)").matches) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isFullscreen, isPanelVisible]);

  useEffect(() => {
    if (!isPanelVisible || typeof window === "undefined") {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (isHistoryPanelOpen) {
        setIsHistoryPanelOpen(false);
        return;
      }

      setIsOpen(false);
      setIsMinimized(false);
      setIsFullscreen(false);
      setIsHistoryPanelOpen(false);
      setShowAllSuggestions(false);
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isHistoryPanelOpen, isPanelVisible]);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) ??
      conversations[0] ??
      null,
    [activeConversationId, conversations],
  );
  const executiveAnalysisCount = useMemo(
    () => collectExecutiveReportImageAnalyses(conversations).length,
    [conversations],
  );
  const executiveExportImageCount = useMemo(
    () => collectExecutiveReportExportImages(conversations).length,
    [conversations],
  );
  const latestExecutiveReport = useMemo(
    () => collectLatestExecutiveReport(conversations),
    [conversations],
  );
  const latestExplainability = useMemo(
    () => collectLatestExplainability(conversations),
    [conversations],
  );

  const visibleMessages = useMemo(() => {
    if (!activeConversation) {
      return [];
    }

    return activeConversation.messages.slice(-visibleMessageCount);
  }, [activeConversation, visibleMessageCount]);
  const lastVisibleMessageText = visibleMessages[visibleMessages.length - 1]?.text ?? "";
  const lastVisibleMessageStatus =
    visibleMessages[visibleMessages.length - 1]?.status ?? "complete";
  const lastVisibleLoadingLabel =
    visibleMessages[visibleMessages.length - 1]?.loadingLabel ?? "";

  useEffect(() => {
    if (!isPanelVisible) {
      return;
    }

    const scrollMode = scrollModeRef.current;
    scrollModeRef.current = "bottom";

    if (scrollMode !== "bottom") {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    activeConversationId,
    isPanelVisible,
    thinkingConversationId,
    visibleMessages.length,
    lastVisibleMessageText,
    lastVisibleMessageStatus,
    lastVisibleLoadingLabel,
  ]);

  const helperBadges = useMemo(() => {
    if (!dataset) {
      return ["Contexte en preparation", "Lignes", "Forfaits", "Alertes importantes"];
    }

    return [
      `${dataset.occupationStats.total_libre} lignes libres`,
      `${dataset.lineStats.critical_ai_alerts} alertes critiques`,
      `${dataset.recommendations.length} pistes d'optimisation`,
      dataset.usingMock ? "Vue complete" : "Donnees a jour",
    ];
  }, [dataset]);

  const summaryBadges = useMemo(() => helperBadges.slice(0, 3), [helperBadges]);

  const freshnessLabel = useMemo(() => {
    if (!dataset) {
      return "Sources locales : CSV traites + lignes synchronisees";
    }

    return dataset.usingMock
      ? "Sources locales : CSV traites + secours local"
      : "Sources locales : CSV traites + donnees synchronisees";
  }, [dataset]);

  const recentPrompts = useMemo(
    () => collectRecentTelecomPrompts(conversations, 10),
    [conversations],
  );

  const contextualSuggestions = useMemo(
    () => getContextualSuggestions(location.pathname),
    [location.pathname],
  );

  const visibleSuggestions = useMemo(
    () =>
      dedupeStrings(
        [...suggestions, ...contextualSuggestions, ...recentPrompts],
        8,
      ),
    [contextualSuggestions, recentPrompts, suggestions],
  );

  const primarySuggestions = useMemo(
    () => visibleSuggestions.slice(0, INLINE_SUGGESTION_COUNT),
    [visibleSuggestions],
  );

  const overflowSuggestions = useMemo(
    () => visibleSuggestions.slice(INLINE_SUGGESTION_COUNT),
    [visibleSuggestions],
  );

  const recentQuestionChips = useMemo(
    () =>
      dedupeStrings(
        recentPrompts.filter((prompt) => !visibleSuggestions.includes(prompt)),
        5,
      ),
    [recentPrompts, visibleSuggestions],
  );

  const visibleConversations = useMemo(
    () => sortTelecomConversations(conversations).slice(0, visibleConversationCount),
    [conversations, visibleConversationCount],
  );

  const hasMoreHistory = conversations.length > visibleConversationCount;
  const hasOlderMessages =
    activeConversation !== null &&
    activeConversation.messages.length > visibleMessageCount;
  const isBusy = isGenerating || regeneratingMessageId !== null;
  const selectedConversationCount = selectedConversationIds.length;
  const allConversationsSelected =
    conversations.length > 0 && selectedConversationCount === conversations.length;
  const hasSuggestionOverflow =
    overflowSuggestions.length > 0 || recentQuestionChips.length > 0;
  const launcherBadgeCount = unreadCount > 9 ? "9+" : unreadCount > 0 ? String(unreadCount) : null;
  const connectionLabel = isGenerating ? "Analyse en cours" : "Modele local Ollama";
  const fullscreenToggleLabel = isFullscreen ? "Reduire" : "Agrandir";
  const isVoiceListening = voiceComposerState === "listening";
  const isVoiceTranscribing = voiceComposerState === "transcribing";
  const isVoiceThinking = voiceComposerState === "thinking";
  const isVoiceSpeaking = voiceComposerState === "speaking";
  const isVoiceWorkflowActive =
    isVoiceListening || isVoiceTranscribing || isVoiceThinking || isVoiceSpeaking;
  const voiceStatusTitle = (() => {
    if (isVoiceListening) {
      return "Ecoute en cours...";
    }
    if (isVoiceTranscribing) {
      return "Analyse de la voix...";
    }
    if (isVoiceThinking) {
      return "Analyse IA...";
    }
    if (isVoiceSpeaking) {
      return "Lecture de la reponse...";
    }
    if (voiceCaptureFeedback === "success") {
      return "Texte pret a etre envoye";
    }
    if (pendingVoiceDraft) {
      return "Verification vocale requise";
    }
    if (isContinuousVoiceMode) {
      return "Mode vocal continu actif";
    }
    return "Saisie vocale assistee";
  })();
  const voiceComposerHelperText = (() => {
    if (isVoiceListening) {
      return "Parlez naturellement. Le texte sera ajoute dans le champ des la fin de votre phrase.";
    }
    if (isVoiceTranscribing) {
      return "Analyse de la voix...";
    }
    if (isVoiceThinking) {
      return "Generation de la reponse avec Ollama...";
    }
    if (isVoiceSpeaking) {
      return "Lecture vocale Edge TTS en cours...";
    }
    if (voiceCaptureFeedback === "success") {
      return "Transcription injectee. Vous pouvez relire, corriger puis envoyer votre question.";
    }
    if (pendingVoiceDraft) {
      return "L'enregistrement vocal est conserve. Utilisez la carte de recuperation pour relancer la transcription ou envoyer l'audio.";
    }
    if (voicePermissionState === "denied") {
      return "Le micro est bloque par le navigateur. Autorisez-le puis recommencez.";
    }
    if (isContinuousVoiceMode) {
      return "Le micro se reactive automatiquement apres chaque reponse.";
    }
    return "Collez une image avec Ctrl+V, glissez une image ou un document ici, utilisez les boutons document ou le micro.";
  })();

  const handleOpenChat = useCallback(() => {
    scrollModeRef.current = "bottom";
    setIsOpen(true);
    setIsMinimized(false);
    setIsHistoryPanelOpen(false);
    setShowAllSuggestions(false);
  }, []);

  const handleGenerateCopilotActionPlan = useCallback(async () => {
    if (!token) {
      toast.error("Connectez-vous pour utiliser le mode IA Copilot.");
      return;
    }

    abortCopilotActionPlanRequest();
    const controller = new AbortController();
    copilotActionPlanControllerRef.current = controller;
    setIsGeneratingCopilotActionPlan(true);
    setCopilotActionPlanError(null);
    setCopilotLoadingLabel(COPILOT_ACTION_PLAN_STAGES[0]);

    let stageIndex = 0;
    copilotStageIntervalRef.current = window.setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, COPILOT_ACTION_PLAN_STAGES.length - 1);
      setCopilotLoadingLabel(COPILOT_ACTION_PLAN_STAGES[stageIndex]);
    }, 1200);

    try {
      const actionPlan = await chatApi.generateCopilotActionPlan(token, {
        history: [],
      });
      setCopilotActionPlan(actionPlan);
      if (!isPanelVisible) {
        handleOpenChat();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (error instanceof ApiError) {
        setCopilotActionPlanError(error.message);
        toast.error(error.message);
      } else {
        const message = "Impossible de générer le plan d'action IA.";
        setCopilotActionPlanError(message);
        toast.error(message);
      }
    } finally {
      copilotActionPlanControllerRef.current = null;
      clearCopilotStageInterval();
      setIsGeneratingCopilotActionPlan(false);
    }
  }, [abortCopilotActionPlanRequest, clearCopilotStageInterval, handleOpenChat, isPanelVisible, token]);

  const buildAiReportFilename = useCallback((report: ApiReportGenerateResponse) => {
    const safeType = report.report_type.replace(/_/g, "-");
    const safeDate = report.generated_at.slice(0, 10);
    return `rapport-ia-${safeType}-${safeDate}.pdf`;
  }, []);

  const ensureAiReportObjectUrl = useCallback(async () => {
    if (!token || !aiReport) {
      return null;
    }

    if (
      aiReportObjectUrlRef.current &&
      aiReportObjectUrlReportIdRef.current === aiReport.report_id
    ) {
      return aiReportObjectUrlRef.current;
    }

    const blob = await reportsApi.downloadPdf(token, aiReport.report_id);
    revokeAiReportObjectUrl();
    const objectUrl = URL.createObjectURL(blob);
    aiReportObjectUrlRef.current = objectUrl;
    aiReportObjectUrlReportIdRef.current = aiReport.report_id;
    return objectUrl;
  }, [aiReport, revokeAiReportObjectUrl, token]);

  const handlePreviewAiReport = useCallback(async () => {
    if (!aiReport) {
      toast.error("Aucun rapport IA genere.");
      return;
    }

    try {
      const objectUrl = await ensureAiReportObjectUrl();
      if (!objectUrl) {
        toast.error("Impossible de charger la previsualisation PDF.");
        return;
      }
      window.open(objectUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(getChatErrorMessage(error));
    }
  }, [aiReport, ensureAiReportObjectUrl]);

  const handleDownloadAiReport = useCallback(async () => {
    if (!aiReport) {
      toast.error("Aucun rapport IA genere.");
      return;
    }

    try {
      const objectUrl = await ensureAiReportObjectUrl();
      if (!objectUrl) {
        toast.error("Impossible de telecharger le PDF.");
        return;
      }

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = buildAiReportFilename(aiReport);
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      toast.success("PDF IA pret au telechargement.");
    } catch (error) {
      toast.error(getChatErrorMessage(error));
    }
  }, [aiReport, buildAiReportFilename, ensureAiReportObjectUrl]);

  const handleShareAiReport = useCallback(async () => {
    if (!token || !aiReport) {
      toast.error("Aucun rapport IA disponible a partager.");
      return;
    }

    try {
      const blob = await reportsApi.downloadPdf(token, aiReport.report_id);
      const file = new File([blob], buildAiReportFilename(aiReport), {
        type: "application/pdf",
      });

      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: "Rapport IA BC SKILLS",
          text: "Rapport executif intelligent genere depuis le cockpit IA telecom.",
          files: [file],
        });
        return;
      }

      await navigator.clipboard.writeText(
        `Rapport IA ${aiReport.report_id} - ${aiReport.report_type} - genere le ${formatConversationDate(aiReport.generated_at)}`,
      );
      toast.success("Reference du rapport copiee dans le presse-papiers.");
    } catch (error) {
      toast.error(getChatErrorMessage(error));
    }
  }, [aiReport, buildAiReportFilename, token]);

  const handleGenerateAiReport = useCallback(async (reportTypeOverride?: ApiReportType) => {
    if (!token) {
      const message = "Session indisponible. Reconnectez-vous puis reessayez.";
      setAiReportError(message);
      toast.error(message);
      return;
    }

    abortAiReportRequest();
    setAiReportError(null);
    setIsGeneratingAiReport(true);
    setAiReportLoadingLabel(AI_REPORT_STAGES[0]);

    const controller = new AbortController();
    aiReportControllerRef.current = controller;
    let stageIndex = 0;
    aiReportStageIntervalRef.current = window.setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, AI_REPORT_STAGES.length - 1);
      setAiReportLoadingLabel(AI_REPORT_STAGES[stageIndex]);
    }, 1200);

    try {
      const response = await reportsApi.generate(
        token,
        {
          report_type: reportTypeOverride ?? selectedAiReportType,
          conversation_id: activeConversation?.id ?? null,
          history: activeConversation
            ? buildApiHistory(activeConversation.messages).slice(-10)
            : [],
          image_analyses: collectExecutiveReportImageAnalyses(conversations),
          executive_report: latestExecutiveReport
            ? buildExecutiveReportApiPayloadFromStoredReport(latestExecutiveReport)
            : null,
          explainability: latestExplainability
            ? buildExplainabilityApiPayloadFromStoredExplanation(latestExplainability)
            : null,
          images: collectExecutiveReportExportImages(conversations, 8),
        },
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      if (aiReportObjectUrlReportIdRef.current !== response.report_id) {
        revokeAiReportObjectUrl();
      }
      setAiReport(response);
      if (!isPanelVisible) {
        handleOpenChat();
      }
      toast.success("Rapport IA genere.", {
        description: `Fleet Health Score ${response.fleet_health_score}/100`,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const message =
        error instanceof ApiError
          ? error.message
          : "Impossible de generer le rapport PDF IA.";
      setAiReportError(message);
      toast.error(message);
    } finally {
      aiReportControllerRef.current = null;
      clearAiReportStageInterval();
      setIsGeneratingAiReport(false);
    }
  }, [
    abortAiReportRequest,
    activeConversation,
    clearAiReportStageInterval,
    conversations,
    handleOpenChat,
    isPanelVisible,
    latestExecutiveReport,
    latestExplainability,
    revokeAiReportObjectUrl,
    selectedAiReportType,
    token,
  ]);

  const handleCloseChat = useCallback(() => {
    abortAiReportRequest();
    abortCopilotActionPlanRequest();
    cancelVoiceCapture();
    stopAssistantAudioPlayback();
    setIsOpen(false);
    setIsMinimized(false);
    setIsFullscreen(false);
    setIsHistoryPanelOpen(false);
    setShowAllSuggestions(false);
    setSlowConversationId(null);
    setRenamingConversationId(null);
    setRenamingConversationValue("");
    setComposerImage(null);
    setComposerPdf(null);
    setVoiceTranscriptPreview(null);
    setVoiceTranscriptConfidence(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
  }, [abortAiReportRequest, abortCopilotActionPlanRequest, cancelVoiceCapture, stopAssistantAudioPlayback]);

  const handleMinimizeChat = useCallback(() => {
    if (isVoiceListening) {
      cancelVoiceCapture();
    }
    setIsOpen(true);
    setIsMinimized(true);
    setIsFullscreen(false);
    setIsHistoryPanelOpen(false);
    setSlowConversationId(null);
    setRenamingConversationId(null);
    setRenamingConversationValue("");
  }, [cancelVoiceCapture, isVoiceListening]);

  const handleToggleFullscreen = useCallback(() => {
    scrollModeRef.current = "bottom";
    setIsOpen(true);
    setIsMinimized(false);
    setIsFullscreen((currentValue) => !currentValue);
  }, []);

  const handleCreateConversation = useCallback(() => {
    cancelVoiceCapture();
    stopAssistantAudioPlayback();
    const nextConversation = createTelecomConversation(buildWelcomeMessage(firstName));
    scrollModeRef.current = "bottom";

    startTransition(() => {
      setConversations((currentConversations) =>
        upsertConversation(currentConversations, nextConversation),
      );
      setActiveConversationId(nextConversation.id);
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
      setExpandedSourceMessageIds([]);
      setExpandedOcrMessageIds([]);
      setExpandedVisionMessageIds([]);
      setExpandedAnnotatedMessageIds([]);
      setExpandedExplainabilityMessageIds([]);
      setCompareAnnotatedMessageIds([]);
      setExpandedDecisionRecommendationKeys([]);
      setSuggestions(contextualSuggestions);
      setShowAllSuggestions(false);
      setInputValue("");
      setSelectedConversationIds([]);
      setRenamingConversationId(null);
      setRenamingConversationValue("");
      setEditingMessageId(null);
      setEditingMessageValue("");
      setZoomedChatImage(null);
      setPreviewedPdfAttachment(null);
      setComposerImage(null);
      setComposerPdf(null);
      setVoiceTranscriptPreview(null);
      setVoiceTranscriptConfidence(null);
      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
      if (pdfInputRef.current) {
        pdfInputRef.current.value = "";
      }
      setIsOpen(true);
      setIsMinimized(false);
      setIsHistoryPanelOpen(false);
    });
  }, [cancelVoiceCapture, contextualSuggestions, firstName, stopAssistantAudioPlayback]);

  const handleSelectConversation = (conversationId: string) => {
    handleCommitRenamingConversation();
    stopAssistantAudioPlayback();
    scrollModeRef.current = "bottom";
    setActiveConversationId(conversationId);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
    setExpandedSourceMessageIds([]);
    setExpandedOcrMessageIds([]);
    setExpandedVisionMessageIds([]);
    setExpandedAnnotatedMessageIds([]);
    setExpandedExplainabilityMessageIds([]);
    setCompareAnnotatedMessageIds([]);
    setExpandedDecisionRecommendationKeys([]);
    setShowAllSuggestions(false);
    setEditingMessageId(null);
    setEditingMessageValue("");
    setZoomedChatImage(null);
    setPreviewedPdfAttachment(null);
    setIsOpen(true);
    setIsMinimized(false);
    setIsHistoryPanelOpen(false);
  };

  const handleCopyMessage = async (message: TelecomChatMessage) => {
    try {
      await navigator.clipboard.writeText(serializeMessageForCopy(message));
      toast.success("Reponse copiee", {
        description: "Le contenu de la reponse est disponible dans le presse-papiers.",
      });
    } catch {
      toast.error("Copie impossible", {
        description: "Le navigateur n'a pas autorise la copie de cette reponse.",
      });
    }
  };

  const handleToggleSources = (messageId: string) => {
    setExpandedSourceMessageIds((currentMessageIds) =>
      currentMessageIds.includes(messageId)
        ? currentMessageIds.filter((currentId) => currentId !== messageId)
        : [...currentMessageIds, messageId],
    );
  };

  const handleToggleOcr = (messageId: string) => {
    setExpandedOcrMessageIds((currentMessageIds) =>
      currentMessageIds.includes(messageId)
        ? currentMessageIds.filter((currentId) => currentId !== messageId)
        : [...currentMessageIds, messageId],
    );
  };

  const handleToggleVision = (messageId: string) => {
    setExpandedVisionMessageIds((currentMessageIds) =>
      currentMessageIds.includes(messageId)
        ? currentMessageIds.filter((currentId) => currentId !== messageId)
        : [...currentMessageIds, messageId],
    );
  };

  const handleToggleAnnotatedImage = (messageId: string) => {
    setExpandedAnnotatedMessageIds((currentMessageIds) =>
      currentMessageIds.includes(messageId)
        ? currentMessageIds.filter((currentId) => currentId !== messageId)
        : [...currentMessageIds, messageId],
    );
  };

  const handleToggleAnnotatedCompare = (messageId: string) => {
    setCompareAnnotatedMessageIds((currentMessageIds) =>
      currentMessageIds.includes(messageId)
        ? currentMessageIds.filter((currentId) => currentId !== messageId)
        : [...currentMessageIds, messageId],
    );
  };

  const handleToggleExplainability = (messageId: string) => {
    setExpandedExplainabilityMessageIds((currentMessageIds) =>
      currentMessageIds.includes(messageId)
        ? currentMessageIds.filter((currentId) => currentId !== messageId)
        : [...currentMessageIds, messageId],
    );
  };

  const handleToggleDecisionRecommendation = (recommendationKey: string) => {
    setExpandedDecisionRecommendationKeys((currentKeys) =>
      currentKeys.includes(recommendationKey)
        ? currentKeys.filter((currentKey) => currentKey !== recommendationKey)
        : [...currentKeys, recommendationKey],
    );
  };

  const closeAttachmentPreview = useCallback(() => {
    setZoomedChatImage(null);
    setPreviewedPdfAttachment(null);
    setPreviewViewerScale(1);
    setIsPreviewViewerLoading(false);
  }, []);

  const openImagePreview = useCallback((src: string, title: string) => {
    if (!src.trim()) {
      toast.error("Apercu indisponible. Le fichier d'origine n'est plus disponible dans cette session.");
      return;
    }
    setPreviewedPdfAttachment(null);
    setPreviewViewerScale(1);
    setIsPreviewViewerLoading(true);
    setZoomedChatImage({
      src,
      title,
    });
  }, []);

  const openPdfPreview = useCallback((src: string, title: string) => {
    if (!src.trim()) {
      toast.error("Apercu indisponible. Le fichier d'origine n'est plus disponible dans cette session.");
      return;
    }
    setZoomedChatImage(null);
    setPreviewViewerScale(1);
    setIsPreviewViewerLoading(true);
    setPreviewedPdfAttachment({
      src,
      title,
    });
  }, []);

  const handleRemoveComposerImage = useCallback(() => {
    setComposerImage(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }, []);

  const handleRemoveComposerPdf = useCallback(() => {
    setComposerPdf(null);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
  }, []);

  const handleUpdateComposerImageAnalysisMode = useCallback(
    (analysisMode: ImageAnalysisMode) => {
      setComposerImage((currentImage) =>
        currentImage
          ? {
              ...currentImage,
              analysisMode,
            }
          : currentImage,
      );
    },
    [],
  );

  const handleUpdateComposerPdfAnalysisMode = useCallback(
    (analysisMode: ImageAnalysisMode) => {
      setComposerPdf((currentPdf) =>
        currentPdf
          ? {
              ...currentPdf,
              analysisMode,
            }
          : currentPdf,
      );
    },
    [],
  );

  const handleExplainMessage = useCallback(
    async (message: TelecomChatMessage) => {
      if (!token || !activeConversation || message.role !== "assistant") {
        return;
      }

      if (message.explainability) {
        handleToggleExplainability(message.id);
        return;
      }

      const messageIndex = activeConversation.messages.findIndex((item) => item.id === message.id);
      if (messageIndex < 0) {
        return;
      }

      abortExplainabilityRequest();
      const controller = new AbortController();
      explainabilityControllerRef.current = controller;
      setExplainingMessageId(message.id);
      setExpandedExplainabilityMessageIds((currentIds) =>
        currentIds.includes(message.id) ? currentIds : [...currentIds, message.id],
      );
      setXaiLoadingMessageId(message.id);
      setXaiLoadingLabel(EXPLAINABILITY_STAGES[0]);

      let stageIndex = 0;
      xaiStageIntervalRef.current = window.setInterval(() => {
        stageIndex = Math.min(stageIndex + 1, EXPLAINABILITY_STAGES.length - 1);
        setXaiLoadingLabel(EXPLAINABILITY_STAGES[stageIndex]);
      }, 1300);

      const question =
        message.imageAnalysis || message.recommendation
          ? "Quels facteurs ont influence cette alerte et sa priorisation ?"
          : message.executiveReport
            ? "Quels facteurs expliquent ce rapport executif et ses priorites ?"
            : "Quels facteurs ont influence cette analyse ?";
      const focusLabel =
        message.imageAnalysis?.incidentDetails?.summary ||
        message.imageAnalysis?.detectedAnomalies?.[0] ||
        message.executiveReport?.priorityRisks?.[0] ||
        message.recommendation ||
        message.text.slice(0, 140);

      try {
        const response = await chatApi.explain(
          token,
          {
            question,
            focus_label: focusLabel,
            conversation_id: activeConversation.id,
            history: buildApiHistory(activeConversation.messages.slice(0, messageIndex)).slice(-10),
            message_text: message.text,
            image_analysis: message.imageAnalysis
              ? buildExecutiveReportImageContextFromAnalysis(message.imageAnalysis)
              : null,
            executive_report: message.executiveReport
              ? buildExplainabilityExecutiveContextFromReport(message.executiveReport)
              : null,
            use_live_context: true,
          },
          controller.signal,
        );

        const explainability = buildExplainabilityFromApi(response);
        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === activeConversation.id,
            );
            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              messages: currentConversation.messages.map((currentMessage) =>
                currentMessage.id === message.id
                  ? {
                      ...currentMessage,
                      explainability,
                    }
                  : currentMessage,
              ),
            });
          });
        });
      } catch (error) {
        if (!isAbortLikeError(error)) {
          const nextErrorMessage =
            error instanceof ApiError
              ? error.message
              : "Explication IA indisponible pour ce message.";
          setErrorMessage(nextErrorMessage);
          toast.error("Explication IA indisponible", {
            description: nextErrorMessage,
          });
        }
      } finally {
        if (explainabilityControllerRef.current === controller) {
          explainabilityControllerRef.current = null;
        }
        setExplainingMessageId((currentMessageId) =>
          currentMessageId === message.id ? null : currentMessageId,
        );
        clearExplainabilityStageInterval();
      }
    },
    [
      abortExplainabilityRequest,
      activeConversation,
      clearExplainabilityStageInterval,
      token,
    ],
  );

  const handleExplainRecommendation = useCallback(
    async (
      message: TelecomChatMessage,
      recommendationTitle: string,
    ): Promise<ApiExplainRecommendationResponse> => {
      const normalizedTitle = recommendationTitle.trim();
      if (!token || !activeConversation || !normalizedTitle) {
        throw new Error("Contexte IA indisponible pour cette recommandation.");
      }

      const messageIndex = activeConversation.messages.findIndex((item) => item.id === message.id);
      if (messageIndex < 0) {
        throw new Error("Message source introuvable pour l'explication IA.");
      }

      const contextMessages = activeConversation.messages.slice(0, messageIndex + 1);
      const contextualImageAnalysis =
        message.imageAnalysis ??
        [...contextMessages]
          .reverse()
          .find((item): item is TelecomChatMessage & { imageAnalysis: TelecomChatImageAnalysis } =>
            Boolean(item.imageAnalysis),
          )?.imageAnalysis ??
        null;
      const contextualExecutiveReport =
        message.executiveReport ??
        [...contextMessages]
          .reverse()
          .find((item): item is TelecomChatMessage & { executiveReport: TelecomExecutiveReport } =>
            Boolean(item.executiveReport),
          )?.executiveReport ??
        null;

      return chatApi.explainRecommendation(token, {
        recommendation_title: normalizedTitle,
        conversation_id: activeConversation.id,
        history: buildApiHistory(contextMessages).slice(-12),
        image_analysis: contextualImageAnalysis
          ? buildExecutiveReportImageContextFromAnalysis(contextualImageAnalysis)
          : null,
        executive_report: contextualExecutiveReport
          ? buildExplainabilityExecutiveContextFromReport(contextualExecutiveReport)
          : null,
        use_live_context: true,
      });
    },
    [activeConversation, token],
  );

  const handleAttachImage = useCallback(async (
    file: File | null | undefined,
    source: ComposerImageDraft["source"] = "upload",
  ) => {
    if (!file) {
      return;
    }

    const validationError = getComposerImageValidationError(file);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    try {
      const compressedImage = await compressComposerImage(file, source);
      setComposerPdf(null);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = "";
      }
      setComposerImage(compressedImage);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Impossible de charger l'image.");
    }
  }, []);

  const handleAttachPdf = useCallback(async (
    file: File | null | undefined,
    source: ComposerPdfDraft["source"] = "upload",
  ) => {
    if (!file) {
      return;
    }

    const validationError = getComposerDocumentValidationError(file);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setComposerImage(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
    setComposerPdf({
      ...buildDocumentAttachmentPreview(file, previewUrl),
      file,
      source,
      analysisMode: "advanced",
    });
    setErrorMessage(null);
  }, []);

  const handleImageInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleAttachImage(event.target.files?.[0], "upload");
  };

  const handlePdfInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleAttachPdf(event.target.files?.[0], "upload");
  };

  const handleOpenImagePicker = () => {
    imageInputRef.current?.click();
  };

  const handleOpenPdfPicker = () => {
    pdfInputRef.current?.click();
  };

  const handleComposerPaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedImage = getPastedImageFile(event);
    if (!pastedImage) {
      return;
    }

    event.preventDefault();
    await handleAttachImage(pastedImage, "paste");
  };

  const handleToggleConversationSelection = (conversationId: string) => {
    setSelectedConversationIds((currentConversationIds) =>
      currentConversationIds.includes(conversationId)
        ? currentConversationIds.filter((currentId) => currentId !== conversationId)
        : [...currentConversationIds, conversationId],
    );
  };

  const handleCancelRenamingConversation = useCallback(() => {
    setRenamingConversationId(null);
    setRenamingConversationValue("");
  }, []);

  const handleCommitRenamingConversation = useCallback(() => {
    if (!renamingConversationId) {
      return;
    }

    const targetConversation = conversations.find(
      (conversation) => conversation.id === renamingConversationId,
    );

    if (!targetConversation) {
      setRenamingConversationId(null);
      setRenamingConversationValue("");
      return;
    }

    const nextTitle = normalizeConversationTitle(
      renamingConversationValue,
      targetConversation.title || DEFAULT_CONVERSATION_TITLE,
    );

    startTransition(() => {
      setConversations((currentConversations) =>
        currentConversations.map((conversation) =>
          conversation.id === renamingConversationId
            ? {
                ...conversation,
                title: nextTitle,
              }
            : conversation,
        ),
      );
    });

    setRenamingConversationId(null);
    setRenamingConversationValue("");
  }, [conversations, renamingConversationId, renamingConversationValue]);

  const handleStartRenamingConversation = useCallback(
    (conversation: TelecomChatConversation) => {
      if (renamingConversationId && renamingConversationId !== conversation.id) {
        handleCommitRenamingConversation();
      }

      setRenamingConversationId(conversation.id);
      setRenamingConversationValue(
        normalizeConversationTitle(
          conversation.title,
          DEFAULT_CONVERSATION_TITLE,
        ),
      );
    },
    [handleCommitRenamingConversation, renamingConversationId],
  );

  const handleRenameConversationKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleCommitRenamingConversation();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelRenamingConversation();
      }
    },
    [handleCancelRenamingConversation, handleCommitRenamingConversation],
  );

  const handleToggleSelectAllConversations = () => {
    setSelectedConversationIds((currentConversationIds) =>
      currentConversationIds.length === conversations.length
        ? []
        : conversations.map((conversation) => conversation.id),
    );
  };

  const handleDeleteConversations = useCallback(
    (conversationIds: string[]) => {
      if (conversationIds.length === 0 || isBusy) {
        return;
      }

      const confirmed = window.confirm(
        conversationIds.length === 1
          ? "Supprimer cette discussion ?"
          : `Supprimer ${conversationIds.length} discussions ?`,
      );

      if (!confirmed) {
        return;
      }

      const nextFallbackConversation = createTelecomConversation(buildWelcomeMessage(firstName));

      startTransition(() => {
        const remainingConversations = removeConversationsById(conversations, conversationIds);
        const nextConversations =
          remainingConversations.length > 0
            ? sortTelecomConversations(remainingConversations)
            : [nextFallbackConversation];
        const nextActiveConversationId =
          activeConversationId && nextConversations.some((conversation) => conversation.id === activeConversationId)
            ? activeConversationId
            : nextConversations[0]?.id ?? null;

        setConversations(nextConversations);
        setActiveConversationId(nextActiveConversationId);
        setSelectedConversationIds((currentConversationIds) =>
          currentConversationIds.filter((conversationId) => !conversationIds.includes(conversationId)),
        );
        setVisibleConversationCount((currentCount) =>
          Math.max(currentCount, CONVERSATION_PAGE_SIZE),
        );
        setExpandedSourceMessageIds([]);
        setExpandedOcrMessageIds([]);
        setExpandedVisionMessageIds([]);
        setExpandedAnnotatedMessageIds([]);
        setCompareAnnotatedMessageIds([]);
        setExpandedDecisionRecommendationKeys([]);
        setRenamingConversationId((currentConversationId) =>
          currentConversationId && conversationIds.includes(currentConversationId)
            ? null
            : currentConversationId,
        );
        setRenamingConversationValue((currentValue) =>
          renamingConversationId && conversationIds.includes(renamingConversationId)
            ? ""
            : currentValue,
        );
        setEditingMessageId(null);
        setEditingMessageValue("");
        setZoomedChatImage(null);
        setPreviewedPdfAttachment(null);
      });

      toast.success(
        conversationIds.length === 1 ? "Discussion supprimee" : "Discussions supprimees",
      );
    },
    [activeConversationId, conversations, firstName, isBusy, renamingConversationId],
  );

  useEffect(() => {
    if (!renamingConversationId) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (renamingTitleContainerRef.current?.contains(event.target as Node)) {
        return;
      }

      handleCommitRenamingConversation();
    };

    window.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [handleCommitRenamingConversation, renamingConversationId]);

  const runStreamedAssistantResponse = useCallback(
    async ({
      conversationId,
      question,
      linkedUserMessageId,
      assistantMessageId,
      history,
      resolveTitle,
    }: {
      conversationId: string;
      question: string;
      linkedUserMessageId: string;
      assistantMessageId: string;
      history: Array<{ role: "assistant" | "user"; text: string }>;
      resolveTitle?: (response: ApiChatResponse) => string;
    }) => {
      if (!token) {
        const failedMessage = buildAssistantErrorMessage(
          "Session indisponible. Reconnectez-vous puis reessayez.",
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });

        return null;
      }

      setThinkingConversationId(conversationId);
      setIsGenerating(true);
      setSlowConversationId(null);

      const controller = new AbortController();
      const requestId = createUuid();
      const startedAt = Date.now();
      activeStreamRef.current = {
        mode: "text",
        controller,
        requestId,
        conversationId,
        assistantMessageId,
        question,
        startedAt,
      };
      debugChatbot("[chatbot] question_sent", {
        requestId,
        mode: "text",
        conversationId,
        question,
      });

      let streamedText = "";
      let finalResponse: ApiChatResponse | null = null;
      let animationFrameId: number | null = null;
      const slowTimerId = window.setTimeout(() => {
        if (activeStreamRef.current?.requestId === requestId) {
          setSlowConversationId(conversationId);
        }
      }, 2600);

      const flushPartialMessage = () => {
        if (activeStreamRef.current?.requestId !== requestId) {
          return;
        }

        const nextText = streamedText;
        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );
            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: new Date().toISOString(),
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      text: nextText,
                      status: "streaming",
                    }
                  : message,
              ),
            });
          });
        });
      };

      const schedulePartialFlush = () => {
        if (animationFrameId !== null) {
          return;
        }

        animationFrameId = window.requestAnimationFrame(() => {
          animationFrameId = null;
          flushPartialMessage();
        });
      };

      try {
        const response = await chatApi.stream(token, {
          question,
          conversation_id: conversationId,
          history,
        }, {
          signal: controller.signal,
          onToken: (chunk) => {
            if (activeStreamRef.current?.requestId !== requestId) {
              return;
            }
            streamedText += chunk;
            schedulePartialFlush();
          },
          onDone: (payload) => {
            if (activeStreamRef.current?.requestId === requestId) {
              finalResponse = payload;
            }
          },
        });

        if (activeStreamRef.current?.requestId !== requestId) {
          return null;
        }

        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        flushPartialMessage();
        const completedResponse = finalResponse ?? response;
        const completedMessage = buildAssistantMessage(
          buildAssistantContentFromApi(completedResponse),
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              title: resolveTitle ? resolveTitle(completedResponse) : currentConversation.title,
              updatedAt: completedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? completedMessage : message,
              ),
            });
          });
          setSuggestions(
            dedupeStrings([...contextualSuggestions, ...assistantQuestionSuggestions], 6),
          );
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        debugChatbot("[chatbot] response_completed", {
          requestId,
          mode: "text",
          conversationId,
          durationMs: Date.now() - startedAt,
        });
        return completedResponse;
      } catch (error) {
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }

        if (
          isAbortLikeError(error) ||
          (error instanceof ApiError && error.code === "REQUEST_CANCELLED")
        ) {
          debugChatbot("[chatbot] request_cancelled_acknowledged", {
            requestId,
            mode: "text",
            conversationId,
            durationMs: Date.now() - startedAt,
          });
          return null;
        }

        debugChatbot("[chatbot] backend_error_received", {
          requestId,
          mode: "text",
          conversationId,
          durationMs: Date.now() - startedAt,
          code: error instanceof ApiError ? error.code : null,
          message: getChatErrorMessage(error),
        });
        const failedMessage = buildAssistantErrorMessage(
          getChatErrorMessage(error),
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        return null;
      } finally {
        window.clearTimeout(slowTimerId);
        if (activeStreamRef.current?.requestId === requestId) {
          activeStreamRef.current = null;
          setIsGenerating(false);
          setThinkingConversationId(null);
          setSlowConversationId((currentConversationId) =>
            currentConversationId === conversationId ? null : currentConversationId,
          );
        }
      }
    },
    [contextualSuggestions, token],
  );

  const runGeoAssistantResponse = useCallback(
    async ({
      conversationId,
      question,
      linkedUserMessageId,
      assistantMessageId,
      resolveTitle,
    }: {
      conversationId: string;
      question: string;
      linkedUserMessageId: string;
      assistantMessageId: string;
      resolveTitle?: (response: ApiRoamingIntelligenceResponse) => string;
    }) => {
      if (!token) {
        const failedMessage = buildAssistantErrorMessage(
          "Session indisponible. Reconnectez-vous puis reessayez.",
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });

        return null;
      }

      setThinkingConversationId(conversationId);
      setIsGenerating(true);
      setSlowConversationId(null);

      const controller = new AbortController();
      const requestId = createUuid();
      const startedAt = Date.now();
      activeStreamRef.current = {
        mode: "text",
        controller,
        requestId,
        conversationId,
        assistantMessageId,
        question,
        startedAt,
      };
      debugChatbot("[chatbot] geo_question_sent", {
        requestId,
        mode: "geo",
        conversationId,
        question,
      });

      const slowTimerId = window.setTimeout(() => {
        if (activeStreamRef.current?.requestId === requestId) {
          setSlowConversationId(conversationId);
        }
      }, 1800);

      try {
        const geoMapResponse = await roamingApi.map(token, undefined, {
          signal: controller.signal,
        });

        debugChatbot("[chatbot] geo_map_loaded", {
          requestId,
          criticalZones: geoMapResponse.critical_zones.length,
          heatmapPoints: geoMapResponse.heatmap.length,
          devicePoints: geoMapResponse.devices.length,
        });

        if (activeStreamRef.current?.requestId !== requestId) {
          return null;
        }

        const completedMessage = buildAssistantMessage(
          buildGeoQuestionAssistantContent(question, geoMapResponse),
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              title: resolveTitle ? resolveTitle(geoMapResponse) : currentConversation.title,
              updatedAt: completedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? completedMessage : message,
              ),
            });
          });
          setSuggestions(
            dedupeStrings([...contextualSuggestions, ...assistantQuestionSuggestions], 6),
          );
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        debugChatbot("[chatbot] geo_response_completed", {
          requestId,
          mode: "geo",
          conversationId,
          durationMs: Date.now() - startedAt,
        });
        return geoMapResponse;
      } catch (error) {
        if (
          isAbortLikeError(error) ||
          (error instanceof ApiError && error.code === "REQUEST_CANCELLED")
        ) {
          debugChatbot("[chatbot] geo_request_cancelled", {
            requestId,
            mode: "geo",
            conversationId,
            durationMs: Date.now() - startedAt,
          });
          return null;
        }

        debugChatbot("[chatbot] geo_map_unavailable", {
          requestId,
          mode: "geo",
          conversationId,
          durationMs: Date.now() - startedAt,
          code: error instanceof ApiError ? error.code : null,
          message: getChatErrorMessage(error),
        });

        const fallbackMessage = buildAssistantMessage(
          buildGeoQuestionUnavailableContent("unavailable"),
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: fallbackMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? fallbackMessage : message,
              ),
            });
          });
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        return null;
      } finally {
        window.clearTimeout(slowTimerId);
        if (activeStreamRef.current?.requestId === requestId) {
          activeStreamRef.current = null;
          setIsGenerating(false);
          setThinkingConversationId(null);
          setSlowConversationId((currentConversationId) =>
            currentConversationId === conversationId ? null : currentConversationId,
          );
        }
      }
    },
    [contextualSuggestions, token],
  );

  const runImageAssistantResponse = useCallback(
    async ({
      conversationId,
      question,
      linkedUserMessageId,
      assistantMessageId,
      history,
      imageAttachment,
      analysisMode = "quick",
      resolveTitle,
    }: {
      conversationId: string;
      question: string;
      linkedUserMessageId: string;
      assistantMessageId: string;
      history: Array<{ role: "assistant" | "user"; text: string }>;
      imageAttachment: TelecomChatImageAttachment;
      analysisMode?: ImageAnalysisMode;
      resolveTitle?: (response: ApiChatImageResponse) => string;
    }) => {
      if (!token) {
        const failedMessage = buildAssistantErrorMessage(
          "Session indisponible. Reconnectez-vous puis reessayez.",
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });

        return null;
      }

      let imageFile: File;
      try {
        imageFile = dataUrlToFile(imageAttachment);
      } catch (error) {
        const failedMessage = buildAssistantErrorMessage(
          error instanceof Error ? error.message : "Image attachee invalide.",
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });
        return null;
      }

      setThinkingConversationId(conversationId);
      setIsGenerating(true);
      setSlowConversationId(null);

      const controller = new AbortController();
      const requestId = createUuid();
      const startedAt = Date.now();
      activeStreamRef.current = {
        mode: "document",
        controller,
        requestId,
        conversationId,
        assistantMessageId,
        question,
        startedAt,
      };
      debugChatbot("[chatbot] question_sent", {
        requestId,
        mode: "image",
        conversationId,
        question,
      });

      const imageAnalysisStages = buildImageAnalysisStages(question, imageFile.name, analysisMode);
      clearImageStageInterval();
      let stageIndex = 0;
      updateStreamingMessageLoadingLabel(
        conversationId,
        assistantMessageId,
        imageAnalysisStages[stageIndex],
      );
      imageStageIntervalRef.current = window.setInterval(() => {
        if (activeStreamRef.current?.requestId !== requestId) {
          clearImageStageInterval();
          return;
        }

        stageIndex = Math.min(stageIndex + 1, imageAnalysisStages.length - 1);
        updateStreamingMessageLoadingLabel(
          conversationId,
          assistantMessageId,
          imageAnalysisStages[stageIndex],
        );
      }, 1400);

      const slowTimerId = window.setTimeout(() => {
        if (activeStreamRef.current?.requestId === requestId) {
          setSlowConversationId(conversationId);
        }
      }, 2600);

      try {
        debugChatbot("[chatbot] image_request_payload", {
          requestId,
          endpoint: "/chat/image",
          conversationId,
          imageName: imageFile.name,
          imageType: imageFile.type,
          imageSize: imageFile.size,
          analysisMode,
          historySize: history.length,
        });
        const response = await chatApi.askWithImage(
          token,
          {
            question,
            conversation_id: conversationId,
            history,
            image: imageFile,
            analysis_mode: analysisMode,
          },
          controller.signal,
        );

        if (activeStreamRef.current?.requestId !== requestId) {
          return null;
        }
        debugChatbot("[chatbot] image_payload_received", {
          requestId,
          conversationId,
          imageType: response.image_type,
          detectedKpis: response.detected_kpis.length,
          hasVisionAnalysis: Boolean(response.vision_analysis),
          hasOcrText: Boolean(response.ocr_text),
          riskLevel: response.risk_level ?? null,
          analysisMode: response.analysis_mode,
          analysisStatus: response.analysis_status,
        });

        const completedMessage = buildAssistantMessage(
          buildAssistantContentFromImageApi(response),
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              title: resolveTitle ? resolveTitle(response) : currentConversation.title,
              updatedAt: completedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? completedMessage : message,
              ),
            });
          });
          setSuggestions(
            dedupeStrings([...contextualSuggestions, ...assistantQuestionSuggestions], 6),
          );
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        debugChatbot("[chatbot] response_completed", {
          requestId,
          mode: "image",
          conversationId,
          durationMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        if (
          isAbortLikeError(error) ||
          (error instanceof ApiError && error.code === "REQUEST_CANCELLED")
        ) {
          debugChatbot("[chatbot] request_cancelled_acknowledged", {
            requestId,
            mode: "image",
            conversationId,
            durationMs: Date.now() - startedAt,
          });
          return null;
        }

        debugChatbot("[chatbot] backend_error_received", {
          requestId,
          mode: "image",
          conversationId,
          durationMs: Date.now() - startedAt,
          code: error instanceof ApiError ? error.code : null,
          message: getChatErrorMessage(error),
        });
        const failedMessage = buildAssistantImageErrorMessage(
          error,
          linkedUserMessageId,
          analysisMode,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        return null;
      } finally {
        clearImageStageInterval();
        window.clearTimeout(slowTimerId);
        if (activeStreamRef.current?.requestId === requestId) {
          activeStreamRef.current = null;
          setIsGenerating(false);
          setThinkingConversationId(null);
          setSlowConversationId((currentConversationId) =>
            currentConversationId === conversationId ? null : currentConversationId,
          );
        }
      }
    },
    [clearImageStageInterval, contextualSuggestions, token, updateStreamingMessageLoadingLabel],
  );

  const runPdfAssistantResponse = useCallback(
    async ({
      conversationId,
      question,
      linkedUserMessageId,
      assistantMessageId,
      history,
      pdfAttachment,
      analysisMode = "advanced",
      resolveTitle,
    }: {
      conversationId: string;
      question: string;
      linkedUserMessageId: string;
      assistantMessageId: string;
      history: Array<{ role: "assistant" | "user"; text: string }>;
      pdfAttachment: TelecomChatPdfAttachment;
      analysisMode?: ImageAnalysisMode;
      resolveTitle?: (response: ApiChatImageResponse) => string;
    }) => {
      if (!token) {
        const failedMessage = buildAssistantErrorMessage(
          "Session indisponible. Reconnectez-vous puis reessayez.",
          linkedUserMessageId,
          assistantMessageId,
        );
        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );
            if (!currentConversation) {
              return currentConversations;
            }
            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });
        return null;
      }

      let pdfFile: File;
      try {
        pdfFile = await previewUrlToFile(pdfAttachment);
      } catch (error) {
        const failedMessage = buildAssistantErrorMessage(
          error instanceof Error ? error.message : "Document indisponible.",
          linkedUserMessageId,
          assistantMessageId,
        );
        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );
            if (!currentConversation) {
              return currentConversations;
            }
            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });
        return null;
      }

      setThinkingConversationId(conversationId);
      setIsGenerating(true);
      setSlowConversationId(null);

      const controller = new AbortController();
      const requestId = createUuid();
      const startedAt = Date.now();
      activeStreamRef.current = {
        mode: "document",
        controller,
        requestId,
        conversationId,
        assistantMessageId,
        question,
        startedAt,
      };

      const documentStages = buildDocumentAnalysisStages(pdfAttachment, question, analysisMode);
      clearImageStageInterval();
      let stageIndex = 0;
      updateStreamingMessageLoadingLabel(
        conversationId,
        assistantMessageId,
        documentStages[stageIndex],
      );
      imageStageIntervalRef.current = window.setInterval(() => {
        if (activeStreamRef.current?.requestId !== requestId) {
          clearImageStageInterval();
          return;
        }
        stageIndex = Math.min(stageIndex + 1, documentStages.length - 1);
        updateStreamingMessageLoadingLabel(
          conversationId,
          assistantMessageId,
          documentStages[stageIndex],
        );
      }, 1400);

      const slowTimerId = window.setTimeout(() => {
        if (activeStreamRef.current?.requestId === requestId) {
          setSlowConversationId(conversationId);
        }
      }, 2600);

      try {
        const response = await chatApi.askWithDocument(
          token,
          {
            question,
            conversation_id: conversationId,
            history,
            document: pdfFile,
            analysis_mode: analysisMode,
          },
          controller.signal,
        );

        if (activeStreamRef.current?.requestId !== requestId) {
          return null;
        }

        const completedMessage = buildAssistantMessage(
          buildAssistantContentFromImageApi(response),
          linkedUserMessageId,
          assistantMessageId,
        );
        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );
            if (!currentConversation) {
              return currentConversations;
            }
            return upsertConversation(currentConversations, {
              ...currentConversation,
              title: resolveTitle ? resolveTitle(response) : currentConversation.title,
              updatedAt: completedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? completedMessage : message,
              ),
            });
          });
        });
        return response;
      } catch (error) {
        if (
          isAbortLikeError(error) ||
          (error instanceof ApiError && error.code === "REQUEST_CANCELLED")
        ) {
          return null;
        }

        const failedMessage = buildAssistantImageErrorMessage(
          error,
          linkedUserMessageId,
          analysisMode,
          assistantMessageId,
          "document",
        );
        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );
            if (!currentConversation) {
              return currentConversations;
            }
            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });
        return null;
      } finally {
        clearImageStageInterval();
        window.clearTimeout(slowTimerId);
        if (activeStreamRef.current?.requestId === requestId) {
          activeStreamRef.current = null;
          setIsGenerating(false);
          setThinkingConversationId(null);
          setSlowConversationId((currentConversationId) =>
            currentConversationId === conversationId ? null : currentConversationId,
          );
        }
      }
    },
    [clearImageStageInterval, token, updateStreamingMessageLoadingLabel],
  );

  const runExecutiveReportResponse = useCallback(
    async ({
      conversationId,
      question,
      linkedUserMessageId,
      assistantMessageId,
      history,
      imageAnalyses,
      resolveTitle,
    }: {
      conversationId: string;
      question: string;
      linkedUserMessageId: string;
      assistantMessageId: string;
      history: Array<{ role: "assistant" | "user"; text: string }>;
      imageAnalyses: ApiExecutiveReportImageContext[];
      resolveTitle?: (response: ApiExecutiveReportResponse) => string;
    }) => {
      if (!token) {
        const failedMessage = buildAssistantErrorMessage(
          "Session indisponible. Reconnectez-vous puis reessayez.",
          linkedUserMessageId,
          assistantMessageId,
          "executive_report",
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });
        return null;
      }

      setThinkingConversationId(conversationId);
      setIsGenerating(true);
      setSlowConversationId(null);

      const controller = new AbortController();
      const requestId = createUuid();
      const startedAt = Date.now();
      activeStreamRef.current = {
        mode: "executive_report",
        controller,
        requestId,
        conversationId,
        assistantMessageId,
        question,
        startedAt,
      };
      debugChatbot("[chatbot] question_sent", {
        requestId,
        mode: "executive_report",
        conversationId,
        question,
      });

      clearImageStageInterval();
      let stageIndex = 0;
      updateStreamingMessageLoadingLabel(
        conversationId,
        assistantMessageId,
        EXECUTIVE_REPORT_STAGES[stageIndex],
      );
      imageStageIntervalRef.current = window.setInterval(() => {
        if (activeStreamRef.current?.requestId !== requestId) {
          clearImageStageInterval();
          return;
        }

        stageIndex = Math.min(stageIndex + 1, EXECUTIVE_REPORT_STAGES.length - 1);
        updateStreamingMessageLoadingLabel(
          conversationId,
          assistantMessageId,
          EXECUTIVE_REPORT_STAGES[stageIndex],
        );
      }, 1300);

      const slowTimerId = window.setTimeout(() => {
        if (activeStreamRef.current?.requestId === requestId) {
          setSlowConversationId(conversationId);
        }
      }, 2600);

      try {
        debugChatbot("[chatbot] executive_report_request_payload", {
          requestId,
          endpoint: "/chat/executive-report",
          conversationId,
          historySize: history.length,
          multimodalCount: imageAnalyses.length,
        });
        const response = await chatApi.generateExecutiveReport(
          token,
          {
            conversation_id: conversationId,
            history,
            image_analyses: imageAnalyses,
          },
          controller.signal,
        );

        if (activeStreamRef.current?.requestId !== requestId) {
          return null;
        }

        const completedMessage = buildAssistantMessage(
          buildAssistantContentFromExecutiveApi(response),
          linkedUserMessageId,
          assistantMessageId,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              title: resolveTitle ? resolveTitle(response) : currentConversation.title,
              updatedAt: completedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? completedMessage : message,
              ),
            });
          });
          setSuggestions(
            dedupeStrings(
              [
                "Quels leviers d'economie dois-je lancer en premier ?",
                "Approfondis les risques prioritaires du rapport",
                "Donne un plan d'action DSI sur 30 jours",
                ...assistantQuestionSuggestions,
              ],
              6,
            ),
          );
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        debugChatbot("[chatbot] response_completed", {
          requestId,
          mode: "executive_report",
          conversationId,
          durationMs: Date.now() - startedAt,
        });
        return response;
      } catch (error) {
        if (
          isAbortLikeError(error) ||
          (error instanceof ApiError && error.code === "REQUEST_CANCELLED")
        ) {
          debugChatbot("[chatbot] request_cancelled_acknowledged", {
            requestId,
            mode: "executive_report",
            conversationId,
            durationMs: Date.now() - startedAt,
          });
          return null;
        }

        const failedMessage = buildAssistantErrorMessage(
          getChatErrorMessage(error),
          linkedUserMessageId,
          assistantMessageId,
          "executive_report",
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) =>
                message.id === assistantMessageId ? failedMessage : message,
              ),
            });
          });
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        return null;
      } finally {
        clearImageStageInterval();
        window.clearTimeout(slowTimerId);
        if (activeStreamRef.current?.requestId === requestId) {
          activeStreamRef.current = null;
          setIsGenerating(false);
          setThinkingConversationId(null);
          setSlowConversationId((currentConversationId) =>
            currentConversationId === conversationId ? null : currentConversationId,
          );
        }
      }
    },
    [clearImageStageInterval, token, updateStreamingMessageLoadingLabel],
  );

  const handleSendQuestion = async (
    question: string,
    attachmentOverride:
      | ComposerImageDraft
      | ComposerPdfDraft
      | TelecomChatAttachment
      | null = composerAttachment,
  ) => {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      return;
    }

    setCopilotActionPlan(null);
    const interruptedStream = activeStreamRef.current;
    const activeOrNewConversation = activeConversation
      ? applyInterruptedStreamToConversation(activeConversation, interruptedStream)
      : createTelecomConversation(buildWelcomeMessage(firstName));
    abortActiveStream();
    stopAssistantAudioPlayback();
    clearContinuousVoiceRestart();
    const serializedAttachment =
      attachmentOverride
        ? {
            kind: attachmentOverride.kind,
            name: attachmentOverride.name,
            mimeType: attachmentOverride.mimeType,
            previewUrl: attachmentOverride.previewUrl,
            sizeBytes: attachmentOverride.sizeBytes,
            ...(
              attachmentOverride.kind === "document"
              ? {
                  documentType: attachmentOverride.documentType,
                  pageCount:
                    "pageCount" in attachmentOverride
                      ? attachmentOverride.pageCount
                      : undefined,
                }
              : {}
            ),
          }
        : null;
    const now = new Date().toISOString();
    const userMessage: TelecomChatMessage = {
      id: `user-${createUuid()}`,
      role: "user",
      text: trimmedQuestion,
      createdAt: now,
      status: "complete",
      requestKind:
        serializedAttachment?.kind === "document"
          ? "document"
          : serializedAttachment
            ? "image"
            : "text",
      isEdited: false,
      editedAt: null,
      attachment: serializedAttachment,
      executiveReport: null,
    };
    const requestedImageAnalysisMode =
      attachmentOverride &&
      "analysisMode" in attachmentOverride &&
      typeof attachmentOverride.analysisMode === "string"
        ? normalizeImageAnalysisMode(attachmentOverride.analysisMode)
        : serializedAttachment?.kind === "document"
          ? "advanced"
          : "quick";
    const isGeoQuestionRequest = !serializedAttachment && isGeoQuestion(trimmedQuestion);
    const loadingStages = serializedAttachment
      ? buildDocumentAnalysisStages(
          serializedAttachment,
          trimmedQuestion,
          requestedImageAnalysisMode,
        )
      : isGeoQuestionRequest
        ? GEO_ANALYSIS_STAGES
      : null;
    const placeholderMessage = buildStreamingAssistantMessage(
      userMessage.id,
      undefined,
      loadingStages ? loadingStages[0] : null,
      serializedAttachment?.kind === "document"
        ? "document"
        : serializedAttachment
          ? "image"
          : "text",
    );
    const priorContextMessages = buildApiHistory(activeOrNewConversation.messages).slice(-8);
    const provisionalConversationTitle =
      activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
        ? deriveTelecomConversationTitle(trimmedQuestion)
        : activeOrNewConversation.title;
    const nextConversation: TelecomChatConversation = {
      ...activeOrNewConversation,
      title: provisionalConversationTitle,
      updatedAt: placeholderMessage.createdAt,
      messages: [...activeOrNewConversation.messages, userMessage, placeholderMessage],
    };

    scrollModeRef.current = "bottom";
    setInputValue("");
    handleRemoveComposerImage();
    handleRemoveComposerPdf();
    setErrorMessage(null);
    setShowAllSuggestions(false);
    setEditingMessageId(null);
    setEditingMessageValue("");
    setIsOpen(true);
    setIsMinimized(false);
    setIsHistoryPanelOpen(false);

    startTransition(() => {
      setConversations((currentConversations) =>
        upsertConversation(currentConversations, nextConversation),
      );
      setActiveConversationId(nextConversation.id);
      setVisibleMessageCount((currentCount) =>
        Math.max(currentCount, INITIAL_VISIBLE_MESSAGE_COUNT),
      );
    });

    if (serializedAttachment?.kind === "image") {
      await runImageAssistantResponse({
        conversationId: nextConversation.id,
        question: trimmedQuestion,
        linkedUserMessageId: userMessage.id,
        assistantMessageId: placeholderMessage.id,
        history: priorContextMessages,
        imageAttachment: serializedAttachment,
        analysisMode: requestedImageAnalysisMode,
        resolveTitle: (response) =>
          activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
            ? deriveTelecomConversationTitle(trimmedQuestion, response.title_hint)
            : activeOrNewConversation.title,
      });
      return;
    }

    if (serializedAttachment?.kind === "document") {
      await runPdfAssistantResponse({
        conversationId: nextConversation.id,
        question: trimmedQuestion,
        linkedUserMessageId: userMessage.id,
        assistantMessageId: placeholderMessage.id,
        history: priorContextMessages,
        pdfAttachment: serializedAttachment,
        analysisMode: requestedImageAnalysisMode,
        resolveTitle: (response) =>
          activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
            ? deriveTelecomConversationTitle(trimmedQuestion, response.title_hint)
            : activeOrNewConversation.title,
      });
      return;
    }

    if (isGeoQuestionRequest) {
      await runGeoAssistantResponse({
        conversationId: nextConversation.id,
        question: trimmedQuestion,
        linkedUserMessageId: userMessage.id,
        assistantMessageId: placeholderMessage.id,
        resolveTitle: (response) => {
          if (activeOrNewConversation.title !== DEFAULT_CONVERSATION_TITLE) {
            return activeOrNewConversation.title;
          }

          const topZoneLabel =
            response.critical_zones[0]?.city ||
            response.critical_zones[0]?.label ||
            response.stats.top_cost_countries[0]?.country ||
            response.country_insights[0]?.country ||
            null;

          return deriveTelecomConversationTitle(trimmedQuestion, topZoneLabel);
        },
      });
      return;
    }

    await runStreamedAssistantResponse({
      conversationId: nextConversation.id,
      question: trimmedQuestion,
      linkedUserMessageId: userMessage.id,
      assistantMessageId: placeholderMessage.id,
      history: priorContextMessages,
      resolveTitle: (response) =>
        activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
          ? deriveTelecomConversationTitle(trimmedQuestion, response.title_hint)
        : activeOrNewConversation.title,
    });
  };

  const handleGenerateExecutiveReport = useCallback(async () => {
    const reportPrompt =
      "Genere un rapport executif IA de la flotte telecom. Analyse les couts, alertes, anomalies, fraude, departements exposes, roaming, workflows et equipements avec justification des scores.";

    const interruptedStream = activeStreamRef.current;
    const activeOrNewConversation = activeConversation
      ? applyInterruptedStreamToConversation(activeConversation, interruptedStream)
      : createTelecomConversation(buildWelcomeMessage(firstName));
    const executiveAnalyses = collectExecutiveReportImageAnalyses(
      upsertConversation(conversations, activeOrNewConversation),
    );
    abortActiveStream();
    stopAssistantAudioPlayback();
    clearContinuousVoiceRestart();

    const now = new Date().toISOString();
    const userMessage: TelecomChatMessage = {
      id: `user-${createUuid()}`,
      role: "user",
      text: "Generer rapport executif IA de la flotte.",
      createdAt: now,
      status: "complete",
      requestKind: "executive_report",
      isEdited: false,
      editedAt: null,
      attachment: null,
      executiveReport: null,
    };
    const placeholderMessage = buildStreamingAssistantMessage(
      userMessage.id,
      undefined,
      EXECUTIVE_REPORT_STAGES[0],
      "executive_report",
    );
    const priorContextMessages = buildApiHistory(activeOrNewConversation.messages).slice(-8);
    const nextConversation: TelecomChatConversation = {
      ...activeOrNewConversation,
      title:
        activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
          ? "Rapport executif IA"
          : activeOrNewConversation.title,
      updatedAt: placeholderMessage.createdAt,
      messages: [...activeOrNewConversation.messages, userMessage, placeholderMessage],
    };

    scrollModeRef.current = "bottom";
    setErrorMessage(null);
    setShowAllSuggestions(false);
    setEditingMessageId(null);
    setEditingMessageValue("");
    setIsOpen(true);
    setIsMinimized(false);
    setIsHistoryPanelOpen(false);

    startTransition(() => {
      setConversations((currentConversations) =>
        upsertConversation(currentConversations, nextConversation),
      );
      setActiveConversationId(nextConversation.id);
      setVisibleMessageCount((currentCount) =>
        Math.max(currentCount, INITIAL_VISIBLE_MESSAGE_COUNT),
      );
    });

    await runExecutiveReportResponse({
      conversationId: nextConversation.id,
      question: reportPrompt,
      linkedUserMessageId: userMessage.id,
      assistantMessageId: placeholderMessage.id,
      history: priorContextMessages,
      imageAnalyses: executiveAnalyses,
      resolveTitle: () =>
        activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
          ? "Rapport executif IA"
          : activeOrNewConversation.title,
    });
  }, [
    abortActiveStream,
    activeConversation,
    clearContinuousVoiceRestart,
    conversations,
    firstName,
    runExecutiveReportResponse,
    stopAssistantAudioPlayback,
  ]);

  const playCachedAssistantAudio = useCallback(
    async (
      playback: CachedVoicePlayback,
      options: {
        messageId: string | null;
        text: string;
        restartListeningOnEnd?: boolean;
      },
    ) => {
      clearContinuousVoiceRestart();
      audioStopRequestedRef.current = true;

      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
        audioElementRef.current.onended = null;
        audioElementRef.current.onpause = null;
        audioElementRef.current.onplay = null;
      }

      const audio = new Audio(playback.audioUrl);
      audio.volume = isVoiceMuted ? 0 : voicePlaybackVolume;
      audio.playbackRate = voicePlaybackRate;
      audioStopRequestedRef.current = false;
      audioElementRef.current = audio;
      lastVoicePlaybackRef.current = {
        ...playback,
        text: options.text,
        messageId: options.messageId,
      };
      setAudioPlaybackState("loading");
      setAudioPlaybackMessageId(options.messageId);
      setAudioPlaybackDuration(playback.duration);

      audio.onplay = () => {
        setAudioPlaybackState("playing");
        if (options.restartListeningOnEnd) {
          setVoiceComposerState("speaking");
        }
      };
      audio.onpause = () => {
        if (!audioStopRequestedRef.current && !audio.ended) {
          setAudioPlaybackState("paused");
        }
      };
      audio.onended = () => {
        setAudioPlaybackState("idle");
        setAudioPlaybackMessageId(null);
        setAudioPlaybackDuration(null);
        audioElementRef.current = null;

        if (options.restartListeningOnEnd) {
          setVoiceComposerState("idle");
          if (continuousVoiceModeRef.current) {
            clearContinuousVoiceRestart();
            continuousVoiceRestartTimerRef.current = window.setTimeout(() => {
              continuousVoiceRestartTimerRef.current = null;
              if (continuousVoiceModeRef.current && !mediaRecorderRef.current && !activeStreamRef.current) {
                startVoiceRecordingRef.current?.();
              }
            }, 520);
          }
        }
      };

      try {
        await audio.play();
      } catch (error) {
        setErrorMessage(getVoiceErrorMessage(error));
        stopAssistantAudioPlayback();
      }
    },
    [
      clearContinuousVoiceRestart,
      isVoiceMuted,
      stopAssistantAudioPlayback,
      voicePlaybackRate,
      voicePlaybackVolume,
    ],
  );

  const handleTranscribeVoiceBlob = useCallback(
    async (voiceBlob: Blob, transcriptOverride?: string | null) => {
      if (!token) {
        setVoiceComposerState("idle");
        setErrorMessage("Session indisponible. Reconnectez-vous puis reessayez.");
        return;
      }

      if (voiceBlob.size === 0) {
        setVoiceComposerState("idle");
        setErrorMessage("Aucun son detecte.");
        return;
      }

      if (voiceBlob.size > MAX_VOICE_AUDIO_SIZE_BYTES) {
        setVoiceComposerState("idle");
        setErrorMessage("Fichier audio trop lourd.");
        return;
      }

      const interruptedStream = activeStreamRef.current;
      const activeOrNewConversation = activeConversation
        ? applyInterruptedStreamToConversation(activeConversation, interruptedStream)
        : createTelecomConversation(buildWelcomeMessage(firstName));
      abortActiveStream();
      stopAssistantAudioPlayback();
      clearContinuousVoiceRestart();

      const resolvedTranscriptOverride = normalizeVoiceTranscript(transcriptOverride);
      const audioFile = buildVoiceAudioFileFromBlob(voiceBlob);
      const now = new Date().toISOString();
      const userMessage: TelecomChatMessage = {
        id: `user-${createUuid()}`,
        role: "user",
        text: "Demande vocale...",
        createdAt: now,
        status: "complete",
        requestKind: "text",
        isEdited: false,
        editedAt: null,
        attachment: null,
        executiveReport: null,
      };
      const placeholderMessage = buildStreamingAssistantMessage(
        userMessage.id,
        undefined,
        "Transcription en cours...",
        "text",
      );
      const priorContextMessages = buildApiHistory(activeOrNewConversation.messages).slice(-8);
      const nextConversation: TelecomChatConversation = {
        ...activeOrNewConversation,
        title:
          activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
            ? "Conversation vocale"
            : activeOrNewConversation.title,
        updatedAt: placeholderMessage.createdAt,
        messages: [...activeOrNewConversation.messages, userMessage, placeholderMessage],
      };

      scrollModeRef.current = "bottom";
      setErrorMessage(null);
      setPendingVoiceDraft(null);
      clearVoiceCaptureSuccessFeedback();
      setVoiceCaptureFeedback("idle");
      setVoiceTranscriptPreview(null);
      setVoiceTranscriptConfidence(null);
      setVoiceComposerState("transcribing");
      setIsOpen(true);
      setIsMinimized(false);
      setIsHistoryPanelOpen(false);

      startTransition(() => {
        setConversations((currentConversations) =>
          upsertConversation(currentConversations, nextConversation),
        );
        setActiveConversationId(nextConversation.id);
        setVisibleMessageCount((currentCount) =>
          Math.max(currentCount, INITIAL_VISIBLE_MESSAGE_COUNT),
        );
      });

      setThinkingConversationId(nextConversation.id);
      setIsGenerating(true);
      setSlowConversationId(null);

      const controller = new AbortController();
      const requestId = createUuid();
      const startedAt = Date.now();
      activeStreamRef.current = {
        mode: "voice",
        controller,
        requestId,
        conversationId: nextConversation.id,
        assistantMessageId: placeholderMessage.id,
        question: "Message vocal",
        startedAt,
      };

      let streamedText = "";
      let finalResponse: ApiChatResponse | null = null;
      let voiceAudio: ApiVoiceStreamAudio | null = null;
      let resolvedTranscript = "";
      let animationFrameId: number | null = null;

      const slowTimerId = window.setTimeout(() => {
        if (activeStreamRef.current?.requestId === requestId) {
          setSlowConversationId(nextConversation.id);
        }
      }, 2600);

      const flushPartialMessage = () => {
        if (activeStreamRef.current?.requestId !== requestId) {
          return;
        }

        const nextText = streamedText;
        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === nextConversation.id,
            );
            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: new Date().toISOString(),
              messages: currentConversation.messages.map((message) =>
                message.id === placeholderMessage.id
                  ? {
                      ...message,
                      text: nextText,
                      status: "streaming",
                    }
                  : message,
              ),
            });
          });
        });
      };

      const schedulePartialFlush = () => {
        if (animationFrameId !== null) {
          return;
        }

        animationFrameId = window.requestAnimationFrame(() => {
          animationFrameId = null;
          flushPartialMessage();
        });
      };

      try {
        const streamedPayload = await chatApi.streamVoice(
          token,
          {
            audio: audioFile,
            transcript: resolvedTranscriptOverride || undefined,
            conversation_id: nextConversation.id,
            history: priorContextMessages,
          },
          {
            signal: controller.signal,
            onStage: (stage) => {
              if (activeStreamRef.current?.requestId !== requestId) {
                return;
              }

              if (stage.stage === "transcribing") {
                setVoiceComposerState("transcribing");
              } else if (stage.stage === "thinking") {
                setVoiceComposerState("thinking");
              } else if (stage.stage === "speaking") {
                setVoiceComposerState("speaking");
              }

              updateStreamingMessageLoadingLabel(
                nextConversation.id,
                placeholderMessage.id,
                stage.label,
              );
            },
            onTranscript: (transcription) => {
              if (activeStreamRef.current?.requestId !== requestId) {
                return;
              }

              resolvedTranscript = transcription.transcript;
              setVoiceTranscriptPreview(transcription.transcript);
              setVoiceTranscriptConfidence(transcription.confidence);
              setVoiceComposerState("thinking");

              startTransition(() => {
                setConversations((currentConversations) => {
                  const currentConversation = currentConversations.find(
                    (conversation) => conversation.id === nextConversation.id,
                  );
                  if (!currentConversation) {
                    return currentConversations;
                  }

                  return upsertConversation(currentConversations, {
                    ...currentConversation,
                    title:
                      activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
                        ? deriveTelecomConversationTitle(transcription.transcript)
                        : currentConversation.title,
                    updatedAt: new Date().toISOString(),
                    messages: currentConversation.messages.map((message) => {
                      if (message.id === userMessage.id) {
                        return {
                          ...message,
                          text: transcription.transcript,
                        };
                      }
                      if (message.id === placeholderMessage.id) {
                        return {
                          ...message,
                          loadingLabel: "Analyse IA...",
                        };
                      }
                      return message;
                    }),
                  });
                });
              });
            },
            onToken: (chunk) => {
              if (activeStreamRef.current?.requestId !== requestId) {
                return;
              }
              streamedText += chunk;
              schedulePartialFlush();
            },
            onDone: (response) => {
              if (activeStreamRef.current?.requestId === requestId) {
                finalResponse = response;
              }
            },
            onAudio: (audio) => {
              voiceAudio = audio;
            },
            onVoiceError: (error) => {
              setErrorMessage(error.message || "Lecture audio indisponible.");
            },
          },
        );

        if (activeStreamRef.current?.requestId !== requestId) {
          return;
        }

        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
        flushPartialMessage();

        const completedResponse = finalResponse ?? streamedPayload.response;
        const completedMessage = buildAssistantMessage(
          buildAssistantContentFromApi(completedResponse),
          userMessage.id,
          placeholderMessage.id,
        );

        if (voiceAudio) {
          audioCacheRef.current[completedMessage.id] = {
            audioUrl: voiceAudio.audio_url,
            duration: voiceAudio.duration,
            format: voiceAudio.format,
          };
        }

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === nextConversation.id,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              title:
                activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
                  ? deriveTelecomConversationTitle(
                      resolvedTranscript || completedResponse.title_hint || "Conversation vocale",
                      completedResponse.title_hint,
                    )
                  : currentConversation.title,
              updatedAt: completedMessage.createdAt,
              messages: currentConversation.messages.map((message) => {
                if (message.id === userMessage.id && resolvedTranscript) {
                  return {
                    ...message,
                    text: resolvedTranscript,
                  };
                }
                if (message.id === placeholderMessage.id) {
                  return completedMessage;
                }
                return message;
              }),
            });
          });
          setSuggestions(
            dedupeStrings([...contextualSuggestions, ...assistantQuestionSuggestions], 6),
          );
        });

        if (!isOpenRef.current || isMinimizedRef.current) {
          setUnreadCount((currentCount) => Math.min(currentCount + 1, 99));
        }

        if (voiceAudio) {
          await playCachedAssistantAudio(
            {
              audioUrl: voiceAudio.audio_url,
              duration: voiceAudio.duration,
              format: voiceAudio.format,
            },
            {
              messageId: completedMessage.id,
              text: buildVoiceNarrationText(completedMessage),
              restartListeningOnEnd: continuousVoiceModeRef.current,
            },
          );
        } else {
          setVoiceComposerState("idle");
        }

        debugChatbot("[chatbot] response_completed", {
          requestId,
          mode: "voice",
          conversationId: nextConversation.id,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }

        if (
          isAbortLikeError(error) ||
          (error instanceof ApiError && error.code === "REQUEST_CANCELLED")
        ) {
          debugChatbot("[chatbot] request_cancelled_acknowledged", {
            requestId,
            mode: "voice",
            conversationId: nextConversation.id,
            durationMs: Date.now() - startedAt,
          });
          setVoiceComposerState("idle");
          return;
        }

        const failedMessage = buildAssistantErrorMessage(
          getVoiceErrorMessage(error),
          userMessage.id,
          placeholderMessage.id,
        );

        startTransition(() => {
          setConversations((currentConversations) => {
            const currentConversation = currentConversations.find(
              (conversation) => conversation.id === nextConversation.id,
            );

            if (!currentConversation) {
              return currentConversations;
            }

            return upsertConversation(currentConversations, {
              ...currentConversation,
              updatedAt: failedMessage.createdAt,
              messages: currentConversation.messages.map((message) => {
                if (message.id === userMessage.id && resolvedTranscript) {
                  return {
                    ...message,
                    text: resolvedTranscript,
                  };
                }
                return message.id === placeholderMessage.id ? failedMessage : message;
              }),
            });
          });
        });

        setVoiceComposerState("idle");
        setErrorMessage(getVoiceErrorMessage(error));
      } finally {
        window.clearTimeout(slowTimerId);
        if (activeStreamRef.current?.requestId === requestId) {
          activeStreamRef.current = null;
          setIsGenerating(false);
          setThinkingConversationId(null);
          setSlowConversationId((currentConversationId) =>
            currentConversationId === nextConversation.id ? null : currentConversationId,
          );
        }
      }
    },
    [
      abortActiveStream,
      activeConversation,
      assistantQuestionSuggestions,
      clearContinuousVoiceRestart,
      contextualSuggestions,
      conversations,
      firstName,
      playCachedAssistantAudio,
      stopAssistantAudioPlayback,
      token,
      updateStreamingMessageLoadingLabel,
      clearVoiceCaptureSuccessFeedback,
    ],
  );

  const handleStartVoiceRecording = useCallback(async () => {
    const browserVoiceSupport = getBrowserVoiceSupport();
    if (!browserVoiceSupport.isSupported) {
      setVoiceComposerState("idle");
      setVoiceCaptureFeedback("error");
      setPendingVoiceDraft(null);
      setErrorMessage("Votre navigateur ne prend pas en charge l'enregistrement vocal.");
      return;
    }

    try {
      const permissionState = await resolveMicrophonePermission();
      if (permissionState === "denied") {
        setVoiceComposerState("idle");
        setVoiceCaptureFeedback("error");
        setPendingVoiceDraft(null);
        setErrorMessage("Acces au microphone refuse. Autorisez le micro puis reessayez.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setVoicePermissionState("granted");
      const mimeType = pickSupportedVoiceRecordingMimeType();
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      debugChatbot("[chatbot] voice_recording_started", {
        permissionState,
        mimeType: mediaRecorder.mimeType || mimeType || "audio/webm",
        speechRecognitionAvailable: browserVoiceSupport.hasSpeechRecognition,
      });

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      recordedVoiceChunksRef.current = [];
      speechRecognitionTranscriptRef.current = "";
      speechRecognitionErrorRef.current = null;
      clearVoiceCaptureSuccessFeedback();
      setVoiceCaptureFeedback("idle");
      setPendingVoiceDraft(null);
      setVoiceComposerState("listening");
      setVoiceTranscriptPreview(null);
      setVoiceTranscriptConfidence(null);
      setErrorMessage(null);
      await startVoiceVisualizer(stream);
      startBrowserSpeechRecognition();

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        debugChatbot("[chatbot] voice_chunk_captured", {
          size: event.data.size,
          type: event.data.type,
        });
        if (event.data.size > 0) {
          recordedVoiceChunksRef.current.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        const recordedChunks = recordedVoiceChunksRef.current.slice();
        recordedVoiceChunksRef.current = [];
        mediaRecorderRef.current = null;
        stopVoiceVisualizer();
        stopVoiceMediaTracks();
        const voiceBlob = new Blob(recordedChunks, {
          type: mediaRecorder.mimeType || mimeType || "audio/webm",
        });
        const browserTranscript = normalizeVoiceTranscript(speechRecognitionTranscriptRef.current);
        const recognitionErrorMessage = speechRecognitionErrorRef.current;
        speechRecognitionTranscriptRef.current = "";
        speechRecognitionErrorRef.current = null;
        stopBrowserSpeechRecognition();
        debugChatbot("[chatbot] voice_blob_ready", {
          size: voiceBlob.size,
          type: voiceBlob.type || "audio/webm",
          chunkCount: recordedChunks.length,
          browserTranscriptChars: browserTranscript.length,
          speechRecognitionError: recognitionErrorMessage,
        });

        if (voiceBlob.size === 0) {
          applyVoiceCaptureFailure(
            recognitionErrorMessage || "Aucun son detecte.",
            voiceBlob,
            browserTranscript,
          );
          return;
        }

        void transcribeVoiceBlobToComposer(voiceBlob, {
          source: "recording_stop",
          failureMessage: recognitionErrorMessage,
          fallbackTranscript: browserTranscript,
        });
      };
      mediaRecorder.onerror = (event) => {
        recordedVoiceChunksRef.current = [];
        mediaRecorderRef.current = null;
        stopBrowserSpeechRecognition();
        speechRecognitionTranscriptRef.current = "";
        speechRecognitionErrorRef.current = null;
        stopVoiceVisualizer();
        stopVoiceMediaTracks();
        debugChatbot("[chatbot] voice_recording_failed", {
          error: event.error?.name ?? "unknown",
        });
        applyVoiceCaptureFailure("Microphone inaccessible.");
      };

      mediaRecorder.start(250);
    } catch (error) {
      stopBrowserSpeechRecognition();
      speechRecognitionTranscriptRef.current = "";
      speechRecognitionErrorRef.current = null;
      stopVoiceVisualizer();
      stopVoiceMediaTracks();
      setVoiceComposerState("idle");
      setVoiceCaptureFeedback("error");
      setPendingVoiceDraft(null);
      debugChatbot("[chatbot] voice_recording_start_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      setErrorMessage(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Acces au microphone refuse. Autorisez le micro puis reessayez."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "Aucun microphone detecte sur cet appareil."
            : "Microphone inaccessible.",
      );
    }
  }, [
    applyVoiceCaptureFailure,
    clearVoiceCaptureSuccessFeedback,
    injectVoiceTranscriptIntoComposer,
    resolveMicrophonePermission,
    startBrowserSpeechRecognition,
    startVoiceVisualizer,
    stopBrowserSpeechRecognition,
    stopVoiceMediaTracks,
    stopVoiceVisualizer,
  ]);

  useEffect(() => {
    startVoiceRecordingRef.current = () => {
      void handleStartVoiceRecording();
    };

    return () => {
      startVoiceRecordingRef.current = null;
    };
  }, [handleStartVoiceRecording]);

  const handleConvertPendingVoiceDraft = useCallback(async () => {
    if (!token) {
      setErrorMessage("Session indisponible. Reconnectez-vous puis reessayez.");
      return;
    }

    if (!pendingVoiceDraft) {
      setErrorMessage("Aucun message vocal a convertir.");
      return;
    }

    await transcribeVoiceBlobToComposer(pendingVoiceDraft.blob, {
      source: "manual",
      failureMessage: pendingVoiceDraft.message,
      fallbackTranscript: pendingVoiceDraft.transcript,
    });
  }, [pendingVoiceDraft, token, transcribeVoiceBlobToComposer]);

  const handleSendPendingVoiceDraftWithoutTranscript = useCallback(async () => {
    if (!pendingVoiceDraft) {
      setErrorMessage("Aucun message vocal a envoyer.");
      return;
    }

    setPendingVoiceDraft(null);
    await handleTranscribeVoiceBlob(pendingVoiceDraft.blob, pendingVoiceDraft.transcript);
  }, [handleTranscribeVoiceBlob, pendingVoiceDraft]);

  const handleStopVoiceRecording = useCallback(() => {
    if (!mediaRecorderRef.current) {
      stopBrowserSpeechRecognition();
      speechRecognitionTranscriptRef.current = "";
      speechRecognitionErrorRef.current = null;
      stopVoiceVisualizer();
      stopVoiceMediaTracks();
      setVoiceComposerState("idle");
      return;
    }

    setVoiceComposerState("transcribing");
    stopBrowserSpeechRecognition("stop");
    try {
      mediaRecorderRef.current.requestData();
    } catch {
      // Ignore browsers that do not support manual chunk flush.
    }
    mediaRecorderRef.current.stop();
  }, [stopBrowserSpeechRecognition, stopVoiceMediaTracks, stopVoiceVisualizer]);

  const handleToggleVoiceRecording = useCallback(() => {
    if (isVoiceTranscribing || isVoiceFallbackConverting) {
      return;
    }
    if (isVoiceListening) {
      handleStopVoiceRecording();
      return;
    }
    if (isVoiceThinking) {
      abortActiveStream();
      setVoiceComposerState("idle");
    }
    if (isVoiceSpeaking) {
      stopAssistantAudioPlayback();
    }
    void handleStartVoiceRecording();
  }, [
    abortActiveStream,
    handleStartVoiceRecording,
    handleStopVoiceRecording,
    isVoiceListening,
    isVoiceSpeaking,
    isVoiceThinking,
    isVoiceFallbackConverting,
    isVoiceTranscribing,
    stopAssistantAudioPlayback,
  ]);

  const handleReplayLastAssistantAudio = useCallback(async () => {
    const lastPlayback = lastVoicePlaybackRef.current;
    if (!lastPlayback) {
      setErrorMessage("Lecture audio impossible.");
      return;
    }

    await playCachedAssistantAudio(lastPlayback, {
      messageId: lastPlayback.messageId,
      text: lastPlayback.text,
      restartListeningOnEnd: false,
    });
  }, [playCachedAssistantAudio]);

  const handleToggleAssistantAudio = useCallback(
    async (message: TelecomChatMessage) => {
      if (!token) {
        setErrorMessage("Session indisponible. Reconnectez-vous puis reessayez.");
        return;
      }

      if (audioPlaybackMessageId === message.id && audioElementRef.current) {
        if (audioPlaybackState === "playing") {
          audioElementRef.current.pause();
          return;
        }
        if (audioPlaybackState === "paused") {
          try {
            await audioElementRef.current.play();
            return;
          } catch (error) {
            setErrorMessage(getVoiceErrorMessage(error));
            stopAssistantAudioPlayback();
            return;
          }
        }
      }

      stopAssistantAudioPlayback();
      const narrationText = buildVoiceNarrationText(message);
      let playback = audioCacheRef.current[message.id];

      if (!playback) {
        abortVoiceSpeakRequest();
        const controller = new AbortController();
        voiceSpeakControllerRef.current = controller;
        setAudioPlaybackState("loading");
        setAudioPlaybackMessageId(message.id);
        setAudioPlaybackDuration(null);

        try {
          const response: ApiVoiceSpeakResponse = await chatApi.speakVoice(
            token,
            narrationText,
            controller.signal,
          );
          if (voiceSpeakControllerRef.current !== controller) {
            return;
          }

          playback = {
            audioUrl: response.audio_url,
            duration: response.duration,
            format: response.format,
          };
          audioCacheRef.current[message.id] = playback;
        } catch (error) {
          if (isAbortLikeError(error)) {
            return;
          }
          setErrorMessage(getVoiceErrorMessage(error));
          stopAssistantAudioPlayback();
          return;
        } finally {
          if (voiceSpeakControllerRef.current === controller) {
            voiceSpeakControllerRef.current = null;
          }
        }
      }

      await playCachedAssistantAudio(playback, {
        messageId: message.id,
        text: narrationText,
        restartListeningOnEnd: false,
      });
    },
    [
      abortVoiceSpeakRequest,
      audioPlaybackMessageId,
      audioPlaybackState,
      playCachedAssistantAudio,
      stopAssistantAudioPlayback,
      token,
    ],
  );

  const handleToggleCurrentAudioPlayback = useCallback(async () => {
    if (!audioElementRef.current) {
      await handleReplayLastAssistantAudio();
      return;
    }

    if (audioPlaybackState === "playing") {
      audioElementRef.current.pause();
      return;
    }

    if (audioPlaybackState === "paused") {
      try {
        await audioElementRef.current.play();
      } catch (error) {
        setErrorMessage(getVoiceErrorMessage(error));
        stopAssistantAudioPlayback();
      }
      return;
    }

    await handleReplayLastAssistantAudio();
  }, [
    audioPlaybackState,
    handleReplayLastAssistantAudio,
    stopAssistantAudioPlayback,
  ]);

  const handleRegenerateMessage = async (messageId: string) => {
    if (!activeConversation) {
      return;
    }

    const workingConversation = applyInterruptedStreamToConversation(
      activeConversation,
      activeStreamRef.current,
    );
    abortActiveStream();

    const targetMessage = workingConversation.messages.find(
      (message) => message.id === messageId && message.role === "assistant",
    );
    const linkedUserMessage = workingConversation.messages.find(
      (message) => message.id === targetMessage?.linkedUserMessageId,
    );

    if (!targetMessage || !linkedUserMessage) {
      return;
    }

    const linkedUserIndex = workingConversation.messages.findIndex(
      (message) => message.id === linkedUserMessage.id,
    );
    const contextMessages = buildApiHistory(
      workingConversation.messages.slice(0, linkedUserIndex),
    ).slice(-8);
    const isExecutiveRequest =
      linkedUserMessage.requestKind === "executive_report" || Boolean(targetMessage.executiveReport);
    const isDocumentRequest = linkedUserMessage.attachment?.kind === "document";
    const requestedAnalysisMode = normalizeImageAnalysisMode(
      targetMessage.imageAnalysis?.analysisMode,
    );
    const imageAnalysisStages = linkedUserMessage.attachment
      ? buildDocumentAnalysisStages(
          linkedUserMessage.attachment,
          linkedUserMessage.text,
          requestedAnalysisMode,
        )
      : null;
    const placeholderMessage = buildStreamingAssistantMessage(
      linkedUserMessage.id,
      targetMessage.id,
      isExecutiveRequest
        ? EXECUTIVE_REPORT_STAGES[0]
        : imageAnalysisStages
          ? imageAnalysisStages[0]
          : null,
      isExecutiveRequest
        ? "executive_report"
        : isDocumentRequest
          ? "document"
          : linkedUserMessage.attachment
            ? "image"
            : "text",
    );
    const nextConversation = replaceConversationMessages(
      workingConversation,
      [...workingConversation.messages.slice(0, linkedUserIndex + 1), placeholderMessage],
      placeholderMessage.createdAt,
    );

    setRegeneratingMessageId(messageId);
    scrollModeRef.current = "bottom";
    setEditingMessageId(null);
    setEditingMessageValue("");

    try {
      startTransition(() => {
        setConversations((currentConversations) =>
          upsertConversation(currentConversations, nextConversation),
        );
      });

      if (linkedUserMessage.attachment?.kind === "document") {
        await runPdfAssistantResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
          pdfAttachment: linkedUserMessage.attachment,
          analysisMode: requestedAnalysisMode,
        });
      } else if (linkedUserMessage.attachment?.kind === "image") {
        await runImageAssistantResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
          imageAttachment: linkedUserMessage.attachment,
          analysisMode: requestedAnalysisMode,
        });
      } else if (isExecutiveRequest) {
        await runExecutiveReportResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
          imageAnalyses: collectExecutiveReportImageAnalyses(
            upsertConversation(conversations, workingConversation),
          ),
        });
      } else {
        await runStreamedAssistantResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
        });
      }
    } finally {
      setRegeneratingMessageId(null);
    }
  };

  const handleRunAdvancedImageAnalysis = async (messageId: string) => {
    if (!activeConversation) {
      return;
    }

    const workingConversation = applyInterruptedStreamToConversation(
      activeConversation,
      activeStreamRef.current,
    );
    abortActiveStream();

    const targetMessage = workingConversation.messages.find(
      (message) => message.id === messageId && message.role === "assistant" && Boolean(message.imageAnalysis),
    );
    const linkedUserMessage = workingConversation.messages.find(
      (message) => message.id === targetMessage?.linkedUserMessageId,
    );

    if (!targetMessage || !linkedUserMessage?.attachment) {
      return;
    }

    const linkedUserIndex = workingConversation.messages.findIndex(
      (message) => message.id === linkedUserMessage.id,
    );
    const contextMessages = buildApiHistory(
      workingConversation.messages.slice(0, linkedUserIndex),
    ).slice(-8);
    const imageAnalysisStages = buildDocumentAnalysisStages(
      linkedUserMessage.attachment,
      linkedUserMessage.text,
      "advanced",
    );
    const placeholderMessage = buildStreamingAssistantMessage(
      linkedUserMessage.id,
      targetMessage.id,
      imageAnalysisStages[0],
      linkedUserMessage.attachment.kind === "document" ? "document" : "image",
    );
    const nextConversation = replaceConversationMessages(
      workingConversation,
      [...workingConversation.messages.slice(0, linkedUserIndex + 1), placeholderMessage],
      placeholderMessage.createdAt,
    );

    setRegeneratingMessageId(messageId);
    scrollModeRef.current = "bottom";
    setEditingMessageId(null);
    setEditingMessageValue("");

    try {
      startTransition(() => {
        setConversations((currentConversations) =>
          upsertConversation(currentConversations, nextConversation),
        );
      });

      if (linkedUserMessage.attachment.kind === "document") {
        await runPdfAssistantResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
          pdfAttachment: linkedUserMessage.attachment,
          analysisMode: "advanced",
        });
      } else {
        await runImageAssistantResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
          imageAttachment: linkedUserMessage.attachment,
          analysisMode: "advanced",
        });
      }
    } finally {
      setRegeneratingMessageId(null);
    }
  };

  const handleRunQuickImageAnalysis = async (messageId: string) => {
    if (!activeConversation) {
      return;
    }

    const workingConversation = applyInterruptedStreamToConversation(
      activeConversation,
      activeStreamRef.current,
    );
    abortActiveStream();

    const targetMessage = workingConversation.messages.find(
      (message) => message.id === messageId && message.role === "assistant",
    );
    const linkedUserMessage = workingConversation.messages.find(
      (message) => message.id === targetMessage?.linkedUserMessageId,
    );

    if (!targetMessage || !linkedUserMessage?.attachment) {
      return;
    }

    const linkedUserIndex = workingConversation.messages.findIndex(
      (message) => message.id === linkedUserMessage.id,
    );
    const contextMessages = buildApiHistory(
      workingConversation.messages.slice(0, linkedUserIndex),
    ).slice(-8);
    const imageAnalysisStages = buildDocumentAnalysisStages(
      linkedUserMessage.attachment,
      linkedUserMessage.text,
      "quick",
    );
    const placeholderMessage = buildStreamingAssistantMessage(
      linkedUserMessage.id,
      targetMessage.id,
      imageAnalysisStages[0],
      linkedUserMessage.attachment.kind === "document" ? "document" : "image",
    );
    const nextConversation = replaceConversationMessages(
      workingConversation,
      [...workingConversation.messages.slice(0, linkedUserIndex + 1), placeholderMessage],
      placeholderMessage.createdAt,
    );

    setRegeneratingMessageId(messageId);
    scrollModeRef.current = "bottom";
    setEditingMessageId(null);
    setEditingMessageValue("");

    try {
      startTransition(() => {
        setConversations((currentConversations) =>
          upsertConversation(currentConversations, nextConversation),
        );
      });

      if (linkedUserMessage.attachment.kind === "document") {
        await runPdfAssistantResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
          pdfAttachment: linkedUserMessage.attachment,
          analysisMode: "quick",
        });
      } else {
        await runImageAssistantResponse({
          conversationId: workingConversation.id,
          question: linkedUserMessage.text,
          linkedUserMessageId: linkedUserMessage.id,
          assistantMessageId: placeholderMessage.id,
          history: contextMessages,
          imageAttachment: linkedUserMessage.attachment,
          analysisMode: "quick",
        });
      }
    } finally {
      setRegeneratingMessageId(null);
    }
  };

  const handleStartEditingMessage = (message: TelecomChatMessage) => {
    setEditingMessageId(message.id);
    setEditingMessageValue(message.text);
    scrollModeRef.current = "none";
  };

  const handleCancelEditingMessage = () => {
    setEditingMessageId(null);
    setEditingMessageValue("");
  };

  const handleConfirmEditingMessage = async () => {
    if (!activeConversation || !editingMessageId) {
      return;
    }

    const nextText = editingMessageValue.trim();
    if (!nextText) {
      return;
    }

    const workingConversation = applyInterruptedStreamToConversation(
      activeConversation,
      activeStreamRef.current,
    );
    abortActiveStream();

    const messageIndex = getConversationMessageIndex(workingConversation, editingMessageId);
    const targetMessage = workingConversation.messages[messageIndex];

    if (messageIndex < 0 || !targetMessage || targetMessage.role !== "user") {
      return;
    }

    const editedAt = new Date().toISOString();
    const updatedUserMessage: TelecomChatMessage = {
      ...targetMessage,
      text: nextText,
      status: "complete",
      isEdited: true,
      editedAt,
    };
    const shouldRefreshTitle =
      workingConversation.messages.find((message) => message.role === "user")?.id === targetMessage.id;
    const isExecutiveRequest = targetMessage.requestKind === "executive_report";
    const isDocumentRequest = updatedUserMessage.attachment?.kind === "document";
    const requestedAnalysisMode = normalizeImageAnalysisMode(
      targetMessage.imageAnalysis?.analysisMode,
    );
    const imageAnalysisStages = updatedUserMessage.attachment
      ? buildDocumentAnalysisStages(updatedUserMessage.attachment, nextText, requestedAnalysisMode)
      : null;
    const placeholderMessage = buildStreamingAssistantMessage(
      updatedUserMessage.id,
      `assistant-${updatedUserMessage.id}`,
      isExecutiveRequest
        ? EXECUTIVE_REPORT_STAGES[0]
        : imageAnalysisStages
          ? imageAnalysisStages[0]
          : null,
      isExecutiveRequest
        ? "executive_report"
        : isDocumentRequest
          ? "document"
          : updatedUserMessage.attachment
            ? "image"
            : "text",
    );
    const priorContextMessages = buildApiHistory(
      workingConversation.messages.slice(0, messageIndex),
    ).slice(-8);
    const nextConversation = replaceConversationMessages(
      workingConversation,
      [
        ...workingConversation.messages.slice(0, messageIndex),
        updatedUserMessage,
        placeholderMessage,
      ],
      placeholderMessage.createdAt,
      shouldRefreshTitle
        ? deriveTelecomConversationTitle(nextText)
        : workingConversation.title,
    );

    setEditingMessageId(null);
    setEditingMessageValue("");
    scrollModeRef.current = "bottom";

    startTransition(() => {
      setConversations((currentConversations) =>
        upsertConversation(currentConversations, nextConversation),
      );
      setActiveConversationId(workingConversation.id);
    });

    if (updatedUserMessage.attachment?.kind === "document") {
      await runPdfAssistantResponse({
        conversationId: workingConversation.id,
        question: nextText,
        linkedUserMessageId: updatedUserMessage.id,
        assistantMessageId: placeholderMessage.id,
        history: priorContextMessages,
        pdfAttachment: updatedUserMessage.attachment,
        analysisMode: requestedAnalysisMode,
        resolveTitle: (response) =>
          shouldRefreshTitle
            ? deriveTelecomConversationTitle(nextText, response.title_hint)
            : workingConversation.title,
      });
      return;
    }

    if (updatedUserMessage.attachment?.kind === "image") {
      await runImageAssistantResponse({
        conversationId: workingConversation.id,
        question: nextText,
        linkedUserMessageId: updatedUserMessage.id,
        assistantMessageId: placeholderMessage.id,
        history: priorContextMessages,
        imageAttachment: updatedUserMessage.attachment,
        analysisMode: requestedAnalysisMode,
        resolveTitle: (response) =>
          shouldRefreshTitle
          ? deriveTelecomConversationTitle(nextText, response.title_hint)
          : workingConversation.title,
      });
      return;
    }

    if (isExecutiveRequest) {
      await runExecutiveReportResponse({
        conversationId: workingConversation.id,
        question: nextText,
        linkedUserMessageId: updatedUserMessage.id,
        assistantMessageId: placeholderMessage.id,
        history: priorContextMessages,
        imageAnalyses: collectExecutiveReportImageAnalyses(
          upsertConversation(conversations, workingConversation),
        ),
        resolveTitle: () =>
          shouldRefreshTitle ? "Rapport executif IA" : workingConversation.title,
      });
      return;
    }

    await runStreamedAssistantResponse({
      conversationId: workingConversation.id,
      question: nextText,
      linkedUserMessageId: updatedUserMessage.id,
      assistantMessageId: placeholderMessage.id,
      history: priorContextMessages,
      resolveTitle: (response) =>
        shouldRefreshTitle
          ? deriveTelecomConversationTitle(nextText, response.title_hint)
          : workingConversation.title,
    });
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (
      suggestion === "Plan d'action IA hebdomadaire" ||
      suggestion === "Que faire cette semaine ?"
    ) {
      void handleGenerateCopilotActionPlan();
      return;
    }

    if (
      suggestion === "Generer rapport IA complet" ||
      suggestion === "Genere un rapport IA complet"
    ) {
      setSelectedAiReportType("complete");
      void handleGenerateAiReport("complete");
      return;
    }

    if (!isPanelVisible) {
      handleOpenChat();
    }

    void handleSendQuestion(suggestion);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isVoiceListening || isVoiceTranscribing) {
      return;
    }
    void handleSendQuestion(inputValue);
  };

  const handleSendButtonPointerDown = (event: MouseEvent<HTMLButtonElement>) => {
    const buttonRect = event.currentTarget.getBoundingClientRect();
    setSendRipple({
      id: Date.now(),
      x: event.clientX - buttonRect.left,
      y: event.clientY - buttonRect.top,
    });
  };

  const handleStopGeneration = () => {
    abortActiveStream();
  };

  const handleExportExecutiveReport = (messageId: string) => {
    const targetMessage =
      activeConversation?.messages.find((message) => message.id === messageId) ??
      conversations.flatMap((conversation) => conversation.messages).find((message) => message.id === messageId);

    if (!targetMessage?.executiveReport) {
      toast.error("Rapport executif introuvable.");
      return;
    }

    try {
      exportExecutiveReportPdf(
        targetMessage.executiveReport,
        collectExecutiveReportExportImages(conversations),
        activeConversation?.title || "Rapport executif IA",
      );
      toast.success("Export PDF executif lance.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export PDF impossible.");
    }
  };

  const handleApplyDecisionRecommendation = (
    recommendationTitle: string,
    attachment: TelecomChatImageAttachment | null,
  ) => {
    void handleSendQuestion(
      `Approfondis cette recommandation: ${recommendationTitle}. Donne la priorite, l'impact financier potentiel et les actions concretes a lancer.`,
      attachment,
    );
  };

  const handleViewCopilotActionDetails = (action: ApiChatActionPlanItem) => {
    void handleSendQuestion(
      `Detaille cette action du plan d'action IA: ${action.title}. Explique la priorite, les donnees utilisees, le risque, l'impact estime et les etapes de mise en oeuvre.`,
    );
  };

  const handleApplyCopilotActionRecommendation = (action: ApiChatActionPlanItem) => {
    void handleSendQuestion(
      `Prepare l'execution de cette action du plan d'action IA: ${action.title}. Donne la check-list, les equipes concernees, les controles et les resultats attendus.`,
    );
  };

  const handleComposerChange = (nextValue: string) => {
    setInputValue(nextValue);
    if (voiceTranscriptPreview) {
      setVoiceTranscriptPreview(null);
      setVoiceTranscriptConfidence(null);
    }
    if (pendingVoiceDraft) {
      setPendingVoiceDraft(null);
      setErrorMessage(null);
    }
    if (voiceCaptureFeedback !== "idle") {
      clearVoiceCaptureSuccessFeedback();
    }
  };

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragOverComposer) {
      setIsDragOverComposer(true);
    }
  };

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragOverComposer(false);
    }
  };

  const handleComposerDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOverComposer(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) {
      return;
    }
    if (
      SUPPORTED_COMPOSER_DOCUMENT_TYPES.has(droppedFile.type.toLowerCase()) ||
      SUPPORTED_COMPOSER_DOCUMENT_EXTENSIONS.has(getFileExtension(droppedFile.name))
    ) {
      await handleAttachPdf(droppedFile, "drop");
      return;
    }
    await handleAttachImage(droppedFile, "upload");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (!inputValue.trim()) {
      return;
    }

    void handleSendQuestion(inputValue);
  };

  const audioDurationLabel = formatVoiceDurationLabel(audioPlaybackDuration);

  const assistantWorkspaceCards = (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[24px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(244,247,255,0.98),rgba(238,242,255,0.98))] px-4 py-4 shadow-[0_20px_40px_-30px_rgba(79,70,229,0.42)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
              <Radio className="h-3.5 w-3.5" />
              <span>Saisie vocale IA</span>
            </div>
            <p className="mt-2 text-base font-semibold text-[var(--bc-neutral-strong)]">
              {voiceStatusTitle}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
              {voiceTranscriptPreview ? voiceTranscriptPreview : voiceComposerHelperText}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--bc-neutral-body)]">
              <span className="rounded-full border border-[var(--bc-ai-border)] bg-white/82 px-2.5 py-1">
                {isContinuousVoiceMode ? "Mode continu" : "Mode ponctuel"}
              </span>
              <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/82 px-2.5 py-1">
                {isVoiceWorkflowActive ? "Ecoute active" : "Pret a dicter"}
              </span>
              <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/82 px-2.5 py-1">
                {voicePermissionState === "granted"
                  ? "Micro autorise"
                  : voicePermissionState === "denied"
                    ? "Micro bloque"
                    : "Permission a verifier"}
              </span>
              {voiceTranscriptConfidence !== null ? (
                <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/82 px-2.5 py-1">
                  Qualite audio {formatConfidenceLabel(voiceTranscriptConfidence) ?? "n/a"}
                </span>
              ) : null}
              {audioDurationLabel ? (
                <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/82 px-2.5 py-1">
                  Duree {audioDurationLabel}
                </span>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleVoiceRecording}
            disabled={isVoiceTranscribing || isVoiceFallbackConverting}
            className={cn(
              "inline-flex h-14 min-w-[148px] items-center justify-center gap-2 rounded-[18px] border px-4 text-sm font-semibold shadow-[0_18px_34px_-24px_rgba(79,70,229,0.42)] transition-all",
              isVoiceListening
                ? "border-[rgba(129,140,248,0.4)] bg-[linear-gradient(135deg,#7C3AED,#2563EB)] text-white shadow-[0_0_0_6px_rgba(129,140,248,0.16)] animate-pulse"
                : voiceCaptureFeedback === "success"
                  ? "border-[rgba(56,189,248,0.38)] bg-[linear-gradient(135deg,#4F46E5,#0EA5E9)] text-white"
                  : "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))] text-white hover:-translate-y-0.5",
              isVoiceTranscribing || isVoiceFallbackConverting ? "cursor-not-allowed opacity-70" : "",
            )}
            aria-label={isVoiceListening ? "Arreter l'ecoute vocale" : "Activer le micro vocal"}
            title={isVoiceListening ? "Arreter l'ecoute" : "Activer le micro"}
          >
            {isVoiceTranscribing || isVoiceThinking || isVoiceFallbackConverting ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : isVoiceListening ? (
              <Square className="h-4 w-4" />
            ) : voiceCaptureFeedback === "success" ? (
              <Check className="h-5 w-5" />
            ) : isVoiceSpeaking ? (
              <Volume2 className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            <span>
              {isVoiceListening
                ? "Arreter l'ecoute"
                : isVoiceTranscribing || isVoiceFallbackConverting
                  ? "Analyse..."
                  : voiceCaptureFeedback === "success"
                    ? "Texte ajoute"
                    : "Dicter ma question"}
            </span>
          </button>
        </div>

        <div className="mt-4 flex h-11 items-end gap-1 rounded-[18px] border border-[var(--bc-neutral-border)] bg-white/82 px-3 py-2">
          {voiceVisualizerLevels.map((level, index) => (
            <span
              key={`voice-bar-${index}`}
              className={cn(
                "flex-1 rounded-full bg-[linear-gradient(180deg,rgba(129,140,248,0.96),rgba(59,130,246,0.5))] transition-all duration-150",
                isVoiceWorkflowActive ? "opacity-100" : "opacity-72",
              )}
              style={{
                height: `${Math.max(10, Math.round(level * 34))}px`,
              }}
            />
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setIsContinuousVoiceMode((currentValue) => !currentValue)}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors",
              isContinuousVoiceMode
                ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-start)]"
                : "border-[var(--bc-neutral-border)] bg-white/84 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)]",
            )}
          >
            {isContinuousVoiceMode ? <Check className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
            <span>{isContinuousVoiceMode ? "Continu actif" : "Activer continu"}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleToggleCurrentAudioPlayback()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/84 px-3 py-2 text-xs font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)]"
          >
            {audioPlaybackState === "playing" ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span>
              {audioPlaybackState === "playing"
                ? "Pause lecture"
                : audioPlaybackState === "paused"
                  ? "Reprendre"
                  : "Lire la reponse"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void handleReplayLastAssistantAudio()}
            disabled={!lastVoicePlaybackRef.current}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/84 px-3 py-2 text-xs font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Repeat className="h-3.5 w-3.5" />
            <span>Replay</span>
          </button>
          <button
            type="button"
            onClick={stopAssistantAudioPlayback}
            disabled={audioPlaybackState === "idle"}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/84 px-3 py-2 text-xs font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Square className="h-3.5 w-3.5" />
            <span>Stop audio</span>
          </button>
        </div>

        <div className="mt-3 rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--bc-neutral-strong)]">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--bc-ai-start)]" />
              <span>Reglages audio</span>
            </div>
            <button
              type="button"
              onClick={() => setIsVoiceMuted((currentValue) => !currentValue)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--bc-neutral-border)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)]"
            >
              {isVoiceMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              <span>{isVoiceMuted ? "Activer son" : "Muet"}</span>
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_132px]">
            <label className="flex items-center gap-3 text-[11px] text-[var(--bc-neutral-body)]">
              <span className="w-14 shrink-0 uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                Volume
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(voicePlaybackVolume * 100)}
                onChange={(event) =>
                  setVoicePlaybackVolume(Math.min(1, Math.max(0, Number(event.target.value) / 100)))
                }
                className="h-2 flex-1 accent-[var(--bc-ai-start)]"
              />
              <span className="w-10 text-right">{Math.round(voicePlaybackVolume * 100)}%</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-[var(--bc-neutral-body)]">
              <span className="shrink-0 uppercase tracking-[0.14em] text-[var(--bc-neutral-muted)]">
                Vitesse
              </span>
              <select
                value={String(voicePlaybackRate)}
                onChange={(event) => setVoicePlaybackRate(Number(event.target.value))}
                className="h-9 min-w-0 flex-1 rounded-xl border border-[var(--bc-neutral-border)] bg-white px-3 text-sm text-[var(--bc-neutral-strong)] outline-none transition-colors focus:border-[var(--bc-ai-border)]"
              >
                <option value="0.9">0.9x</option>
                <option value="1">1.0x</option>
                <option value="1.15">1.15x</option>
                <option value="1.3">1.3x</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <AiReportGenerationCard
        selectedReportType={selectedAiReportType}
        onSelectReportType={setSelectedAiReportType}
        onGenerate={() => void handleGenerateAiReport()}
        onPreview={() => void handlePreviewAiReport()}
        onDownload={() => void handleDownloadAiReport()}
        onShare={() => void handleShareAiReport()}
        onExport={() => void handleDownloadAiReport()}
        isGenerating={isGeneratingAiReport}
        loadingLabel={aiReportLoadingLabel}
        latestReport={aiReport}
        error={aiReportError}
        multimodalCount={executiveAnalysisCount}
        exportImageCount={executiveExportImageCount}
        hasExecutiveContext={Boolean(latestExecutiveReport)}
        hasExplainabilityContext={Boolean(latestExplainability)}
      />

      <div className="rounded-[22px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(56,189,248,0.04),rgba(255,255,255,0.98))] px-4 py-4 shadow-[0_18px_36px_-28px_rgba(79,70,229,0.32)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
              <FileText className="h-3.5 w-3.5" />
              <span>Mode Directeur / DSI</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-strong)]">
              Generez un rapport executif IA avec scoring flotte, risques prioritaires, economies estimees et recommandations.
            </p>
            <p className="mt-1 text-[11px] text-[var(--bc-neutral-muted)]">
              {executiveAnalysisCount > 0
                ? `${executiveAnalysisCount} analyse(s) multimodale(s) precedente(s) seront reutilisee(s).`
                : "Le rapport utilisera les donnees telecom disponibles, meme sans analyse image prealable."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateExecutiveReport()}
            disabled={isBusy || isVoiceListening || isVoiceTranscribing || isVoiceThinking}
            className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_28px_-20px_rgba(79,70,229,0.55)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            <span>Generer rapport executif IA</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {!isPanelVisible ? (
        <div className="pointer-events-none fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[70] flex items-end justify-end sm:right-5 sm:bottom-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <button
            type="button"
            onClick={handleOpenChat}
            className={cn(
              "pointer-events-auto relative inline-flex items-center gap-2.5 rounded-full border border-[var(--bc-ai-border)] px-3.5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(99,102,241,0.24)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_42px_rgba(99,102,241,0.3)]",
              "bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))]",
            )}
            aria-label="Ouvrir l'assistant IA"
          >
            {launcherBadgeCount ? (
              <span className="absolute -top-2 -right-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full border border-white/60 bg-[#F43F5E] px-1 text-[10px] font-bold text-white shadow-sm">
                {launcherBadgeCount}
              </span>
            ) : null}
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/14">
              <MessageSquareText className="h-4 w-4" />
            </span>
            <span>{isMinimized ? "Reprendre" : "Assistant IA"}</span>
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          "fixed z-[140] transform-gpu transition-all duration-300 ease-out",
          isFullscreen
            ? "inset-0 h-[100dvh] w-screen"
            : "inset-x-0 bottom-0 h-[100dvh] sm:inset-x-auto sm:right-4 sm:bottom-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[82vh] sm:max-h-[82vh] sm:w-[460px] xl:w-[500px]",
          isPanelVisible
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-6 opacity-0 sm:translate-y-4",
        )}
      >
        {isFullscreen ? (
          <div className="absolute inset-0 bg-[rgba(2,8,23,0.42)] backdrop-blur-md" aria-hidden="true" />
        ) : null}
        <section
          className={cn(
            "bc-chatbot-shell relative z-[1] flex h-full min-h-0 overflow-hidden border border-[rgba(196,181,253,0.5)] bg-[var(--bg-card)]/92 shadow-[0_32px_84px_-34px_rgba(79,70,229,0.4)] backdrop-blur-2xl",
            isFullscreen
              ? "h-[100dvh] w-screen rounded-none border-0 shadow-[0_24px_80px_rgba(2,8,23,0.24)]"
              : "rounded-none sm:rounded-[30px]",
          )}
        >
          <aside
            className={cn(
              "bc-chatbot-history-panel absolute inset-y-0 left-0 z-20 flex w-[88vw] max-w-[320px] min-h-0 flex-col border-r border-[var(--bc-neutral-border)] shadow-[0_16px_36px_rgba(15,23,42,0.12)] transition-transform duration-300 sm:w-[280px]",
              isHistoryPanelOpen ? "translate-x-0" : "-translate-x-[104%]",
            )}
          >
            <div className="border-b border-[var(--bc-neutral-border)] px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--bc-ai-start)]">
                    Historique
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--bc-neutral-body)]">
                    Discussions sauvegardees et reprise rapide du contexte.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsHistoryPanelOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                  aria-label="Fermer l'historique"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleCreateConversation}
                disabled={isBusy}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--bc-primary)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_-16px_rgba(37,99,235,0.5)] transition-all hover:-translate-y-0.5 hover:bg-[var(--bc-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                <span>Nouvelle discussion</span>
              </button>

              {conversations.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleSelectAllConversations}
                    className="inline-flex items-center rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                  >
                    {allConversationsSelected ? "Tout deselectionner" : "Tout selectionner"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteConversations(selectedConversationIds)}
                    disabled={selectedConversationCount === 0 || isBusy}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-danger)] transition-colors hover:bg-[rgba(239,68,68,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Supprimer la selection</span>
                  </button>
                </div>
              ) : null}
            </div>

            <div className="bc-chatbot-scroll flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-3 py-3">
              <div className="space-y-2.5">
                {visibleConversations.map((conversation) => {
                  const isActive = conversation.id === activeConversation?.id;
                  const isSelected = selectedConversationIds.includes(conversation.id);
                  const isRenaming = renamingConversationId === conversation.id;
                  const displayTitle = normalizeConversationTitle(
                    conversation.title,
                    DEFAULT_CONVERSATION_TITLE,
                  );

                  return (
                    <div
                      key={conversation.id}
                      className={cn(
                        "rounded-[20px] border px-3.5 py-3 transition-all",
                        isActive
                          ? "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] shadow-[0_14px_28px_-24px_rgba(37,99,235,0.42)]"
                          : "border-[var(--bc-neutral-border)] bg-white/80 hover:border-[var(--bc-primary-border)] hover:bg-[var(--bc-primary-soft)] dark:bg-[#08101f]",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <label className="mt-0.5 inline-flex cursor-pointer items-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleConversationSelection(conversation.id)}
                            className="h-4 w-4 rounded border-[var(--bc-neutral-border)] text-[var(--bc-primary)] focus:ring-[var(--bc-primary)]"
                            aria-label={`Selectionner ${displayTitle}`}
                          />
                        </label>
                        <div
                          className="min-w-0 flex-1"
                          ref={isRenaming ? renamingTitleContainerRef : null}
                        >
                          <div className="flex items-start justify-between gap-3">
                            {isRenaming ? (
                              <input
                                ref={renamingTitleInputRef}
                                type="text"
                                value={renamingConversationValue}
                                onChange={(event) =>
                                  setRenamingConversationValue(
                                    event.target.value.slice(0, MAX_CONVERSATION_TITLE_LENGTH),
                                  )
                                }
                                onKeyDown={handleRenameConversationKeyDown}
                                onBlur={handleCommitRenamingConversation}
                                onClick={(event) => event.stopPropagation()}
                                placeholder="Renommer la discussion..."
                                maxLength={MAX_CONVERSATION_TITLE_LENGTH}
                                className="w-full rounded-xl border border-[var(--bc-primary-border)] bg-white/90 px-3 py-2 text-sm font-semibold text-[var(--bc-neutral-strong)] outline-none ring-2 ring-[rgba(59,130,246,0.14)] transition-all dark:bg-[#08101f]"
                                aria-label="Renommer la discussion"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSelectConversation(conversation.id)}
                                onDoubleClick={() => handleStartRenamingConversation(conversation)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="line-clamp-2 text-sm font-semibold text-[var(--bc-neutral-strong)] transition-colors hover:text-[var(--bc-primary)]">
                                  {displayTitle}
                                </p>
                              </button>
                            )}
                            <span className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--bc-neutral-body)] dark:bg-[#020617]">
                              {conversation.messages.length}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectConversation(conversation.id)}
                            className="mt-2 block w-full text-left"
                          >
                            <p className="line-clamp-2 text-xs leading-5 text-[var(--bc-neutral-body)]">
                              {buildConversationPreview(conversation)}
                            </p>
                            <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--bc-neutral-muted)]">
                              <Clock3 className="h-3.5 w-3.5" />
                              <span>{formatConversationDate(conversation.updatedAt)}</span>
                            </div>
                          </button>
                        </div>
                        <div className="flex shrink-0 items-start gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartRenamingConversation(conversation)}
                            disabled={isBusy}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/85 text-[var(--bc-neutral-body)] transition-colors hover:border-[var(--bc-primary-border)] hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                            aria-label={`Renommer ${displayTitle}`}
                            title="Renommer la discussion"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteConversations([conversation.id])}
                            disabled={isBusy}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/85 text-[var(--bc-neutral-body)] transition-colors hover:border-[var(--bc-danger-border)] hover:bg-[var(--bc-danger-soft)] hover:text-[var(--bc-danger)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                            aria-label={`Supprimer ${displayTitle}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {hasMoreHistory ? (
                <button
                  type="button"
                  onClick={() =>
                    setVisibleConversationCount(
                      (currentCount) => currentCount + CONVERSATION_PAGE_SIZE,
                    )
                  }
                  className="mt-3 w-full rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-4 py-2.5 text-sm font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                >
                  Afficher plus
                </button>
              ) : null}
            </div>
          </aside>

          {isHistoryPanelOpen ? (
            <button
              type="button"
              onClick={() => setIsHistoryPanelOpen(false)}
              className="absolute inset-0 z-10 bg-slate-950/20 backdrop-blur-[1px]"
              aria-label="Fermer le panneau historique"
            />
          ) : null}

          <div className="relative flex min-h-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 shrink-0 border-b border-[rgba(196,181,253,0.28)] bg-[rgba(255,255,255,0.9)] px-3.5 py-3 backdrop-blur-xl sm:px-4">
              <div
                className={cn(
                  "flex items-start justify-between gap-3",
                  isFullscreen ? "mx-auto w-full max-w-[1180px]" : "w-full",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="bc-gradient-ai flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] text-white shadow-[0_12px_24px_rgba(99,102,241,0.24)]">
                      <Bot className="h-4.5 w-4.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-[var(--bc-neutral-strong)]">
                        Assistant IA
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--bc-success)]">
                          <span className="bc-chatbot-status-dot" />
                          <span>{connectionLabel}</span>
                        </span>
                        <Badge
                          variant={dataset?.usingMock ? "ai" : "outline"}
                          className="max-w-full whitespace-normal px-2.5 py-0.5 text-[10px] leading-4"
                        >
                          {freshnessLabel}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--bc-neutral-body)]">
                    <span>{firstName ? `Bonjour ${firstName}` : "Analyse de votre flotte"}</span>
                    {activeConversation ? (
                      <>
                        <span className="text-[var(--bc-neutral-muted)]">/</span>
                        <span>{formatConversationDate(activeConversation.updatedAt)}</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsHistoryPanelOpen((currentValue) => !currentValue)}
                    className="inline-flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    aria-expanded={isHistoryPanelOpen}
                    aria-label="Afficher l'historique des discussions"
                    title="Historique"
                  >
                    <History className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    className="inline-flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    aria-label={`${fullscreenToggleLabel} l'assistant IA`}
                    title={fullscreenToggleLabel}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleMinimizeChat}
                    className="inline-flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    aria-label="Reduire l'assistant IA"
                    title="Reduire"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseChat}
                    className="inline-flex h-8.5 w-8.5 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    aria-label="Fermer l'assistant IA"
                    title="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </header>

            <div className="bc-chatbot-scroll flex-1 min-h-0 scroll-smooth overflow-x-hidden overflow-y-auto px-3 pb-3 sm:px-4 sm:pb-4">
              <div
                className={cn(
                  "space-y-3 pt-2.5",
                  isFullscreen ? "mx-auto w-full max-w-[1180px]" : "w-full",
                )}
              >
                <div className="rounded-[22px] border border-[rgba(196,181,253,0.32)] bg-white/78 p-3.5 shadow-[0_18px_34px_-28px_rgba(79,70,229,0.35)] backdrop-blur-md dark:bg-[#08101f]/84">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-ai-start)]">
                        Assistant pret
                      </p>
                      <p className="mt-1.5 text-[13px] leading-5 text-[var(--bc-neutral-body)]">
                        Posez une question sur vos lignes, forfaits, couts ou alertes. Le chat reste fixe et l'input reste toujours visible.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateCopilotActionPlan}
                        disabled={isGeneratingCopilotActionPlan}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--bc-primary-border)] bg-[var(--bc-primary)] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--bc-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isGeneratingCopilotActionPlan ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Brain className="h-3.5 w-3.5" />
                        )}
                        <span>Plan d'action IA</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleGenerateCopilotActionPlan}
                        disabled={isGeneratingCopilotActionPlan}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Que faire cette semaine ?</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleGenerateAiReport()}
                        disabled={isGeneratingAiReport}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--bc-ai-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-ai-start)] transition-colors hover:bg-[var(--bc-ai-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                      >
                        {isGeneratingAiReport ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                        <span>Generer rapport IA</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateConversation}
                        disabled={isBusy}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Nouvelle</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {summaryBadges.map((badge, index) => (
                      <Badge
                        key={`summary-badge-${index}`}
                        variant="secondary"
                        className="bg-[var(--bg-card)]/78 px-2.5 py-0.5 text-[10px]"
                      >
                        {badge}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {primarySuggestions.map((suggestion, index) => (
                      <button
                        key={`primary-suggestion-${index}`}
                        type="button"
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="inline-flex items-center rounded-full border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--bc-ai-start)] transition-colors hover:bg-[rgba(99,102,241,0.18)]"
                      >
                        {suggestion}
                      </button>
                    ))}

                    {showAllSuggestions
                      ? overflowSuggestions.map((suggestion, index) => (
                          <button
                            key={`overflow-suggestion-${index}`}
                            type="button"
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="inline-flex items-center rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1 text-[11px] font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                          >
                            {suggestion}
                          </button>
                        ))
                      : null}
                  </div>

                  {hasSuggestionOverflow ? (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] text-[var(--bc-neutral-muted)]">
                        Questions rapides et reprises de contexte.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowAllSuggestions((currentValue) => !currentValue)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                      >
                        <span>{showAllSuggestions ? "Reduire" : "Voir plus"}</span>
                        {showAllSuggestions ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ) : null}

                  {showAllSuggestions && recentQuestionChips.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                        Reprendre
                      </span>
                      {recentQuestionChips.map((prompt, index) => (
                        <button
                          key={`recent-question-${index}`}
                          type="button"
                          onClick={() => handleSuggestionClick(prompt)}
                          className="rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1 text-[11px] font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {isGeneratingCopilotActionPlan && !copilotActionPlan ? (
                    <div className="mt-4 rounded-[22px] border border-[var(--bc-primary-border)] bg-white/85 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.2)] dark:bg-[#08101f]/80">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--bc-primary)] text-white shadow-[0_18px_36px_-22px_rgba(37,99,235,0.6)]">
                          <LoaderCircle className="h-5 w-5 animate-spin" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-primary)]">
                            IA Copilot
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[var(--bc-neutral-body)]">
                            {copilotLoadingLabel ?? "Generation du plan d'action IA..."}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {copilotActionPlanError ? (
                    <div className="mt-4 rounded-[20px] border border-[#FCA5A5]/60 bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#2A0A0A] dark:text-[#FCA5A5]">
                      {copilotActionPlanError}
                    </div>
                  ) : null}

                  {copilotActionPlan ? (
                    <CopilotActionPlanCard
                      plan={copilotActionPlan}
                      isRefreshing={isGeneratingCopilotActionPlan}
                      onRefresh={handleGenerateCopilotActionPlan}
                      onViewDetails={handleViewCopilotActionDetails}
                      onApplyRecommendation={handleApplyCopilotActionRecommendation}
                    />
                  ) : null}

                  {false ? (
                    <div className="mt-4 rounded-[22px] border border-[var(--bc-primary-border)] bg-white/85 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.2)] dark:bg-[#08101f]/80">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-primary)]">
                            Plan d'action IA
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                            {copilotActionPlan.subtitle}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleGenerateCopilotActionPlan}
                          disabled={isGeneratingCopilotActionPlan}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1.5 text-xs font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)]"
                        >
                          {isGeneratingCopilotActionPlan ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          <span>Actualiser</span>
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {copilotActionPlan.actions.map((action) => (
                          <div key={`${action.day}-${action.title}`} className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bg-card)] p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                              {action.day}
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[var(--bc-neutral-body)]">
                              {action.title}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-[var(--bc-neutral-muted)]">
                              {action.detail}
                            </p>
                            <p className="mt-3 text-[11px] font-semibold text-[var(--bc-neutral-body)]">
                              Priorité: {action.priority}
                            </p>
                          </div>
                        ))}
                      </div>

                      {copilotActionPlan.recommendations.length > 0 ? (
                        <div className="mt-4 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                            Recommandations rapides
                          </p>
                          <ul className="list-inside list-disc space-y-1 text-[13px] text-[var(--bc-neutral-body)]">
                            {copilotActionPlan.recommendations.map((recommendation, index) => (
                              <li key={index}>{recommendation}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <p className="mt-4 text-[11px] text-[var(--bc-neutral-muted)]">
                        Sources: {copilotActionPlan.sources.join(", ")} • Mise à jour: {formatConversationDate(copilotActionPlan.summary_updated_at)}
                      </p>
                    </div>
                  ) : null}
                </div>

                {assistantWorkspaceCards}

                {hasOlderMessages ? (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        scrollModeRef.current = "none";
                        setVisibleMessageCount(
                          (currentCount) => currentCount + VISIBLE_MESSAGE_STEP,
                        );
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-4 py-2 text-xs font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                      <span>Charger les messages precedents</span>
                    </button>
                  </div>
                ) : null}

                <div className="space-y-3">
                  {visibleMessages.map((message) => {
                    const isAssistant = message.role === "assistant";
                    const sourcesOpen = expandedSourceMessageIds.includes(message.id);
                    const ocrOpen = expandedOcrMessageIds.includes(message.id);
                    const visionOpen = expandedVisionMessageIds.includes(message.id);
                    const annotatedOpen = expandedAnnotatedMessageIds.includes(message.id);
                    const compareOpen = compareAnnotatedMessageIds.includes(message.id);
                    const isEditingUserMessage =
                      message.role === "user" && editingMessageId === message.id;
                    const canRegenerate =
                      Boolean(message.linkedUserMessageId) &&
                      message.role === "assistant" &&
                      message.status !== "streaming";
                    const isStreamingMessage = message.status === "streaming";
                    const imageTypeLabel = formatImageTypeLabel(message.imageAnalysis?.imageType);
                    const imageReliabilityLabel = formatReliabilityLabel(
                      message.imageAnalysis?.confidence,
                    );
                    const processingNotices = message.imageAnalysis?.processingNotices ?? [];
                    const visibleProcessingNotices = dedupeStrings(
                      processingNotices.filter((item) => item.trim().length > 0),
                      3,
                    );
                    const processingMessage = message.imageAnalysis?.processingMessage ?? null;
                    const analysisMetadata = message.imageAnalysis?.analysisMetadata;
                    const invoiceDetails = message.imageAnalysis?.invoiceDetails;
                    const incidentDetails = message.imageAnalysis?.incidentDetails;
                    const alertIntelligence = message.imageAnalysis?.alertIntelligence;
                    const workflowDetails = message.imageAnalysis?.workflowDetails;
                    const equipmentDetails = message.imageAnalysis?.equipmentDetails;
                    const decisionRecommendations =
                      message.imageAnalysis?.decisionRecommendations ?? [];
                    const isImageStrict = analysisMetadata?.sourceMode === "image_strict";
                    const riskLevelLabel = formatRiskLevelLabel(message.imageAnalysis?.riskLevel);
                    const workflowTypeLabel = formatWorkflowTypeLabel(workflowDetails?.workflowType);
                    const workflowComplexityLabel = formatComplexityLevelLabel(
                      workflowDetails?.complexityLevel,
                    );
                    const equipmentTypeLabel = formatEquipmentTypeLabel(
                      equipmentDetails?.equipmentType,
                    );
                    const isWorkflowAnalysis =
                      message.imageAnalysis?.imageType === "workflow" || Boolean(workflowDetails);
                    const isEquipmentAnalysis =
                      message.imageAnalysis?.imageType === "equipement" || Boolean(equipmentDetails);
                    const isCompactEquipmentVisionOnly =
                      isVisionOnlyEquipmentAnalysis(message.imageAnalysis);
                    const isAlertFocusedAnalysis =
                      Boolean(incidentDetails) &&
                      ["alerte", "alert_dashboard", "fraude", "log", "appel_suspect", "depassement_quota", "erreur_systeme", "anomalie"].includes(
                        incidentDetails?.alertType || message.imageAnalysis?.imageType || "",
                      );
                    const linkedUserAttachment =
                      message.linkedUserMessageId && activeConversation
                        ? activeConversation.messages.find(
                            (candidateMessage) => candidateMessage.id === message.linkedUserMessageId,
                          )?.attachment ?? null
                        : null;
                    const isDocumentMessage =
                      message.requestKind === "document" || linkedUserAttachment?.kind === "document";
                    const hasAnnotatedImage = Boolean(message.imageAnalysis?.highlightedImage);
                    const isAudioActive = audioPlaybackMessageId === message.id;
                    const isAudioLoading = isAudioActive && audioPlaybackState === "loading";
                    const isAudioPlaying = isAudioActive && audioPlaybackState === "playing";
                    const isAudioPaused = isAudioActive && audioPlaybackState === "paused";
                    const imageAnnotations = message.imageAnalysis?.annotations ?? [];
                    const visionButtonLabel = isEquipmentAnalysis
                      ? "Voir lecture equipement"
                      : isWorkflowAnalysis
                      ? "Voir lecture workflow"
                      : "Voir lecture metier";
                    const annotatedButtonLabel = isEquipmentAnalysis
                      ? "Voir zones detectees"
                      : isWorkflowAnalysis
                      ? "Voir zones critiques"
                      : "Voir image annotee";
                    const annotatedPanelLabel = isEquipmentAnalysis
                      ? "Zones detectees"
                      : isWorkflowAnalysis
                      ? "Zones critiques du workflow"
                      : "Image annotee";
                    const comparePanelLabel = isEquipmentAnalysis
                      ? "Comparaison original / zones detectees"
                      : isWorkflowAnalysis
                      ? "Comparaison original / zones critiques"
                      : "Comparaison original / annotee";
                    const explainabilityOpen = expandedExplainabilityMessageIds.includes(message.id);
                    const isExplainabilityLoading = xaiLoadingMessageId === message.id;
                    const canExplainMessage =
                      isAssistant &&
                      message.status === "complete" &&
                      !isCompactEquipmentVisionOnly &&
                      (message.text.trim() !== "" ||
                        Boolean(message.imageAnalysis) ||
                        Boolean(message.executiveReport) ||
                        Boolean(message.recommendation));
                    const explainabilityButtonLabel = message.executiveReport
                      ? "Facteurs du score"
                      : message.imageAnalysis || message.recommendation
                        ? "Facteurs de l'alerte"
                        : "Facteurs de l'analyse";
                    const explainabilityActionLabel = message.explainability
                      ? explainabilityOpen
                        ? "Masquer les facteurs"
                        : explainabilityButtonLabel
                      : explainabilityButtonLabel;
                    const canRunAdvancedImageAnalysis =
                      isAssistant &&
                      message.status !== "streaming" &&
                      !isCompactEquipmentVisionOnly &&
                      Boolean(message.imageAnalysis) &&
                      Boolean(linkedUserAttachment) &&
                      message.imageAnalysis?.advancedAnalysisAvailable !== false &&
                      !message.imageAnalysis?.advancedAnalysisCompleted;
                    const canRunQuickImageAnalysis =
                      isAssistant &&
                      !isCompactEquipmentVisionOnly &&
                      Boolean(linkedUserAttachment) &&
                      (
                        message.requestKind === "image" ||
                        message.requestKind === "document" ||
                        Boolean(message.imageAnalysis)
                      ) &&
                      message.status !== "streaming" &&
                      (message.status === "error" ||
                        message.imageAnalysis?.analysisMode === "advanced" ||
                        message.imageAnalysis?.analysisMode === "dashboard_analysis");
                    const streamingLabel =
                      message.loadingLabel?.trim() ||
                      (slowConversationId === activeConversation?.id
                        ? "Reponse en cours... optimisation en cours"
                        : "IA en train d'ecrire...");

                    return (
                      <div
                        key={message.id}
                        className={cn("flex", isAssistant ? "justify-start" : "justify-end")}
                      >
                        <article
                          className={cn(
                            "bc-chatbot-message max-w-[90%] rounded-[20px] border px-3.5 py-2.5 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.28)] sm:max-w-[85%]",
                            isAssistant
                              ? "bc-chatbot-message-assistant border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(245,243,255,0.9),rgba(255,255,255,0.96))] text-[var(--bc-neutral-strong)] dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.18),rgba(8,16,31,0.96))]"
                              : "bc-chatbot-message-user border-[var(--bc-primary-border)] bg-[linear-gradient(135deg,var(--bc-primary),var(--bc-ai-start))] text-white",
                          )}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-3">
                            <div
                              className={cn(
                                "inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                isAssistant ? "text-[var(--bc-ai-start)]" : "text-white/80",
                              )}
                            >
                              {isAssistant ? (
                                <>
                                  {isStreamingMessage ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3.5 w-3.5" />
                                  )}
                                  <span>Assistant IA</span>
                                </>
                              ) : (
                                <>
                                  <span>Vous</span>
                                  {message.isEdited ? (
                                    <span className="rounded-full border border-white/25 px-2 py-0.5 text-[10px] text-white/80">
                                      Modifie
                                    </span>
                                  ) : null}
                                </>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-[10px]",
                                isAssistant
                                  ? "text-[var(--bc-neutral-muted)]"
                                  : "text-white/70",
                              )}
                            >
                              {formatMessageTimestamp(message.createdAt)}
                            </span>
                          </div>

                          {isEditingUserMessage ? (
                            <div className="space-y-3">
                              <Textarea
                                ref={editingInputRef}
                                rows={3}
                                value={editingMessageValue}
                                onChange={(event) => setEditingMessageValue(event.target.value)}
                                className="min-h-[110px] border-white/20 bg-white/10 px-3 py-3 text-sm text-white placeholder:text-white/55 focus-visible:border-white/35 focus-visible:ring-0"
                                placeholder="Modifiez votre question..."
                              />
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={handleCancelEditingMessage}
                                  className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/90 transition-colors hover:bg-white/16"
                                >
                                  Annuler
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleConfirmEditingMessage()}
                                  disabled={!editingMessageValue.trim()}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-primary)] transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  <span>Valider modification</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p
                              className={cn(
                                "whitespace-pre-wrap break-words text-[13px] leading-5 sm:text-[13.5px]",
                                isAssistant
                                  ? "text-[var(--bc-neutral-strong)]"
                                  : "text-white",
                              )}
                            >
                              {message.text || (isStreamingMessage ? "Analyse en cours..." : "")}
                            </p>
                          )}

                          {message.attachment?.kind === "image" ? (
                            <div
                              className={cn(
                                "mt-3 overflow-hidden rounded-2xl border",
                                isAssistant
                                  ? "border-[var(--bc-neutral-border)] bg-white/70"
                                  : "border-white/20 bg-white/10",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  openImagePreview(
                                    message.attachment?.previewUrl || "",
                                    message.attachment?.name || "Image jointe",
                                  )
                                }
                                className="group block w-full text-left"
                              >
                                <img
                                  src={message.attachment.previewUrl}
                                  alt={message.attachment.name}
                                  className="max-h-56 w-full object-cover transition-transform duration-300 group-hover:scale-[1.01]"
                                />
                              </button>
                              <div
                                className={cn(
                                  "flex items-center justify-between gap-2 px-3 py-2 text-xs",
                                  isAssistant
                                    ? "text-[var(--bc-neutral-body)]"
                                    : "text-white/85",
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <FileImage className="h-3.5 w-3.5" />
                                  <span className="truncate">{message.attachment.name}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openImagePreview(
                                      message.attachment?.previewUrl || "",
                                      message.attachment?.name || "Image jointe",
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-full border border-current/20 px-2 py-1 text-[10px] font-semibold"
                                >
                                  <Maximize2 className="h-3 w-3" />
                                  <span>Ouvrir</span>
                                </button>
                              </div>
                            </div>
                          ) : message.attachment?.kind === "document" ? (
                            <button
                              type="button"
                              disabled={!hasUsableAttachmentPreviewUrl(message.attachment)}
                              onClick={() => {
                                if (!hasUsableAttachmentPreviewUrl(message.attachment)) {
                                  toast.error("Apercu indisponible. Rechargez le document pour le rouvrir.");
                                  return;
                                }
                                if (message.attachment.documentType === "pdf") {
                                  openPdfPreview(
                                    message.attachment?.previewUrl || "",
                                    message.attachment?.name || "Document PDF",
                                  );
                                  return;
                                }
                                window.open(
                                  message.attachment?.previewUrl || "",
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              }}
                              className={cn(
                                "mt-3 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
                                isAssistant
                                  ? "border-[var(--bc-neutral-border)] bg-white/75 hover:bg-white"
                                  : "border-white/20 bg-white/10 hover:bg-white/14",
                                !hasUsableAttachmentPreviewUrl(message.attachment)
                                  ? "cursor-not-allowed opacity-70 hover:bg-inherit"
                                  : null,
                              )}
                            >
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1D4ED8,#7C3AED)] text-white shadow-[0_16px_32px_-24px_rgba(79,70,229,0.55)]">
                                <FileText className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p
                                  className={cn(
                                    "truncate text-[13px] font-semibold",
                                    isAssistant ? "text-[var(--bc-neutral-strong)]" : "text-white",
                                  )}
                                >
                                  {message.attachment.name}
                                </p>
                                <p
                                  className={cn(
                                    "mt-1 text-[11px]",
                                    isAssistant ? "text-[var(--bc-neutral-muted)]" : "text-white/75",
                                  )}
                                >
                                  {`${formatDocumentTypeLabel(message.attachment.documentType)} • ${
                                    formatFileSize(message.attachment.sizeBytes) || "n/a"
                                  } • ${
                                    hasUsableAttachmentPreviewUrl(message.attachment)
                                      ? message.attachment.documentType === "pdf"
                                        ? "Analyse documentaire prete"
                                        : "Analyse tabulaire prete"
                                      : "Apercu a recharger"
                                  }`}
                                </p>
                              </div>
                              <div
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                                  isAssistant
                                    ? "border-[var(--bc-neutral-border)] text-[var(--bc-neutral-body)]"
                                    : "border-white/20 text-white/85",
                                )}
                              >
                                <Maximize2 className="h-3 w-3" />
                                <span>
                                  {hasUsableAttachmentPreviewUrl(message.attachment)
                                    ? message.attachment.documentType === "pdf"
                                      ? "Preview"
                                      : "Ouvrir"
                                    : "Indisponible"}
                                </span>
                              </div>
                            </button>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && message.bullets && message.bullets.length > 0 ? (
                            <ul
                              className={cn(
                                "mt-2.5 space-y-1.5 text-[13px] leading-5",
                                isAssistant
                                  ? "text-[var(--bc-neutral-body)]"
                                  : "text-white/90",
                              )}
                            >
                              {message.bullets.map((bullet, index) => (
                                <li key={`${message.id}-bullet-${index}`} className="flex gap-2">
                                  <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-current" />
                                  <span>{bullet}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && message.recommendation ? (
                            <div className="mt-2.5 rounded-2xl border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.04),var(--bg-card))] px-3 py-2.5">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
                                <Sparkles className="h-3.5 w-3.5" />
                                <span>Recommandation</span>
                              </div>
                              <p className="mt-1.5 text-[13px] leading-5 text-[var(--bc-neutral-strong)]">
                                {message.recommendation}
                              </p>
                              <div className="mt-3">
                                <ExplainRecommendationModal
                                  recommendation={message.recommendation}
                                  onExplain={(recommendationTitle) =>
                                    handleExplainRecommendation(message, recommendationTitle)
                                  }
                                />
                              </div>
                            </div>
                          ) : null}

                          {message.executiveReport ? (
                            <div className="mt-3">
                              <ExecutiveReportCard
                                report={message.executiveReport}
                                onExportPdf={() => handleExportExecutiveReport(message.id)}
                                onApplyRecommendation={(recommendationTitle) =>
                                  handleApplyDecisionRecommendation(recommendationTitle, null)
                                }
                                onExplainRecommendation={(recommendationTitle) =>
                                  handleExplainRecommendation(message, recommendationTitle)
                                }
                              />
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && message.imageAnalysis ? (
                            <div className="mt-3 space-y-3">
                              <div className="flex flex-wrap gap-2">
                                <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                  Type detecte: {imageTypeLabel}
                                </Badge>
                                {message.imageAnalysis.detectedOperator ? (
                                  <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                    Operateur: {message.imageAnalysis.detectedOperator}
                                  </Badge>
                                ) : null}
                                {workflowTypeLabel ? (
                                  <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                    Workflow: {workflowTypeLabel}
                                  </Badge>
                                ) : null}
                                {equipmentTypeLabel ? (
                                  <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                    Equipement: {equipmentTypeLabel}
                                  </Badge>
                                ) : null}
                                {riskLevelLabel ? (
                                  <Badge
                                    variant="outline"
                                    className={cn("px-2.5 py-1 text-[11px]", getPriorityBadgeClass(message.imageAnalysis?.riskLevel))}
                                  >
                                    Risque: {riskLevelLabel}
                                  </Badge>
                                ) : null}
                                {workflowComplexityLabel ? (
                                  <Badge
                                    variant="outline"
                                    className={cn("px-2.5 py-1 text-[11px]", getPriorityBadgeClass(workflowDetails?.complexityLevel))}
                                  >
                                    Complexite: {workflowComplexityLabel}
                                  </Badge>
                                ) : null}
                                {incidentDetails?.severity ? (
                                  <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                    Gravite: {incidentDetails.severity}
                                  </Badge>
                                ) : null}
                                {incidentDetails?.priority ? (
                                  <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                    Priorite: {incidentDetails.priority}
                                  </Badge>
                                ) : null}
                                {imageReliabilityLabel ? (
                                  <Badge variant="secondary" className="px-2.5 py-1 text-[11px]">
                                    Fiabilite: {imageReliabilityLabel}
                                  </Badge>
                                ) : null}
                                <Badge variant="secondary" className="px-2.5 py-1 text-[11px]">
                                  {getImageAnalysisModeBadge(
                                    normalizeImageAnalysisMode(message.imageAnalysis?.analysisMode),
                                  )}
                                </Badge>
                              </div>

                              {processingMessage ? (
                                <div
                                  className={cn(
                                    "rounded-2xl border px-3 py-3",
                                    message.imageAnalysis?.analysisStatus === "fallback"
                                      ? "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)]/80"
                                      : "border-[var(--bc-neutral-border)] bg-white/75 dark:bg-[#08101f]",
                                  )}
                                >
                                  <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                                    {processingMessage}
                                  </p>
                                  {visibleProcessingNotices.length > 0 ? (
                                    <ul className="mt-2 space-y-1 text-[13px] leading-5 text-[var(--bc-neutral-body)]">
                                      {visibleProcessingNotices.map((item, index) => (
                                        <li key={`${message.id}-processing-${index}`}>- {item}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                              ) : null}

                              {isImageStrict ? (
                                <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                    Analyse KPI verifiee
                                  </p>
                                  <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                    L'analyse privilegie les KPI effectivement visibles dans l'image et bloque le contexte global non verifie.
                                  </p>
                                  {analysisMetadata?.visibleKpisUsed &&
                                  analysisMetadata.visibleKpisUsed.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Indicateurs visibles utilises
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {analysisMetadata.visibleKpisUsed.slice(0, 6).map((item, index) => (
                                          <li key={`${message.id}-strict-kpi-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {(typeof workflowDetails?.complexityScore === "number" ||
                                typeof equipmentDetails?.conditionScore === "number" ||
                                typeof equipmentDetails?.criticalityScore === "number" ||
                                typeof equipmentDetails?.obsolescenceScore === "number" ||
                                typeof equipmentDetails?.maintenanceScore === "number" ||
                                typeof message.imageAnalysis.optimizationScore === "number" ||
                                typeof message.imageAnalysis.anomalyScore === "number" ||
                                typeof message.imageAnalysis.fraudScore === "number" ||
                                typeof message.imageAnalysis.costScore === "number") ? (
                                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                                  {typeof equipmentDetails?.conditionScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Score etat
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {equipmentDetails.conditionScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof equipmentDetails?.criticalityScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Score criticite
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {equipmentDetails.criticalityScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof equipmentDetails?.obsolescenceScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Score obsolescence
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {equipmentDetails.obsolescenceScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof equipmentDetails?.maintenanceScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Score maintenance
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {equipmentDetails.maintenanceScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof workflowDetails?.complexityScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Score complexite
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {workflowDetails.complexityScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof message.imageAnalysis.optimizationScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Risque optimisation
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {message.imageAnalysis.optimizationScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof message.imageAnalysis.costScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Risque cout
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {message.imageAnalysis.costScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof message.imageAnalysis.anomalyScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Risque anomalie
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {message.imageAnalysis.anomalyScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                  {typeof message.imageAnalysis.fraudScore === "number" ? (
                                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Risque fraude
                                      </p>
                                      <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                                        {message.imageAnalysis.fraudScore}/100
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {equipmentDetails ? (
                                <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                    Analyse equipement
                                  </p>
                                  <div className="mt-2 grid gap-2 text-sm leading-6 text-[var(--bc-neutral-body)] sm:grid-cols-2">
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Type detecte
                                      </span>
                                      : {equipmentTypeLabel || "Equipement non identifie avec certitude"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Marque
                                      </span>
                                      : {equipmentDetails.brand || "non lisible avec certitude"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Modele
                                      </span>
                                      : {equipmentDetails.model || "Equipement non identifie avec certitude"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Etat visible
                                      </span>
                                      : {equipmentDetails.visibleCondition || "non lisible avec certitude"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Remplacement
                                      </span>
                                      : {equipmentDetails.replacementNeeded ? "recommande" : "pas immediat"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Niveau criticite
                                      </span>
                                      : {typeof equipmentDetails.criticalityScore === "number"
                                        ? `${equipmentDetails.criticalityScore}/100`
                                        : "non lisible avec certitude"}
                                    </p>
                                    {equipmentDetails.serialNumber ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Numero serie
                                        </span>
                                        : {equipmentDetails.serialNumber}
                                      </p>
                                    ) : null}
                                    {equipmentDetails.deviceVersion ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Version
                                        </span>
                                        : {equipmentDetails.deviceVersion}
                                      </p>
                                    ) : null}
                                    {equipmentDetails.simInformation ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Infos SIM
                                        </span>
                                        : {equipmentDetails.simInformation}
                                      </p>
                                    ) : null}
                                    {equipmentDetails.operator ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Operateur
                                        </span>
                                        : {equipmentDetails.operator}
                                      </p>
                                    ) : null}
                                  </div>
                                  {equipmentDetails.usageSummary ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Usage estime
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {equipmentDetails.usageSummary}
                                      </p>
                                    </div>
                                  ) : null}
                                  {equipmentDetails.summary ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Resume technique
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {equipmentDetails.summary}
                                      </p>
                                    </div>
                                  ) : null}
                                  {equipmentDetails.detectedIssues && equipmentDetails.detectedIssues.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Defauts visibles
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {equipmentDetails.detectedIssues.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-equipment-issue-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {equipmentDetails.maintenanceRecommendations &&
                                  equipmentDetails.maintenanceRecommendations.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Maintenance recommandee
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {equipmentDetails.maintenanceRecommendations.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-equipment-maintenance-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {workflowDetails ? (
                                <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                    Analyse workflow
                                  </p>
                                  <div className="mt-2 grid gap-2 text-sm leading-6 text-[var(--bc-neutral-body)] sm:grid-cols-2">
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Type workflow
                                      </span>
                                      : {workflowTypeLabel || "Workflow"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Score complexite
                                      </span>
                                      : {typeof workflowDetails.complexityScore === "number"
                                        ? `${workflowDetails.complexityScore}/100`
                                        : "non lisible avec certitude"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Niveau
                                      </span>
                                      : {workflowComplexityLabel || "non lisible avec certitude"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Departements
                                      </span>
                                      : {workflowDetails.detectedDepartments?.length
                                        ? workflowDetails.detectedDepartments.slice(0, 4).join(", ")
                                        : "non lisible avec certitude"}
                                    </p>
                                  </div>
                                  {workflowDetails.summary ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Resume workflow
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {workflowDetails.summary}
                                      </p>
                                    </div>
                                  ) : null}
                                  {workflowDetails.criticalSteps && workflowDetails.criticalSteps.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Etapes critiques
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {workflowDetails.criticalSteps.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-workflow-step-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {workflowDetails.bottlenecks && workflowDetails.bottlenecks.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Points de blocage
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {workflowDetails.bottlenecks.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-workflow-bottleneck-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {workflowDetails.automationOpportunities && workflowDetails.automationOpportunities.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Opportunites automatisation
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {workflowDetails.automationOpportunities.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-workflow-automation-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {decisionRecommendations.length > 0 ? (
                                <div className="rounded-2xl border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(255,255,255,0.92))] px-3 py-3 dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(8,16,31,0.96))]">
                                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    <span>Recommandations IA</span>
                                  </div>
                                  <div className="mt-3 space-y-3">
                                    {decisionRecommendations.slice(0, 4).map((recommendation, index) => {
                                      const recommendationKey = `${message.id}:${index}:${recommendation.title}`;
                                      const isRecommendationOpen =
                                        expandedDecisionRecommendationKeys.includes(recommendationKey);

                                      return (
                                        <div
                                          key={recommendationKey}
                                          className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]"
                                        >
                                          <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                              <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                                                {recommendation.title}
                                              </p>
                                              <div className="mt-2 flex flex-wrap gap-2">
                                                <span
                                                  className={cn(
                                                    "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                                                    getPriorityBadgeClass(recommendation.priority),
                                                  )}
                                                >
                                                  {formatRiskLevelLabel(recommendation.priority) || recommendation.priority}
                                                </span>
                                                <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                                  {formatImpactLabel(recommendation.impact)}
                                                </Badge>
                                                {recommendation.estimatedSaving ? (
                                                  <Badge variant="secondary" className="px-2.5 py-1 text-[11px]">
                                                    {recommendation.estimatedSaving}
                                                  </Badge>
                                                ) : null}
                                              </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                              <ExplainRecommendationModal
                                                recommendation={recommendation.title}
                                                onExplain={(recommendationTitle) =>
                                                  handleExplainRecommendation(message, recommendationTitle)
                                                }
                                                buttonLabel="Pourquoi cette recommandation ?"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => handleToggleDecisionRecommendation(recommendationKey)}
                                                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                              >
                                                <span>Voir details</span>
                                                {isRecommendationOpen ? (
                                                  <ChevronUp className="h-3.5 w-3.5" />
                                                ) : (
                                                  <ChevronDown className="h-3.5 w-3.5" />
                                                )}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleApplyDecisionRecommendation(
                                                    recommendation.title,
                                                    linkedUserAttachment,
                                                  )
                                                }
                                                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-ai-start)] transition-colors hover:bg-[var(--bc-ai-soft)]/80"
                                              >
                                                <ArrowUpRight className="h-3.5 w-3.5" />
                                                <span>Appliquer analyse</span>
                                              </button>
                                            </div>
                                          </div>
                                          {isRecommendationOpen ? (
                                            <div className="mt-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/70 px-3 py-3 text-sm leading-6 text-[var(--bc-neutral-body)] dark:bg-[#060d19]">
                                              <p>{recommendation.reason}</p>
                                              {!recommendation.estimatedSaving ? (
                                                <p className="mt-2 text-[var(--bc-neutral-muted)]">
                                                  Analyse insuffisante pour chiffrer une economie fiable.
                                                </p>
                                              ) : null}
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : message.imageAnalysis.recommendationNotice ? (
                                <div className="rounded-2xl border border-dashed border-[var(--bc-neutral-border)] bg-white/65 px-3 py-3 dark:bg-[#08101f]">
                                  <p className="text-sm leading-6 text-[var(--bc-neutral-body)]">
                                    {message.imageAnalysis.recommendationNotice}
                                  </p>
                                </div>
                              ) : null}

                              {invoiceDetails ? (
                                <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                    Facture telecom
                                  </p>
                                  <div className="mt-2 grid gap-2 text-sm leading-6 text-[var(--bc-neutral-body)] sm:grid-cols-2">
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Total
                                      </span>
                                      : {invoiceDetails.totalAmountMad || invoiceDetails.amountTtcMad || "montant non lisible avec certitude"}
                                    </p>
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Periode
                                      </span>
                                      : {invoiceDetails.billingPeriod || invoiceDetails.invoiceDate || "non lisible avec certitude"}
                                    </p>
                                    {invoiceDetails.invoiceNumber ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Numero facture
                                        </span>
                                        : {invoiceDetails.invoiceNumber}
                                      </p>
                                    ) : null}
                                    {invoiceDetails.amountHtMad ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Montant HT
                                        </span>
                                        : {invoiceDetails.amountHtMad}
                                      </p>
                                    ) : null}
                                    {invoiceDetails.vatAmountMad ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          TVA
                                        </span>
                                        : {invoiceDetails.vatAmountMad}
                                      </p>
                                    ) : null}
                                    {invoiceDetails.amountTtcMad ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Montant TTC
                                        </span>
                                        : {invoiceDetails.amountTtcMad}
                                      </p>
                                    ) : null}
                                  </div>
                                  {invoiceDetails.billedLines && invoiceDetails.billedLines.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Lignes facturees
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {invoiceDetails.billedLines.slice(0, 4).join(", ")}
                                      </p>
                                    </div>
                                  ) : null}
                                  {invoiceDetails.additionalFees && invoiceDetails.additionalFees.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Frais supplementaires
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {invoiceDetails.additionalFees.slice(0, 3).map((item, index) => (
                                          <li key={`${message.id}-invoice-fee-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {invoiceDetails.overageItems && invoiceDetails.overageItems.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Depassements
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {invoiceDetails.overageItems.slice(0, 3).map((item, index) => (
                                          <li key={`${message.id}-invoice-overage-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {incidentDetails ? (
                                <>
                                  {isAlertFocusedAnalysis && alertIntelligence ? (
                                    <AlertIntelligenceCard
                                      analysis={message.imageAnalysis!}
                                      messageId={message.id}
                                      canRunAdvancedImageAnalysis={canRunAdvancedImageAnalysis}
                                      onRunAdvancedImageAnalysis={handleRunAdvancedImageAnalysis}
                                    />
                                  ) : null}

                                  <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                      {isAlertFocusedAnalysis && alertIntelligence
                                        ? "Indicateurs visibles"
                                        : "Analyse alerte ou log"}
                                    </p>
                                  <div className="mt-2 grid gap-2 text-sm leading-6 text-[var(--bc-neutral-body)] sm:grid-cols-2">
                                    <p>
                                      <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                        Type detecte
                                      </span>
                                      : {formatImageTypeLabel(incidentDetails.alertType || message.imageAnalysis?.imageType)}
                                    </p>
                                    {incidentDetails.severity ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Gravite
                                        </span>
                                        : {incidentDetails.severity}
                                      </p>
                                    ) : null}
                                    {incidentDetails.priority ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Priorite
                                        </span>
                                        : {incidentDetails.priority}
                                      </p>
                                    ) : null}
                                    {incidentDetails.detectedAt ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Date/heure
                                        </span>
                                        : {incidentDetails.detectedAt}
                                      </p>
                                    ) : null}
                                    {incidentDetails.criticalAlertCount !== null &&
                                    incidentDetails.criticalAlertCount !== undefined ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Alertes critiques
                                        </span>
                                        : {incidentDetails.criticalAlertCount}
                                      </p>
                                    ) : null}
                                    {incidentDetails.exposureRate ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Taux d'exposition
                                        </span>
                                        : {incidentDetails.exposureRate}
                                      </p>
                                    ) : null}
                                    {incidentDetails.financialImpactMad ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Impact financier
                                        </span>
                                        : {incidentDetails.financialImpactMad}
                                      </p>
                                    ) : null}
                                    {incidentDetails.averageScore ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Score moyen
                                        </span>
                                        : {incidentDetails.averageScore}
                                      </p>
                                    ) : null}
                                    {incidentDetails.riskScore ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Score de risque
                                        </span>
                                        : {incidentDetails.riskScore}
                                      </p>
                                    ) : null}
                                    {incidentDetails.lineReference ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Ligne
                                        </span>
                                        : {incidentDetails.lineReference}
                                      </p>
                                    ) : null}
                                    {incidentDetails.suspectCostMad ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Cout suspect
                                        </span>
                                        : {incidentDetails.suspectCostMad}
                                      </p>
                                    ) : null}
                                    {incidentDetails.callVolume ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Volume appels
                                        </span>
                                        : {incidentDetails.callVolume}
                                      </p>
                                    ) : null}
                                    {incidentDetails.dataOverage ? (
                                      <p>
                                        <span className="font-semibold text-[var(--bc-neutral-strong)]">
                                          Depassement data
                                        </span>
                                        : {incidentDetails.dataOverage}
                                      </p>
                                    ) : null}
                                  </div>
                                  {incidentDetails.riskyEntities &&
                                  incidentDetails.riskyEntities.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Utilisateurs ou lignes a risque
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.riskyEntities.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-incident-risk-entity-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {incidentDetails.criticalSignals &&
                                  incidentDetails.criticalSignals.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Signaux critiques
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.criticalSignals.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-incident-signal-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {incidentDetails.maxRiskScores &&
                                  incidentDetails.maxRiskScores.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Scores maximaux visibles
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.maxRiskScores.slice(0, 4).join(", ")}
                                      </p>
                                    </div>
                                  ) : null}
                                  {incidentDetails.summary ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Resume de l'alerte
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.summary}
                                      </p>
                                    </div>
                                  ) : null}
                                  {incidentDetails.errorMessage ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Message d'erreur
                                      </p>
                                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.errorMessage}
                                      </p>
                                    </div>
                                  ) : null}
                                  {incidentDetails.repeatedAnomalies &&
                                  incidentDetails.repeatedAnomalies.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Anomalies visibles
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.repeatedAnomalies.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-incident-repeat-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {incidentDetails.visibleStatuses &&
                                  incidentDetails.visibleStatuses.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Statuts visibles
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.visibleStatuses.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-incident-status-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  {incidentDetails.probableCauses && incidentDetails.probableCauses.length > 0 ? (
                                    <div className="mt-3">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                        Causes probables
                                      </p>
                                      <ul className="mt-1 space-y-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                        {incidentDetails.probableCauses.slice(0, 4).map((item, index) => (
                                          <li key={`${message.id}-incident-cause-${index}`}>- {item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                  </div>
                                </>
                              ) : null}

                              {imageAnnotations.length > 0 ? (
                                <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                    {isEquipmentAnalysis ? "Zones detectees" : isWorkflowAnalysis ? "Zones critiques" : "Zones annotees"}
                                  </p>
                                  <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                    {imageAnnotations.slice(0, 5).map((annotation, index) => (
                                      <li key={`${annotation.label}-${index}`} className="flex gap-2">
                                        <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                                        <span>
                                          {annotation.label}
                                          {formatReliabilityLabel(annotation.confidence)
                                            ? ` - lecture ${formatReliabilityLabel(annotation.confidence)}`
                                            : ""}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {message.imageAnalysis.detectedAnomalies &&
                              message.imageAnalysis.detectedAnomalies.length > 0 ? (
                                <div className="rounded-2xl border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)]/70 px-3 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-danger)]">
                                    Anomalies detectees
                                  </p>
                                  <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                    {message.imageAnalysis.detectedAnomalies.slice(0, 4).map((item, index) => (
                                      <li key={`${message.id}-anomaly-${index}`} className="flex gap-2">
                                        <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-danger)]" />
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {message.imageAnalysis.recommendations &&
                              message.imageAnalysis.recommendations.length > 1 &&
                              !isImageStrict &&
                              !isAlertFocusedAnalysis ? (
                                <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/75 px-3 py-3 dark:bg-[#08101f]">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                    Actions detectees
                                  </p>
                                  <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                    {message.imageAnalysis.recommendations
                                      .slice(1, 4)
                                      .map((item, index) => (
                                        <li key={`${message.id}-action-${index}`} className="flex gap-2">
                                          <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                                          <span>{item}</span>
                                        </li>
                                      ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {isAssistant ? (
                            <div
                              className="mt-3 flex flex-wrap items-center gap-2"
                              data-export-ignore="true"
                            >
                              <button
                                type="button"
                                onClick={() => void handleCopyMessage(message)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                  <span>Copier</span>
                                </button>
                              {message.status !== "streaming" && message.text.trim() !== "" ? (
                                <button
                                  type="button"
                                  onClick={() => void handleToggleAssistantAudio(message)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                                >
                                  {isAudioLoading ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : isAudioPlaying ? (
                                    <Pause className="h-3.5 w-3.5" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5" />
                                  )}
                                  <span>
                                    {isAudioPlaying
                                      ? "Pause audio"
                                      : isAudioPaused
                                        ? "Reprendre audio"
                                        : "Lire la reponse"}
                                  </span>
                                </button>
                              ) : null}
                              {isAudioActive ? (
                                <button
                                  type="button"
                                  onClick={stopAssistantAudioPlayback}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                >
                                  <Square className="h-3.5 w-3.5" />
                                  <span>Stop audio</span>
                                  {formatVoiceDurationLabel(audioPlaybackDuration) ? (
                                    <span className="text-[10px] font-medium text-[var(--bc-neutral-muted)]">
                                      {formatVoiceDurationLabel(audioPlaybackDuration)}
                                    </span>
                                  ) : null}
                                </button>
                              ) : null}
                              {canRegenerate ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRegenerateMessage(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                                >
                                  {regeneratingMessageId === message.id ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                  <span>
                                    {isDocumentMessage
                                      ? "Relancer document"
                                      : message.requestKind === "image"
                                        ? "Relancer analyse"
                                        : "Regenerer"}
                                  </span>
                                </button>
                              ) : null}
                              {canRunQuickImageAnalysis ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRunQuickImageAnalysis(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                                >
                                  {regeneratingMessageId === message.id ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Clock3 className="h-3.5 w-3.5" />
                                  )}
                                  <span>Lecture initiale</span>
                                </button>
                              ) : null}
                              {canRunAdvancedImageAnalysis ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRunAdvancedImageAnalysis(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-ai-start)] transition-colors hover:bg-[var(--bc-ai-soft)]/80 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {regeneratingMessageId === message.id ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3.5 w-3.5" />
                                  )}
                                  <span>
                                    {message.imageAnalysis?.analysisStatus === "fallback"
                                      ? "Relancer audit approfondi"
                                      : "Audit approfondi"}
                                  </span>
                                </button>
                              ) : null}
                              {canExplainMessage ? (
                                <button
                                  type="button"
                                  onClick={() => void handleExplainMessage(message)}
                                  disabled={Boolean(explainingMessageId) && explainingMessageId !== message.id}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(56,189,248,0.08),rgba(255,255,255,0.96))] px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-ai-start)] transition-colors hover:bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(56,189,248,0.12),rgba(255,255,255,0.98))] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(8,16,31,0.96),rgba(8,16,31,0.96))]"
                                >
                                  {isExplainabilityLoading ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Brain className="h-3.5 w-3.5" />
                                  )}
                                  <span>{explainabilityActionLabel}</span>
                                  {message.explainability && !isExplainabilityLoading ? (
                                    explainabilityOpen ? (
                                      <ChevronUp className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )
                                  ) : null}
                                </button>
                              ) : null}
                              {!isCompactEquipmentVisionOnly && message.imageAnalysis?.ocrText ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleOcr(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                >
                                  <FileImage className="h-3.5 w-3.5" />
                                  <span>Voir texte extrait</span>
                                  {ocrOpen ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : null}
                              {!isCompactEquipmentVisionOnly && message.imageAnalysis?.visionAnalysis ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleVision(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                >
                                  <ImagePlus className="h-3.5 w-3.5" />
                                  <span>{visionButtonLabel}</span>
                                  {visionOpen ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : null}
                              {!isCompactEquipmentVisionOnly && hasAnnotatedImage ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleAnnotatedImage(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                >
                                  <ImagePlus className="h-3.5 w-3.5" />
                                  <span>{annotatedButtonLabel}</span>
                                  {annotatedOpen ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : null}
                              {!isCompactEquipmentVisionOnly &&
                              hasAnnotatedImage &&
                              linkedUserAttachment?.kind === "image" ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleAnnotatedCompare(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                >
                                  <Maximize2 className="h-3.5 w-3.5" />
                                  <span>{comparePanelLabel}</span>
                                  {compareOpen ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : null}
                              {!isCompactEquipmentVisionOnly && message.sources && message.sources.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleSources(message.id)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                >
                                  <Link2 className="h-3.5 w-3.5" />
                                  <span>Voir source IA</span>
                                  {sourcesOpen ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : null}
                            </div>
                          ) : !isEditingUserMessage ? (
                            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleStartEditingMessage(message)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/90 transition-colors hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                <span>Modifier</span>
                              </button>
                            </div>
                          ) : null}

                          {isStreamingMessage ? (
                            <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--bc-neutral-body)]">
                              <span>{streamingLabel}</span>
                              <span className="bc-chatbot-typing-dot" />
                              <span className="bc-chatbot-typing-dot [animation-delay:140ms]" />
                              <span className="bc-chatbot-typing-dot [animation-delay:280ms]" />
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && sourcesOpen && message.sources && message.sources.length > 0 ? (
                            <div className="mt-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                Sources IA
                              </p>
                              <ul className="mt-2 space-y-2 text-xs leading-5 text-[var(--bc-neutral-body)]">
                                {message.sources.map((source, index) => (
                                  <li key={`${message.id}-source-${index}`} className="flex gap-2">
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                                    <span>{source}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && ocrOpen && message.imageAnalysis?.ocrText ? (
                            <div className="mt-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                Texte extrait
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--bc-neutral-body)]">
                                {message.imageAnalysis.ocrText}
                              </p>
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && visionOpen && message.imageAnalysis?.visionAnalysis ? (
                            <div className="mt-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                {isEquipmentAnalysis ? "Lecture equipement" : isWorkflowAnalysis ? "Lecture workflow" : "Lecture metier du visuel"}
                              </p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--bc-neutral-body)]">
                                {message.imageAnalysis.visionAnalysis}
                              </p>
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && annotatedOpen && message.imageAnalysis?.highlightedImage ? (
                            <div className="mt-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                  {annotatedPanelLabel}
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openImagePreview(
                                      message.imageAnalysis?.highlightedImage || "",
                                      annotatedPanelLabel,
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                                >
                                  <Maximize2 className="h-3 w-3" />
                                  <span>Zoom</span>
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  openImagePreview(
                                    message.imageAnalysis?.highlightedImage || "",
                                    annotatedPanelLabel,
                                  )
                                }
                                className="mt-3 block w-full overflow-hidden rounded-2xl border border-[var(--bc-neutral-border)] bg-white/70 text-left dark:bg-[#060d19]"
                              >
                                <img
                                  src={message.imageAnalysis.highlightedImage}
                                  alt={annotatedPanelLabel}
                                  className="max-h-[360px] w-full object-contain"
                                />
                              </button>
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && compareOpen && linkedUserAttachment && message.imageAnalysis?.highlightedImage ? (
                            <div className="mt-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                {comparePanelLabel}
                              </p>
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openImagePreview(
                                      linkedUserAttachment.previewUrl,
                                      "Image originale",
                                    )
                                  }
                                  className="overflow-hidden rounded-2xl border border-[var(--bc-neutral-border)] bg-white/70 text-left dark:bg-[#060d19]"
                                >
                                  <div className="border-b border-[var(--bc-neutral-border)] px-3 py-2 text-xs font-semibold text-[var(--bc-neutral-body)]">
                                    Originale
                                  </div>
                                  <img
                                    src={linkedUserAttachment.previewUrl}
                                    alt="Image originale"
                                    className="max-h-[280px] w-full object-contain"
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    openImagePreview(
                                      message.imageAnalysis?.highlightedImage || "",
                                      annotatedPanelLabel,
                                    )
                                  }
                                  className="overflow-hidden rounded-2xl border border-[var(--bc-neutral-border)] bg-white/70 text-left dark:bg-[#060d19]"
                                >
                                  <div className="border-b border-[var(--bc-neutral-border)] px-3 py-2 text-xs font-semibold text-[var(--bc-neutral-body)]">
                                    {isEquipmentAnalysis ? "Zones detectees" : isWorkflowAnalysis ? "Zones critiques" : "Annotee"}
                                  </div>
                                  <img
                                    src={message.imageAnalysis.highlightedImage}
                                    alt={annotatedPanelLabel}
                                    className="max-h-[280px] w-full object-contain"
                                  />
                                </button>
                              </div>
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && isExplainabilityLoading ? (
                            <div className="mt-3 rounded-[24px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(56,189,248,0.08),rgba(255,255,255,0.98))] px-4 py-4 shadow-[0_18px_36px_-26px_rgba(79,70,229,0.42)] dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.16),rgba(8,16,31,0.96),rgba(8,16,31,0.96))]">
                              <div className="flex items-start gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--bc-ai-border)] bg-white/85 text-[var(--bc-ai-start)] dark:bg-[#08101f]">
                                  <Brain className="h-5 w-5 animate-pulse" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                                      Lecture explicative IA
                                    </p>
                                    <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                                      Analyse en cours
                                    </Badge>
                                  </div>
                                  <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                    {xaiLoadingLabel ?? EXPLAINABILITY_STAGES[0]}
                                  </p>
                                </div>
                                <LoaderCircle className="h-4 w-4 animate-spin text-[var(--bc-ai-start)]" />
                              </div>
                              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                {EXPLAINABILITY_STAGES.map((stage) => (
                                  <div
                                    key={stage}
                                    className={cn(
                                      "rounded-[18px] border px-3 py-3 text-xs font-medium transition-colors",
                                      stage === xaiLoadingLabel
                                        ? "border-[var(--bc-ai-border)] bg-white/90 text-[var(--bc-neutral-strong)] shadow-[0_12px_24px_-18px_rgba(79,70,229,0.42)] dark:bg-[#08101f]"
                                        : "border-[var(--bc-neutral-border)] bg-white/65 text-[var(--bc-neutral-muted)] dark:bg-[#08101f]/84",
                                    )}
                                  >
                                    {stage}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {!isCompactEquipmentVisionOnly && explainabilityOpen && message.explainability ? (
                            <div className="mt-3">
                              <ExplainabilityCard
                                explanation={message.explainability}
                                onApplyRecommendation={(recommendationTitle) =>
                                  handleApplyDecisionRecommendation(recommendationTitle, null)
                                }
                              />
                            </div>
                          ) : null}

                          {message.ctaLabel && message.ctaPath ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-3 rounded-xl"
                              onClick={() => {
                                navigate(message.ctaPath);
                                handleCloseChat();
                              }}
                            >
                              <ArrowUpRight className="h-4 w-4" />
                              {message.ctaLabel}
                            </Button>
                          ) : null}
                        </article>
                      </div>
                    );
                  })}

                  <div ref={messagesEndRef} />
                </div>
              </div>
            </div>

            {errorMessage && !pendingVoiceDraft ? (
              <div className="shrink-0 border-t border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-4 py-3 text-sm text-[var(--bc-danger)]">
                {errorMessage}
              </div>
            ) : null}

            <div className="sticky bottom-0 shrink-0 border-t border-[rgba(196,181,253,0.24)] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.97))] px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-18px_36px_-28px_rgba(79,70,229,0.22)] backdrop-blur-2xl sm:px-4">
              <div className={cn(isFullscreen ? "mx-auto w-full max-w-[1180px]" : "w-full")}>
              {composerImage ? (
                <div className="mb-2.5 flex items-start gap-3 rounded-[18px] border border-[rgba(196,181,253,0.3)] bg-white/88 p-2.5 shadow-[0_16px_30px_-28px_rgba(79,70,229,0.25)] dark:bg-[#08101f]">
                  <img
                    src={composerImage.previewUrl}
                    alt={composerImage.name}
                    className="h-16 w-16 rounded-xl object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[var(--bc-neutral-strong)]">
                      {composerImage.name}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--bc-neutral-muted)]">
                        {composerImage.source === "paste"
                          ? "Image collee prete a analyser."
                        : composerImage.analysisMode === "dashboard_analysis"
                          ? "Audit dashboard: radar, KPI, desequilibres et priorites metier."
                        : composerImage.analysisMode === "advanced"
                          ? "Audit approfondi: priorisation des risques et recommandations metier."
                          : "Lecture initiale: qualification des KPI visibles et premiere priorisation."}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--bc-neutral-muted)]">
                      Taille: {formatFileSize(composerImage.originalSizeBytes) || "n/a"} {"->"}{" "}
                      {formatFileSize(composerImage.compressedSizeBytes) || "n/a"}{" "}
                      en {composerImage.compressionDurationMs} ms
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(196,181,253,0.2)]">
                      <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,#4F46E5,#38BDF8)]" />
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateComposerImageAnalysisMode("quick")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          composerImage.analysisMode === "quick"
                            ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-start)]"
                            : "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]",
                        )}
                      >
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>Lecture initiale</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateComposerImageAnalysisMode("advanced")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          composerImage.analysisMode === "advanced"
                            ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-start)]"
                            : "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]",
                        )}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Audit approfondi</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateComposerImageAnalysisMode("dashboard_analysis")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          composerImage.analysisMode === "dashboard_analysis"
                            ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-start)]"
                            : "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]",
                        )}
                      >
                        <Brain className="h-3.5 w-3.5" />
                        <span>Audit dashboard</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openImagePreview(composerImage.previewUrl, composerImage.name)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span>Preview</span>
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveComposerImage}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    aria-label="Supprimer l'image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              {composerPdf ? (
                <div className="mb-2.5 flex items-start gap-3 rounded-[18px] border border-[rgba(129,140,248,0.3)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(244,247,255,0.98),rgba(238,242,255,0.98))] p-2.5 shadow-[0_16px_30px_-28px_rgba(79,70,229,0.25)] dark:bg-[#08101f]">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#1D4ED8,#7C3AED)] text-white shadow-[0_20px_36px_-24px_rgba(79,70,229,0.48)]">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-semibold text-[var(--bc-neutral-strong)]">
                        {composerPdf.name}
                      </p>
                      <Badge variant="outline" className="px-2.5 py-1 text-[10px] font-semibold">
                        {formatDocumentTypeLabel(composerPdf.documentType)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--bc-neutral-muted)]">
                      {composerPdf.documentType === "pdf"
                        ? composerPdf.analysisMode === "dashboard_analysis"
                          ? "Audit PDF dashboard: lecture multi-pages, KPI, desequilibres et priorites."
                          : composerPdf.analysisMode === "advanced"
                            ? "Audit documentaire: extraction texte, OCR de secours et synthese metier."
                            : "Lecture initiale: qualification rapide des montants, tableaux et anomalies visibles."
                        : composerPdf.analysisMode === "dashboard_analysis"
                          ? "Audit tableur: consolidation dataframe, KPI, desequilibres et priorites."
                          : composerPdf.analysisMode === "advanced"
                            ? "Analyse dataframe: lecture pandas, couts, anomalies et recommandations metier."
                            : "Scan initial: detection des colonnes, montants, ecarts et signaux faibles."}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--bc-neutral-muted)]">
                      Type: {formatDocumentTypeLabel(composerPdf.documentType)} | Taille: {formatFileSize(composerPdf.sizeBytes) || "n/a"} | Statut: pret pour analyse
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(196,181,253,0.2)]">
                      <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,#2563EB,#7C3AED)]" />
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateComposerPdfAnalysisMode("quick")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          composerPdf.analysisMode === "quick"
                            ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-start)]"
                            : "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]",
                        )}
                      >
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>{composerPdf.documentType === "pdf" ? "Lecture PDF" : "Scan tableur"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateComposerPdfAnalysisMode("advanced")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          composerPdf.analysisMode === "advanced"
                            ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-start)]"
                            : "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]",
                        )}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{composerPdf.documentType === "pdf" ? "Audit documentaire" : "Analyse dataframe"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateComposerPdfAnalysisMode("dashboard_analysis")}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          composerPdf.analysisMode === "dashboard_analysis"
                            ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-start)]"
                            : "border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]",
                        )}
                      >
                        <Brain className="h-3.5 w-3.5" />
                        <span>{composerPdf.documentType === "pdf" ? "Audit dashboard" : "Audit tableur"}</span>
                      </button>
                      {composerPdf.documentType === "pdf" ? (
                        <button
                          type="button"
                          onClick={() => openPdfPreview(composerPdf.previewUrl, composerPdf.name)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                          <span>Preview</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveComposerPdf}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--bc-neutral-border)] bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    aria-label="Supprimer le document"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              {pendingVoiceDraft ? (
                <div className="mb-2.5 rounded-[18px] border border-[rgba(129,140,248,0.26)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(56,189,248,0.06),rgba(255,255,255,0.96))] px-3.5 py-3 shadow-[0_18px_30px_-28px_rgba(79,70,229,0.36)]">
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
                        <MicOff className="h-3.5 w-3.5" />
                        <span>Transcription indisponible</span>
                      </div>
                      <p className="mt-1 text-[13px] font-semibold text-[var(--bc-neutral-strong)]">
                        {pendingVoiceDraft.message}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-[var(--bc-neutral-muted)]">
                        L'enregistrement est conserve. Vous pouvez relancer la transcription ou envoyer l'audio sans conversion.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPendingVoiceDraft(null);
                          setErrorMessage(null);
                          void handleStartVoiceRecording();
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--bc-ai-border)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-ai-start)] transition-colors hover:bg-[var(--bc-ai-soft)]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Reessayer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleConvertPendingVoiceDraft()}
                        disabled={isVoiceFallbackConverting}
                        className="inline-flex items-center gap-2 rounded-full border border-[rgba(196,181,253,0.36)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isVoiceFallbackConverting ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Repeat className="h-3.5 w-3.5" />
                        )}
                        <span>Relancer la transcription</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSendPendingVoiceDraftWithoutTranscript()}
                        className="inline-flex items-center gap-2 rounded-full border border-[rgba(196,181,253,0.36)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)]"
                      >
                        <SendHorizontal className="h-3.5 w-3.5" />
                        <span>Envoyer sans transcription</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {false ? (
                <>
              <div className="relative mb-3 overflow-hidden rounded-[26px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(12,22,44,0.98),rgba(15,23,42,0.96),rgba(30,64,175,0.18))] px-4 py-4 text-white shadow-[0_24px_46px_-28px_rgba(37,99,235,0.55)]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.24),transparent_36%)]" />
                <button
                  type="button"
                  onClick={handleToggleVoiceRecording}
                  disabled={isVoiceTranscribing}
                  className={cn(
                    "absolute top-4 right-4 inline-flex h-16 w-16 items-center justify-center rounded-full border text-white shadow-[0_18px_32px_-18px_rgba(56,189,248,0.9)] transition-all",
                    isVoiceListening
                      ? "border-white/30 bg-[linear-gradient(135deg,#DC2626,#F97316)] animate-pulse"
                      : isVoiceSpeaking
                        ? "border-cyan-200/40 bg-[linear-gradient(135deg,#0EA5E9,#2563EB)]"
                        : "border-cyan-200/30 bg-[linear-gradient(135deg,#2563EB,#06B6D4)] hover:-translate-y-0.5",
                    isVoiceTranscribing ? "cursor-not-allowed opacity-70" : "",
                  )}
                  aria-label={isVoiceListening ? "Arreter l'ecoute vocale" : "Activer le micro vocal"}
                  title={isVoiceListening ? "Arreter l'ecoute" : "Activer le micro"}
                >
                  {isVoiceTranscribing || isVoiceThinking ? (
                    <LoaderCircle className="h-6 w-6 animate-spin" />
                  ) : isVoiceListening ? (
                    <Square className="h-5 w-5" />
                  ) : isVoiceSpeaking ? (
                    <Volume2 className="h-6 w-6" />
                  ) : (
                    <Mic className="h-6 w-6" />
                  )}
                </button>

                <div className="relative pr-20">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/78">
                    <Radio className="h-3.5 w-3.5" />
                    <span>Mode Vocal Temps Reel</span>
                  </div>
                  <p className="mt-2 text-base font-semibold text-white">{voiceStatusTitle}</p>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-200">
                    {voiceTranscriptPreview ? voiceTranscriptPreview : voiceComposerHelperText}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-cyan-50/72">
                    <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1">
                      {isContinuousVoiceMode ? "Conversation continue active" : "Conversation ponctuelle"}
                    </span>
                    <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1">
                      {isVoiceWorkflowActive ? "Session vocale active" : "Pret a ecouter"}
                    </span>
                    {voiceTranscriptConfidence !== null ? (
                      <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1">
                        Qualite audio {formatConfidenceLabel(voiceTranscriptConfidence) ?? "n/a"}
                      </span>
                    ) : null}
                    {formatVoiceDurationLabel(audioPlaybackDuration) ? (
                      <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1">
                        Duree {formatVoiceDurationLabel(audioPlaybackDuration)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="relative mt-4 flex h-16 items-end gap-1.5 rounded-[20px] border border-white/10 bg-white/[0.04] px-3 py-3">
                  {voiceVisualizerLevels.map((level, index) => (
                    <span
                      key={`voice-bar-${index}`}
                      className={cn(
                        "flex-1 rounded-full bg-[linear-gradient(180deg,rgba(125,211,252,0.98),rgba(59,130,246,0.58))] transition-all duration-150",
                        isVoiceWorkflowActive ? "opacity-100" : "opacity-70",
                      )}
                      style={{
                        height: `${Math.max(16, Math.round(level * 52))}px`,
                      }}
                    />
                  ))}
                </div>

                <div className="relative mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <button
                      type="button"
                      onClick={() => setIsContinuousVoiceMode((currentValue) => !currentValue)}
                      className={cn(
                        "inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-colors",
                        isContinuousVoiceMode
                          ? "border-cyan-200/40 bg-cyan-400/14 text-cyan-50"
                          : "border-white/10 bg-white/6 text-slate-200 hover:bg-white/10",
                      )}
                    >
                      {isContinuousVoiceMode ? <Check className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
                      <span>{isContinuousVoiceMode ? "Desactiver continu" : "Activer continu"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleCurrentAudioPlayback()}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10"
                    >
                      {audioPlaybackState === "playing" ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {audioPlaybackState === "playing"
                          ? "Pause"
                          : audioPlaybackState === "paused"
                            ? "Reprendre"
                            : "Lire / relire"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReplayLastAssistantAudio()}
                      disabled={!lastVoicePlaybackRef.current}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Repeat className="h-3.5 w-3.5" />
                      <span>Replay</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopAssistantAudioPlayback}
                      disabled={audioPlaybackState === "idle"}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Square className="h-3.5 w-3.5" />
                      <span>Stop</span>
                    </button>
                  </div>

                  <div className="grid gap-2 rounded-[20px] border border-white/10 bg-white/[0.05] px-3 py-3">
                    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-200">
                      <span className="inline-flex items-center gap-2">
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Reglages audio
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsVoiceMuted((currentValue) => !currentValue)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/8 px-2 py-1 text-[11px] font-semibold text-slate-100 transition-colors hover:bg-white/12"
                      >
                        {isVoiceMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                        <span>{isVoiceMuted ? "Activer son" : "Muet"}</span>
                      </button>
                    </div>
                    <label className="flex items-center gap-3 text-[11px] text-slate-200">
                      <span className="w-14 shrink-0 uppercase tracking-[0.14em] text-cyan-50/72">Volume</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(voicePlaybackVolume * 100)}
                        onChange={(event) =>
                          setVoicePlaybackVolume(Math.min(1, Math.max(0, Number(event.target.value) / 100)))
                        }
                        className="h-2 flex-1 accent-cyan-300"
                      />
                      <span className="w-10 text-right">{Math.round(voicePlaybackVolume * 100)}%</span>
                    </label>
                    <label className="flex items-center gap-3 text-[11px] text-slate-200">
                      <span className="w-14 shrink-0 uppercase tracking-[0.14em] text-cyan-50/72">Vitesse</span>
                      <select
                        value={String(voicePlaybackRate)}
                        onChange={(event) => setVoicePlaybackRate(Number(event.target.value))}
                        className="h-9 flex-1 rounded-xl border border-white/12 bg-slate-950/35 px-3 text-sm text-white outline-none"
                      >
                        <option value="0.9">0.9x</option>
                        <option value="1">1.0x</option>
                        <option value="1.15">1.15x</option>
                        <option value="1.3">1.3x</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <AiReportGenerationCard
                selectedReportType={selectedAiReportType}
                onSelectReportType={setSelectedAiReportType}
                onGenerate={() => void handleGenerateAiReport()}
                onPreview={() => void handlePreviewAiReport()}
                onDownload={() => void handleDownloadAiReport()}
                onShare={() => void handleShareAiReport()}
                onExport={() => void handleDownloadAiReport()}
                isGenerating={isGeneratingAiReport}
                loadingLabel={aiReportLoadingLabel}
                latestReport={aiReport}
                error={aiReportError}
                multimodalCount={executiveAnalysisCount}
                exportImageCount={executiveExportImageCount}
                hasExecutiveContext={Boolean(latestExecutiveReport)}
                hasExplainabilityContext={Boolean(latestExplainability)}
              />

              <div className="mb-3 rounded-[22px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.1),rgba(56,189,248,0.06),rgba(255,255,255,0.96))] px-3.5 py-3 shadow-[0_16px_36px_-28px_rgba(79,70,229,0.45)] dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.16),rgba(8,16,31,0.96),rgba(8,16,31,0.96))]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
                      <FileText className="h-3.5 w-3.5" />
                      <span>Mode Directeur / DSI</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-strong)]">
                      Genere un rapport executif IA avec scoring flotte, risques prioritaires, economies estimees et recommandations.
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--bc-neutral-muted)]">
                      {executiveAnalysisCount > 0
                        ? `${executiveAnalysisCount} analyse(s) multimodale(s) precedente(s) seront reutilisee(s).`
                        : "Le rapport utilisera les donnees telecom disponibles, meme sans analyse image prealable."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGenerateExecutiveReport()}
                    disabled={isBusy || isVoiceListening || isVoiceTranscribing || isVoiceThinking}
                    className="inline-flex items-center justify-center gap-2 rounded-[16px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_28px_-20px_rgba(79,70,229,0.6)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>✨ Generer rapport executif IA</span>
                  </button>
                </div>
              </div>

                </>
              ) : null}

              <form onSubmit={handleSubmit} className="flex items-end gap-2">
                <div
                  className={cn(
                    "flex-1 rounded-[22px] border bg-white/92 p-1.5 shadow-[0_18px_34px_-28px_rgba(79,70,229,0.26)] transition-all dark:shadow-none",
                    isDragOverComposer
                      ? "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)]"
                      : "border-[rgba(196,181,253,0.34)]",
                  )}
                  onDragOver={handleComposerDragOver}
                  onDragLeave={handleComposerDragLeave}
                  onDrop={(event) => void handleComposerDrop(event)}
                >
                  <Textarea
                    ref={inputRef}
                    rows={1}
                    value={inputValue}
                    onChange={(event) => handleComposerChange(event.target.value)}
                    onPaste={(event) => void handleComposerPaste(event)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Posez une question sur les lignes, forfaits ou couts..."
                    className="min-h-[46px] max-h-28 border-0 bg-transparent px-3 py-2.5 text-[13px] leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-0"
                    autoFocus={isPanelVisible}
                  />
                  <div className="flex flex-col gap-1.5 px-1.5 pb-0.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[10px] leading-4 text-[var(--bc-neutral-muted)]">
                      {voiceComposerHelperText}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleToggleVoiceRecording}
                        disabled={isVoiceTranscribing || isVoiceFallbackConverting}
                        className={cn(
                          "inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white text-[var(--bc-neutral-body)] transition-all hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]",
                          isVoiceListening
                            ? "border-[rgba(129,140,248,0.36)] bg-[linear-gradient(135deg,#7C3AED,#2563EB)] text-white shadow-[0_0_0_5px_rgba(129,140,248,0.12)] animate-pulse"
                            : voiceCaptureFeedback === "success"
                              ? "border-[rgba(56,189,248,0.36)] bg-[linear-gradient(135deg,#4F46E5,#0EA5E9)] text-white"
                              : "border-[rgba(196,181,253,0.36)]",
                        )}
                        aria-label={isVoiceListening ? "Arreter l'enregistrement vocal" : "Demarrer l'enregistrement vocal"}
                        title={isVoiceListening ? "Arreter l'enregistrement" : "Demarrer l'enregistrement"}
                      >
                        {isVoiceTranscribing || isVoiceFallbackConverting ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : isVoiceListening ? (
                          <Square className="h-4 w-4" />
                        ) : voiceCaptureFeedback === "success" ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Mic className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenImagePicker}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(196,181,253,0.36)] bg-white px-3 py-1 text-[10px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        <span>Image</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenPdfPicker}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(196,181,253,0.36)] bg-white px-3 py-1 text-[10px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Document</span>
                      </button>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => void handleImageInputChange(event)}
                      />
                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept={COMPOSER_DOCUMENT_ACCEPT}
                        className="hidden"
                        onChange={(event) => void handlePdfInputChange(event)}
                      />
                    </div>
                  </div>
                </div>

                {isBusy ? (
                  <button
                    type="button"
                    onClick={handleStopGeneration}
                    className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center self-end rounded-[16px] border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)] transition-colors hover:bg-[var(--bc-danger-soft)]/80"
                    aria-label="Arreter la generation"
                    title="Arrêter la génération"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}

                <button
                  type="submit"
                  onMouseDown={handleSendButtonPointerDown}
                  className="bc-chatbot-ripple-button relative inline-flex h-[46px] min-w-[46px] items-center justify-center overflow-hidden rounded-[17px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))] px-3 text-white shadow-[0_18px_30px_-18px_rgba(99,102,241,0.5)] transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_36px_-18px_rgba(99,102,241,0.56)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!inputValue.trim() || isVoiceListening || isVoiceTranscribing}
                  aria-label="Envoyer la question"
                >
                  {sendRipple ? (
                    <span
                      key={sendRipple.id}
                      className="bc-chatbot-ripple"
                      style={{
                        left: sendRipple.x,
                        top: sendRipple.y,
                      }}
                      onAnimationEnd={() => setSendRipple(null)}
                    />
                  ) : null}

                  <span className="relative z-[1]">
                    <SendHorizontal className="h-4 w-4" />
                  </span>
                </button>
              </form>
              </div>
            </div>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {zoomedChatImage || previewedPdfAttachment ? (
          <motion.div
            key="attachment-preview-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[180] bg-slate-950/82 backdrop-blur-xl"
            onClick={closeAttachmentPreview}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 12 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-full w-full items-center justify-center p-3 sm:p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="relative flex h-full w-full max-w-[min(1400px,100vw-24px)] flex-col overflow-hidden rounded-[28px] border border-white/12 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(246,248,255,0.95),rgba(240,244,255,0.92))] shadow-[0_36px_120px_-40px_rgba(15,23,42,0.8)] dark:bg-[linear-gradient(135deg,rgba(8,16,31,0.96),rgba(12,22,44,0.96),rgba(30,41,59,0.94))]">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--bc-neutral-strong)]">
                      {zoomedChatImage?.title || previewedPdfAttachment?.title}
                    </p>
                    <p className="text-xs text-[var(--bc-neutral-muted)]">
                      {zoomedChatImage
                        ? "Vue detaillee haute qualite. ESC ou clic externe pour fermer."
                        : "Apercu PDF multi-pages. ESC ou clic externe pour fermer."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {zoomedChatImage ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewViewerScale((currentScale) =>
                              Math.max(0.6, Number((currentScale - 0.2).toFixed(2))),
                            )
                          }
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-white dark:bg-[#08101f]"
                          aria-label="Reduire le zoom"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewViewerScale(1)}
                          className="rounded-xl border border-white/12 bg-white/80 px-3 py-2 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-white dark:bg-[#08101f]"
                        >
                          {Math.round(previewViewerScale * 100)}%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewViewerScale((currentScale) =>
                              Math.min(3, Number((currentScale + 0.2).toFixed(2))),
                            )
                          }
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-white dark:bg-[#08101f]"
                          aria-label="Augmenter le zoom"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={closeAttachmentPreview}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-white/80 text-[var(--bc-neutral-body)] transition-colors hover:bg-white dark:bg-[#08101f]"
                      aria-label="Fermer l'aperçu"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.08),transparent_38%),linear-gradient(180deg,rgba(248,250,252,0.75),rgba(241,245,249,0.95))] dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.08),transparent_36%),linear-gradient(180deg,rgba(3,7,18,0.72),rgba(8,15,28,0.95))]">
                  {isPreviewViewerLoading ? (
                    <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center p-6">
                      <div className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/10 bg-white/70 p-5 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.6)] backdrop-blur-xl dark:bg-white/5">
                        <div className="h-5 w-40 animate-pulse rounded-full bg-white/70 dark:bg-white/10" />
                        <div className="mt-5 h-[52vh] animate-pulse rounded-[24px] bg-[linear-gradient(135deg,rgba(99,102,241,0.12),rgba(56,189,248,0.08),rgba(255,255,255,0.72))] dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.2),rgba(8,16,31,0.92),rgba(8,16,31,0.92))]" />
                      </div>
                    </div>
                  ) : null}

                  {zoomedChatImage ? (
                    <div className="h-full overflow-auto p-4 sm:p-6">
                      <div className="flex min-h-full min-w-full items-start justify-center pb-8">
                        <img
                          src={zoomedChatImage.src}
                          alt={zoomedChatImage.title}
                          onLoad={() => setIsPreviewViewerLoading(false)}
                          onError={() => setIsPreviewViewerLoading(false)}
                          className="rounded-[24px] border border-white/12 bg-white/80 object-contain shadow-[0_30px_80px_-42px_rgba(15,23,42,0.72)] dark:bg-[#060d19]"
                          style={{
                            maxWidth: "none",
                            width: `${previewViewerScale * 100}%`,
                            minWidth: previewViewerScale > 1 ? `${previewViewerScale * 65}%` : undefined,
                          }}
                        />
                      </div>
                    </div>
                  ) : previewedPdfAttachment ? (
                    <div className="h-full p-2 sm:p-4">
                      <div className="h-full overflow-hidden rounded-[24px] border border-white/10 bg-white/78 shadow-[0_28px_80px_-44px_rgba(15,23,42,0.7)] dark:bg-[#08101f]">
                        <iframe
                          src={previewedPdfAttachment.src}
                          title={previewedPdfAttachment.title}
                          className="h-full w-full"
                          onLoad={() => setIsPreviewViewerLoading(false)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
