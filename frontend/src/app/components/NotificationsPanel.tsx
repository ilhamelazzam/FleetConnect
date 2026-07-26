import {
  AlertTriangle,
  Bell,
  Brain,
  CheckCircle2,
  Info,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { useNotifications } from "../context/NotificationsContext";
import type { ApiNotification, ApiNotificationFilter, ApiNotificationType } from "../lib/api";

const notificationFilters: Array<{ value: ApiNotificationFilter; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "alerts", label: "Alertes" },
  { value: "ai", label: "IA" },
  { value: "system", label: "Systeme" },
];

function getTypeClasses(type: ApiNotificationType): { dot: string; badge: string; icon: typeof Info } {
  if (type === "alert") {
    return {
      dot: "bg-[var(--bc-danger)]",
      badge: "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]",
      icon: AlertTriangle,
    };
  }
  if (type === "warning") {
    return {
      dot: "bg-[var(--bc-warning)]",
      badge: "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]",
      icon: AlertTriangle,
    };
  }
  if (type === "success") {
    return {
      dot: "bg-[var(--bc-success)]",
      badge: "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]",
      icon: CheckCircle2,
    };
  }
  if (type === "ai") {
    return {
      dot: "bc-gradient-ai",
      badge: "border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] text-[var(--bc-ai-end)]",
      icon: Brain,
    };
  }
  return {
    dot: "bg-[var(--bc-primary)]",
    badge: "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]",
    icon: Info,
  };
}

function formatNotificationType(type: ApiNotificationType): string {
  if (type === "alert") return "Alerte";
  if (type === "warning") return "Warning";
  if (type === "success") return "Succes";
  if (type === "ai") return "IA";
  return "Info";
}

function formatPriority(priority: string): string {
  if (priority === "critical") return "Critique";
  if (priority === "high") return "Eleve";
  if (priority === "medium") return "Moyen";
  return "Faible";
}

function formatRelativeTime(value: string): string {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }
  return formatDistanceToNow(parsedDate, { addSuffix: true, locale: fr });
}

