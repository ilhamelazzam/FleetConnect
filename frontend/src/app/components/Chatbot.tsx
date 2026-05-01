import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  History,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { useAuth } from "../context/AuthContext";
import {
  assistantQuestionSuggestions,
  generateTelecomAssistantReply,
  type TelecomAssistantContextMessage,
  type TelecomAssistantReply,
} from "../lib/chatbot-engine";
import {
  loadTelecomAssistantDataset,
  type TelecomAssistantDataset,
} from "../lib/chatbot-data";
import {
  collectRecentTelecomPrompts,
  createTelecomConversation,
  DEFAULT_CONVERSATION_TITLE,
  deriveTelecomConversationTitle,
  loadStoredTelecomChatState,
  saveStoredTelecomChatState,
  sortTelecomConversations,
  type TelecomChatConversation,
  type TelecomChatMessage,
} from "../lib/chatbot-storage";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "./ui/utils";

const CONVERSATION_PAGE_SIZE = 10;
const INITIAL_VISIBLE_MESSAGE_COUNT = 14;
const VISIBLE_MESSAGE_STEP = 12;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
    id: `assistant-welcome-${crypto.randomUUID()}`,
    role: "assistant",
    text: firstName
      ? `Bonjour ${firstName}. Je peux vous aider a analyser votre flotte telecom.`
      : "Je peux vous aider a analyser votre flotte telecom.",
    createdAt,
    bullets: [
      "Budget operateur et departement",
      "Etat des lignes libres ou critiques",
      "Forfaits trop chers et optimisations",
      "Explication des alertes IA",
    ],
    recommendation: "Posez une question metier courte ou utilisez une suggestion ci-dessous.",
    sources: ["Memoire locale de l'assistant initialisee"],
    linkedUserMessageId: null,
  };
}

function buildAssistantMessage(
  reply: TelecomAssistantReply,
  linkedUserMessageId: string,
  existingMessageId?: string,
): TelecomChatMessage {
  return {
    id: existingMessageId ?? `assistant-${crypto.randomUUID()}`,
    role: "assistant",
    text: reply.text,
    createdAt: new Date().toISOString(),
    bullets: reply.bullets,
    recommendation: reply.recommendation,
    ctaLabel: reply.ctaLabel,
    ctaPath: reply.ctaPath,
    sources: reply.sources,
    linkedUserMessageId,
  };
}

function buildFallbackAssistantMessage(): TelecomChatMessage {
  return {
    id: `assistant-error-${crypto.randomUUID()}`,
    role: "assistant",
    text: "Je n'ai pas pu charger le contexte metier complet.",
    createdAt: new Date().toISOString(),
    bullets: [
      "Verifier la disponibilite des APIs lignes, forfaits et alertes",
      "Relancer ensuite l'assistant",
    ],
    recommendation:
      "Si besoin, je peux toujours repondre avec le contexte mock de demonstration.",
    sources: ["Fallback assistant"],
    linkedUserMessageId: null,
  };
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
      "Explique-moi les alertes IA",
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
    if (!normalizedValue || uniqueValues.has(normalizedValue)) {
      return;
    }

    uniqueValues.add(normalizedValue);
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

  const previewText = previewMessage.role === "user"
    ? previewMessage.text
    : previewMessage.recommendation || previewMessage.text;

  return previewText.length > 68 ? `${previewText.slice(0, 68).trim()}...` : previewText;
}

