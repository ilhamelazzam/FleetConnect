export type TelecomChatRole = "assistant" | "user";

export interface TelecomChatMessage {
  id: string;
  role: TelecomChatRole;
  text: string;
  createdAt: string;
  bullets?: string[];
  recommendation?: string;
  ctaLabel?: string;
  ctaPath?: string;
  sources?: string[];
  linkedUserMessageId?: string | null;
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

function sanitizeMessage(rawValue: unknown): TelecomChatMessage | null {
  if (!isObjectLike(rawValue)) {
    return null;
  }

  if (typeof rawValue.id !== "string" || typeof rawValue.text !== "string") {
    return null;
  }

  const role = rawValue.role === "user" ? "user" : "assistant";

  return {
    id: rawValue.id,
    role,
    text: rawValue.text,
    createdAt: normalizeIsoDate(rawValue.createdAt),
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
  const nextConversations = sortTelecomConversations(state.conversations).slice(
    0,
    MAX_STORED_CONVERSATIONS,
  );
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
    id: crypto.randomUUID(),
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