function getPanelPosition(anchorRect: DOMRect | null) {
  if (typeof window === "undefined") {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isMobile = viewportWidth < 640;
  const maxPanelHeight = Math.min(Math.floor(viewportHeight * 0.7), 720);
  const preferredTop = (anchorRect?.bottom ?? 64) + 12;
  const top = Math.max(16, Math.min(preferredTop, viewportHeight - maxPanelHeight - 16));

  if (isMobile) {
    return {
      top,
      left: "50%",
      right: "auto",
      transform: "translateX(-50%)",
    } as const;
  }

  return {
    top,
    left: "auto",
    right: Math.max(16, viewportWidth - (anchorRect?.right ?? viewportWidth - 16)),
    transform: "none",
  } as const;
}

interface NotificationsPanelProps {
  isOpen: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
}

export default function NotificationsPanel({
  isOpen,
  anchorRect,
  onClose,
}: NotificationsPanelProps) {
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    totalCount,
    activeFilter,
    isLoading,
    errorMessage,
    setActiveFilter,
    refreshNotifications,
    markAsRead,
    deleteNotification,
  } = useNotifications();
  const [showAll, setShowAll] = useState(false);

  const visibleNotifications = useMemo(
    () => (showAll ? notifications.slice(0, 20) : notifications.slice(0, 5)),
    [notifications, showAll],
  );

  const panelPosition = useMemo(() => getPanelPosition(anchorRect), [anchorRect, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setShowAll(false);
    }
  }, [isOpen]);

  async function handleOpenNotification(notification: ApiNotification) {
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }
    if (notification.link_url) {
      navigate(notification.link_url);
      onClose();
    }
  }

  if (!isOpen || typeof document === "undefined" || panelPosition === null) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[10020]">
      <button
        type="button"
        className="absolute inset-0 bg-black/10 backdrop-blur-[1px] sm:bg-transparent sm:backdrop-blur-0"
        onClick={onClose}
        aria-label="Fermer le panneau de notifications"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-panel-title"
        className="fixed z-[10021] w-[min(90vw,30rem)] overflow-hidden rounded-[28px] border border-[var(--bc-neutral-border)] bg-white shadow-[0_32px_90px_-32px_rgba(15,23,42,0.42)] transition-colors duration-300 dark:bg-[#08101f]"
        style={panelPosition}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex max-h-[70vh] min-h-0 flex-col">
          <div className="border-b border-[var(--bc-neutral-border)] bg-[linear-gradient(135deg,#F8FBFF_0%,#FFFFFF_65%,#EEF4FF_100%)] px-5 py-4 dark:bg-[linear-gradient(135deg,#08101f_0%,#0f172a_100%)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id="notifications-panel-title"
                  className="text-xl font-semibold tracking-[-0.03em] text-[var(--bc-neutral-strong)]"
                >
                  Notifications intelligentes
                </h3>
                <p className="mt-1 text-xs text-[var(--bc-neutral-body)]">
                  {unreadCount} non lues sur {totalCount} evenements
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshNotifications()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--bc-neutral-border)] bg-white/90 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] hover:text-[var(--bc-primary)] dark:bg-[#0f172a]"
                  aria-label="Actualiser les notifications"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--bc-neutral-border)] bg-white/90 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] hover:text-[var(--bc-neutral-strong)] dark:bg-[#0f172a]"
                  aria-label="Fermer les notifications"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {notificationFilters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => {
                    setShowAll(false);
                    setActiveFilter(filter.value);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeFilter === filter.value
                      ? "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]"
                      : "border-[var(--bc-neutral-border)] bg-white text-[var(--bc-neutral-body)] hover:bg-[var(--bc-neutral-soft)] dark:bg-[#0f172a]"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {errorMessage ? (
              <div className="m-4 rounded-2xl border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-4 py-3 text-sm text-[var(--bc-danger)]">
                {errorMessage}
              </div>
            ) : null}

            {!errorMessage && visibleNotifications.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]">
                  <Bell className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-medium text-[var(--bc-neutral-strong)]">
                  Aucune notification pour le moment
                </p>
                <p className="mt-2 text-sm text-[var(--bc-neutral-body)]">
                  Les nouvelles alertes, suggestions et informations apparaitront ici.
                </p>
              </div>
            ) : null}

            {visibleNotifications.map((notification) => {
              const styles = getTypeClasses(notification.type);
              const Icon = styles.icon;

              return (
                <div
                  key={notification.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void handleOpenNotification(notification)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleOpenNotification(notification);
                    }
                  }}
                  className={`border-b border-[var(--bc-neutral-border)] px-5 py-4 text-left transition-all hover:bg-[var(--bc-neutral-soft)] ${
                    notification.is_read ? "bg-white dark:bg-[#08101f]" : "bg-blue-50/45 dark:bg-[#0b1730]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 rounded-2xl border p-2 ${styles.badge}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
                        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-neutral-body)]">
                          {formatNotificationType(notification.type)}
                        </span>
                        <span className="rounded-full bg-[var(--bc-neutral-soft)] px-2 py-0.5 text-xs font-medium text-[var(--bc-neutral-body)]">
                          {formatPriority(notification.priority)}
                        </span>
                        {!notification.is_read ? (
                          <span className="rounded-full bg-[var(--bc-danger)] px-2 py-0.5 text-xs font-medium text-white">
                            Non lu
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 font-semibold text-[var(--bc-neutral-strong)]">
                        {notification.title}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                        {notification.message}
                      </p>
                      {notification.ai_recommendation ? (
                        <div className="mt-3 rounded-2xl border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] p-3">
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-ai-start)]">
                            <Brain className="h-3.5 w-3.5" />
                            <span>Suggestion</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-strong)]">
                            {notification.ai_recommendation}
                          </p>
                          {notification.action_suggeree ? (
                            <p className="mt-1 text-sm leading-6 text-[var(--bc-neutral-body)]">
                              {notification.action_suggeree}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-[var(--bc-neutral-body)]">
                          {formatRelativeTime(notification.timestamp)}
                        </span>
                        <div className="flex items-center gap-2">
                          {!notification.is_read ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void markAsRead(notification.id);
                              }}
                              className="rounded-xl border border-[var(--bc-neutral-border)] px-2.5 py-1 text-xs font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-white dark:hover:bg-[#0f172a]"
                            >
                              Marquer comme lu
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteNotification(notification.id);
                            }}
                            className="rounded-xl border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-2.5 py-1 text-xs font-medium text-[var(--bc-danger)] transition-colors hover:brightness-[0.98]"
                            aria-label="Supprimer la notification"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-[var(--bc-neutral-border)] bg-white/95 p-3 text-center transition-colors duration-300 dark:bg-[#08101f]/95">
            <button
              type="button"
              onClick={() => setShowAll((currentValue) => !currentValue)}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[var(--bc-primary)] transition-colors hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary-hover)]"
            >
              <Bell className="h-4 w-4" />
              {showAll ? "Afficher les 5 dernieres" : "Voir toutes les notifications"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