function serializeMessageForCopy(message: TelecomChatMessage): string {
  return [
    message.text,
    ...(message.bullets ?? []),
    message.recommendation ? `Recommandation: ${message.recommendation}` : null,
    ...(message.sources ?? []).map((source) => `Source: ${source}`),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}

export default function Chatbot() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, user } = useAuth();
  const chatScope = useMemo(() => buildChatScope(user?.id), [user?.id]);
  const firstName = useMemo(
    () => user?.full_name?.trim().split(/\s+/)[0] ?? null,
    [user?.full_name],
  );

  const [isOpen, setIsOpen] = useState(false);
  const [isHistoryOpenOnMobile, setIsHistoryOpenOnMobile] = useState(false);
  const [inputValue, setInputValue] = useState("");
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
  const [thinkingConversationId, setThinkingConversationId] = useState<string | null>(null);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedSourceMessageIds, setExpandedSourceMessageIds] = useState<string[]>([]);
  const [sendRipple, setSendRipple] = useState<{ id: number; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const hasHydratedRef = useRef(false);
  const scrollModeRef = useRef<"bottom" | "none">("bottom");

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
    setSuggestions(assistantQuestionSuggestions);
    setInputValue("");
    hasHydratedRef.current = true;
  }, [chatScope, firstName]);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      return;
    }

    saveStoredTelecomChatState(chatScope, {
      lastConversationId: activeConversationId,
      conversations,
    });
  }, [activeConversationId, chatScope, conversations]);

  useEffect(() => {
    setDataset(null);
  }, [token]);

  useEffect(() => {
    if (!isOpen || dataset || isDatasetLoading) {
      return;
    }

    void ensureDatasetLoaded();
  }, [dataset, ensureDatasetLoaded, isDatasetLoading, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 160);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeConversationId, isOpen]);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) ??
      conversations[0] ??
      null,
    [activeConversationId, conversations],
  );

  const visibleMessages = useMemo(() => {
    if (!activeConversation) {
      return [];
    }

    return activeConversation.messages.slice(-visibleMessageCount);
  }, [activeConversation, visibleMessageCount]);

  useEffect(() => {
    if (!isOpen) {
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
  }, [activeConversationId, isOpen, thinkingConversationId, visibleMessages.length]);

  const helperBadges = useMemo(() => {
    if (!dataset) {
      return ["Contexte en preparation", "Lignes", "Forfaits", "Alertes IA"];
    }

    return [
      `${dataset.occupationStats.total_libre} lignes libres`,
      `${dataset.lineStats.critical_ai_alerts} alertes critiques`,
      `${dataset.recommendations.length} recos IA`,
      dataset.usingMock ? "Mode hybride" : "Donnees temps reel",
    ];
  }, [dataset]);

  const freshnessLabel = useMemo(() => {
    if (!dataset) {
      return "Preparation du contexte metier";
    }

    return dataset.usingMock
      ? "Sources mixtes : API + fallback local"
      : "Source : API metier en temps reel";
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
  const isBusy =
    thinkingConversationId !== null || regeneratingMessageId !== null || isDatasetLoading;

  const handleRefreshDataset = async () => {
    try {
      const refreshedDataset = await ensureDatasetLoaded(true);
      toast.success("Contexte chatbot actualise", {
        description: refreshedDataset.usingMock
          ? "Le contexte a ete recharge en mode hybride."
          : "Le contexte temps reel a ete recharge.",
      });
    } catch {
      toast.error("Actualisation impossible", {
        description: "Le contexte metier n'a pas pu etre recharge.",
      });
    }
  };

  const handleCreateConversation = useCallback(() => {
    const nextConversation = createTelecomConversation(buildWelcomeMessage(firstName));
    scrollModeRef.current = "bottom";

    startTransition(() => {
      setConversations((currentConversations) =>
        upsertConversation(currentConversations, nextConversation),
      );
      setActiveConversationId(nextConversation.id);
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
      setExpandedSourceMessageIds([]);
      setSuggestions(contextualSuggestions);
      setInputValue("");
      setIsOpen(true);
      setIsHistoryOpenOnMobile(false);
    });
  }, [contextualSuggestions, firstName]);

  const handleSelectConversation = (conversationId: string) => {
    scrollModeRef.current = "bottom";
    setActiveConversationId(conversationId);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
    setExpandedSourceMessageIds([]);
    setIsHistoryOpenOnMobile(false);
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

  const handleSendQuestion = async (question: string) => {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion || isBusy) {
      return;
    }

    const activeOrNewConversation =
      activeConversation ?? createTelecomConversation(buildWelcomeMessage(firstName));
    const now = new Date().toISOString();
    const userMessage: TelecomChatMessage = {
      id: `user-${crypto.randomUUID()}`,
      role: "user",
      text: trimmedQuestion,
      createdAt: now,
    };
    const priorContextMessages: TelecomAssistantContextMessage[] =
      activeOrNewConversation.messages.map((message) => ({
        role: message.role,
        text: message.text,
      }));
    const provisionalConversationTitle =
      activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
        ? deriveTelecomConversationTitle(trimmedQuestion)
        : activeOrNewConversation.title;
    const nextConversation: TelecomChatConversation = {
      ...activeOrNewConversation,
      title: provisionalConversationTitle,
      updatedAt: now,
      messages: [...activeOrNewConversation.messages, userMessage],
    };

    scrollModeRef.current = "bottom";
    setInputValue("");
    setErrorMessage(null);
    setIsOpen(true);
    setIsHistoryOpenOnMobile(false);

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

    try {
      const activeDataset = await ensureDatasetLoaded();
      await wait(420);
      const reply = generateTelecomAssistantReply(
        trimmedQuestion,
        activeDataset,
        priorContextMessages,
      );
      const assistantMessage = buildAssistantMessage(reply, userMessage.id);
      const resolvedConversationTitle =
        activeOrNewConversation.title === DEFAULT_CONVERSATION_TITLE
          ? deriveTelecomConversationTitle(trimmedQuestion, reply.titleHint)
          : activeOrNewConversation.title;

      startTransition(() => {
        setConversations((currentConversations) => {
          const currentConversation =
            currentConversations.find(
              (conversation) => conversation.id === nextConversation.id,
            ) ?? nextConversation;

          return upsertConversation(currentConversations, {
            ...currentConversation,
            title: resolvedConversationTitle,
            updatedAt: assistantMessage.createdAt,
            messages: [...currentConversation.messages, assistantMessage],
          });
        });
        setSuggestions(reply.suggestions);
      });
    } catch {
      const fallbackMessage = buildFallbackAssistantMessage();

      startTransition(() => {
        setConversations((currentConversations) => {
          const currentConversation =
            currentConversations.find(
              (conversation) => conversation.id === nextConversation.id,
            ) ?? nextConversation;

          return upsertConversation(currentConversations, {
            ...currentConversation,
            updatedAt: fallbackMessage.createdAt,
            messages: [...currentConversation.messages, fallbackMessage],
          });
        });
      });
    } finally {
      setThinkingConversationId(null);
    }
  };

  const handleRegenerateMessage = async (messageId: string) => {
    if (!activeConversation || thinkingConversationId !== null || regeneratingMessageId !== null) {
      return;
    }

    const targetMessage = activeConversation.messages.find(
      (message) => message.id === messageId && message.role === "assistant",
    );
    const linkedUserMessage = activeConversation.messages.find(
      (message) => message.id === targetMessage?.linkedUserMessageId,
    );

    if (!targetMessage || !linkedUserMessage) {
      return;
    }

    const linkedUserIndex = activeConversation.messages.findIndex(
      (message) => message.id === linkedUserMessage.id,
    );
    const contextMessages: TelecomAssistantContextMessage[] =
      activeConversation.messages.slice(0, linkedUserIndex).map((message) => ({
        role: message.role,
        text: message.text,
      }));

    setRegeneratingMessageId(messageId);
    scrollModeRef.current = "bottom";

    try {
      const activeDataset = await ensureDatasetLoaded();
      await wait(320);
      const reply = generateTelecomAssistantReply(
        linkedUserMessage.text,
        activeDataset,
        contextMessages,
      );
      const regeneratedMessage = buildAssistantMessage(
        reply,
        linkedUserMessage.id,
        targetMessage.id,
      );

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
            updatedAt: regeneratedMessage.createdAt,
            messages: currentConversation.messages.map((message) =>
              message.id === messageId ? regeneratedMessage : message,
            ),
          });
        });
        setSuggestions(reply.suggestions);
      });
    } catch {
      toast.error("Regeneration impossible", {
        description: "La reponse n'a pas pu etre regeneree pour le moment.",
      });
    } finally {
      setRegeneratingMessageId(null);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (!isOpen) {
      setIsOpen(true);
    }

    void handleSendQuestion(suggestion);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  return (
    <>
      <div className="pointer-events-none fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[70] flex items-end justify-end md:right-5 md:bottom-[calc(env(safe-area-inset-bottom)+5rem)]">
        <button
          type="button"
          onClick={() => {
            setIsOpen((currentValue) => !currentValue);
            setIsHistoryOpenOnMobile(false);
          }}
          className={cn(
            "pointer-events-auto inline-flex items-center gap-3 rounded-full border border-[var(--bc-ai-border)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_45px_rgba(99,102,241,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_52px_rgba(99,102,241,0.34)]",
            "bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))]",
          )}
          aria-label={isOpen ? "Fermer l'assistant IA" : "Ouvrir l'assistant IA"}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/14">
            {isOpen ? <X className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
          </span>
          <span>Assistant IA</span>
        </button>
      </div>

      <div
        className={cn(
          "fixed inset-3 z-[69] transition-all duration-300 md:inset-auto md:right-5 md:bottom-[calc(env(safe-area-inset-bottom)+9rem)] md:h-[min(82vh,760px)] md:w-[min(96vw,980px)]",
          isOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0",
        )}
      >
        <section className="flex h-full min-h-0 overflow-hidden rounded-[32px] border border-[var(--bc-neutral-border)] bg-white/95 shadow-[0_30px_90px_rgba(2,6,23,0.24)] backdrop-blur-xl dark:bg-[rgba(8,16,31,0.96)]">
          <aside
            className={cn(
              "absolute inset-y-0 left-0 z-20 flex w-[280px] min-h-0 flex-col border-r border-[var(--bc-neutral-border)] bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.95))] transition-transform duration-300 md:static md:translate-x-0 dark:bg-[linear-gradient(180deg,rgba(8,16,31,0.98),rgba(15,23,42,0.96))]",
              isHistoryOpenOnMobile ? "translate-x-0" : "-translate-x-[102%] md:translate-x-0",
            )}
          >
            <div className="border-b border-[var(--bc-neutral-border)] px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--bc-ai-start)]">
                    Conversations
                  </p>
                  <p className="mt-2 text-sm text-[var(--bc-neutral-body)]">
                    Historique persistant et reprise automatique de contexte.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsHistoryOpenOnMobile(false)}
                  className="rounded-xl border border-[var(--bc-neutral-border)] bg-white/90 p-2 text-[var(--bc-neutral-body)] md:hidden dark:bg-[#08101f]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleCreateConversation}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--bc-primary)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_-18px_rgba(37,99,235,0.52)] transition-all hover:-translate-y-0.5 hover:bg-[var(--bc-primary-hover)]"
              >
                <Plus className="h-4 w-4" />
                <span>Nouvelle discussion</span>
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              <div className="space-y-3">
                {visibleConversations.map((conversation) => {
                  const isActive = conversation.id === activeConversation?.id;

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => handleSelectConversation(conversation.id)}
                      className={cn(
                        "w-full rounded-[22px] border px-4 py-3 text-left transition-all",
                        isActive
                          ? "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] shadow-[0_18px_34px_-28px_rgba(37,99,235,0.4)]"
                          : "border-[var(--bc-neutral-border)] bg-white/90 hover:-translate-y-0.5 hover:border-[var(--bc-primary-border)] hover:bg-[var(--bc-primary-soft)] dark:bg-[#08101f]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="line-clamp-2 text-sm font-semibold text-[var(--bc-neutral-strong)]">
                          {conversation.title}
                        </p>
                        <span className="rounded-full bg-white/80 px-2 py-1 text-[11px] font-semibold text-[var(--bc-neutral-body)] dark:bg-[#020617]">
                          {conversation.messages.length}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--bc-neutral-body)]">
                        {buildConversationPreview(conversation)}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--bc-neutral-muted)]">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>{formatConversationDate(conversation.updatedAt)}</span>
                      </div>
                    </button>
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
                  className="mt-4 w-full rounded-2xl border border-[var(--bc-neutral-border)] bg-white/90 px-4 py-3 text-sm font-medium text-[var(--bc-neutral-body)] transition-all hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                >
                  Afficher plus
                </button>
              ) : null}
            </div>
          </aside>

          {isHistoryOpenOnMobile ? (
            <button
              type="button"
              onClick={() => setIsHistoryOpenOnMobile(false)}
              className="absolute inset-0 z-10 bg-slate-950/30 md:hidden"
              aria-label="Fermer l'historique mobile"
            />
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-[var(--bc-neutral-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.18),rgba(59,130,246,0.12),var(--bg-card))] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setIsHistoryOpenOnMobile(true)}
                      className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white/85 p-2 text-[var(--bc-neutral-body)] md:hidden dark:bg-[#08101f]"
                    >
                      <History className="h-4 w-4" />
                    </button>
                    <span className="bc-gradient-ai flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-[0_14px_28px_rgba(99,102,241,0.26)]">
                      <Bot className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        {activeConversation?.title ?? "Assistant IA metier"}
                      </p>
                      <p className="truncate text-xs text-[var(--bc-neutral-body)]">
                        {firstName ? `Bonjour ${firstName}` : "Analyse flotte telecom"}
                        {activeConversation ? ` · ${formatConversationDate(activeConversation.updatedAt)}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--bc-neutral-body)]">
                    Assistant moderne, persistant et contextuel pour vos lignes, couts, alertes
                    et recommandations telecom.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-xl"
                    onClick={() => void handleRefreshDataset()}
                    disabled={isBusy}
                  >
                    {isDatasetLoading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-xl"
                    onClick={handleCreateConversation}
                    disabled={isBusy}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-xl"
                    onClick={() => setIsOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {helperBadges.map((badge) => (
                  <Badge key={badge} variant="outline" className="bg-[var(--card)]/90">
                    {badge}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="border-b border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/55 px-5 py-2 text-xs text-[var(--bc-neutral-body)]">
              {freshnessLabel}
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-[var(--bc-neutral-border)] px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {visibleSuggestions.slice(0, 6).map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="inline-flex items-center rounded-full border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--bc-ai-start)] transition-colors hover:bg-[rgba(99,102,241,0.18)]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>

                {recentQuestionChips.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                      Questions recentes
                    </span>
                    {recentQuestionChips.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => handleSuggestionClick(prompt)}
                        className="rounded-full border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-1.5 text-xs font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div
                ref={viewportRef}
                className="bc-chatbot-scroll flex-1 min-h-0 overflow-y-auto px-5 py-5"
              >
                {hasOlderMessages ? (
                  <div className="mb-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        scrollModeRef.current = "none";
                        setVisibleMessageCount(
                          (currentCount) => currentCount + VISIBLE_MESSAGE_STEP,
                        );
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--bc-neutral-border)] bg-white/90 px-4 py-2 text-xs font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#08101f]"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                      <span>Charger les messages precedents</span>
                    </button>
                  </div>
                ) : null}

                <div className="space-y-4">
                  {visibleMessages.map((message) => {
                    const isAssistant = message.role === "assistant";
                    const sourcesOpen = expandedSourceMessageIds.includes(message.id);
                    const canRegenerate =
                      Boolean(message.linkedUserMessageId) && message.role === "assistant";

                    return (
                      <div
                        key={message.id}
                        className={cn(
                          "flex",
                          isAssistant ? "justify-start" : "justify-end",
                        )}
                      >
                        <article
                          className={cn(
                            "bc-chatbot-message max-w-[96%] rounded-[24px] border px-4 py-3 shadow-[0_18px_38px_-28px_rgba(15,23,42,0.25)] md:max-w-[88%]",
                            isAssistant
                              ? "bc-chatbot-message-assistant border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(245,243,255,0.94),rgba(255,255,255,0.96))] text-[var(--bc-neutral-strong)] dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.18),rgba(8,16,31,0.96))]"
                              : "bc-chatbot-message-user border-[var(--bc-primary-border)] bg-[linear-gradient(135deg,var(--bc-primary),var(--bc-ai-start))] text-white",
                          )}
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div
                              className={cn(
                                "inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]",
                                isAssistant
                                  ? "text-[var(--bc-ai-start)]"
                                  : "text-white/80",
                              )}
                            >
                              {isAssistant ? (
                                <>
                                  <Sparkles className="h-3.5 w-3.5" />
                                  <span>Assistant IA</span>
                                </>
                              ) : (
                                <span>Vous</span>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-[11px]",
                                isAssistant
                                  ? "text-[var(--bc-neutral-muted)]"
                                  : "text-white/70",
                              )}
                            >
                              {formatMessageTimestamp(message.createdAt)}
                            </span>
                          </div>

                          <p
                            className={cn(
                              "text-sm leading-6",
                              isAssistant
                                ? "text-[var(--bc-neutral-strong)]"
                                : "text-white",
                            )}
                          >
                            {message.text}
                          </p>

                          {message.bullets && message.bullets.length > 0 ? (
                            <ul
                              className={cn(
                                "mt-3 space-y-2 text-sm leading-6",
                                isAssistant
                                  ? "text-[var(--bc-neutral-body)]"
                                  : "text-white/90",
                              )}
                            >
                              {message.bullets.map((bullet) => (
                                <li key={bullet} className="flex gap-2">
                                  <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-current" />
                                  <span>{bullet}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {message.recommendation ? (
                            <div className="mt-3 rounded-2xl border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.05),var(--bg-card))] px-3 py-3">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
                                <Sparkles className="h-3.5 w-3.5" />
                                <span>Recommandation</span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-strong)]">
                                {message.recommendation}
                              </p>
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
                              {canRegenerate ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRegenerateMessage(message.id)}
                                  disabled={isBusy}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#08101f]"
                                >
                                  {regeneratingMessageId === message.id ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                  <span>Regenerer</span>
                                </button>
                              ) : null}
                              {message.sources && message.sources.length > 0 ? (
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
                          ) : null}

                          {sourcesOpen && message.sources && message.sources.length > 0 ? (
                            <div className="mt-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white/80 px-3 py-3 dark:bg-[#08101f]">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                Sources IA
                              </p>
                              <ul className="mt-2 space-y-2 text-xs leading-5 text-[var(--bc-neutral-body)]">
                                {message.sources.map((source) => (
                                  <li key={source} className="flex gap-2">
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                                    <span>{source}</span>
                                  </li>
                                ))}
                              </ul>
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
                                setIsOpen(false);
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

                  {thinkingConversationId === activeConversation?.id ? (
                    <div className="flex justify-start">
                      <article className="bc-chatbot-message bc-chatbot-message-assistant max-w-[88%] rounded-[24px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(245,243,255,0.94),rgba(255,255,255,0.96))] px-4 py-3 shadow-[0_18px_38px_-28px_rgba(15,23,42,0.25)] dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.18),rgba(8,16,31,0.96))]">
                        <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          <span>Assistant IA...</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-[var(--bc-neutral-body)]">
                          <span>Analyse du contexte</span>
                          <span className="bc-chatbot-typing-dot" />
                          <span className="bc-chatbot-typing-dot [animation-delay:140ms]" />
                          <span className="bc-chatbot-typing-dot [animation-delay:280ms]" />
                        </div>
                      </article>
                    </div>
                  ) : null}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {errorMessage ? (
                <div className="border-t border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-5 py-3 text-sm text-[var(--bc-danger)]">
                  {errorMessage}
                </div>
              ) : null}

              <div className="border-t border-[var(--bc-neutral-border)] px-5 py-4">
                <form onSubmit={handleSubmit} className="flex items-center gap-3">
                  <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    placeholder="Ex: Pourquoi Maroc Telecom est en depassement ?"
                    className="h-12 rounded-2xl"
                    disabled={thinkingConversationId !== null}
                    autoFocus={isOpen}
                  />

                  <button
                    type="submit"
                    onMouseDown={handleSendButtonPointerDown}
                    className="bc-chatbot-ripple-button relative inline-flex h-12 min-w-12 items-center justify-center overflow-hidden rounded-2xl border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,var(--bc-ai-start),var(--bc-ai-end))] px-4 text-white shadow-[0_18px_36px_-18px_rgba(99,102,241,0.5)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_44px_-20px_rgba(99,102,241,0.52)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!inputValue.trim() || thinkingConversationId !== null}
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
                      {thinkingConversationId !== null ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <SendHorizontal className="h-4 w-4" />
                      )}
                    </span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
