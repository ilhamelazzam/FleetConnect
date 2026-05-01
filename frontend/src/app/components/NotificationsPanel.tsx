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
import { useMemo, useState } from "react";
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

interface NotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationsPanel({ isOpen, onClose }: NotificationsPanelProps) {
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

  async function handleOpenNotification(notification: ApiNotification) {
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }
    if (notification.link_url) {
      navigate(notification.link_url);
      onClose();
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute right-0 mt-2 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl z-50">
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-[#0F172A]">Notifications intelligentes</h3>
            <p className="mt-1 text-xs text-[#64748B]">
              {unreadCount} non lues sur {totalCount} evenements
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void refreshNotifications()}
              className="rounded-lg p-1.5 text-[#64748B] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A]"
              aria-label="Actualiser les notifications"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#64748B] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A]"
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
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeFilter === filter.value
                  ? "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]"
                  : "border-gray-200 bg-white text-[#64748B] hover:bg-[#F8FAFC]"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[520px] overflow-y-auto">
        {errorMessage ? (
          <div className="m-4 rounded-lg border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-4 py-3 text-sm text-[var(--bc-danger)]">
            {errorMessage}
          </div>
        ) : null}

        {!errorMessage && visibleNotifications.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#64748B]">
            Aucune notification pour ce filtre.
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
              className={`border-b border-gray-100 p-4 text-left transition-all hover:bg-[#F8FAFC] ${
                notification.is_read ? "bg-white" : "bg-blue-50/45"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-1 rounded-lg p-2 ${styles.badge}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                      {formatNotificationType(notification.type)}
                    </span>
                    <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-medium text-[#475569]">
                      {formatPriority(notification.priority)}
                    </span>
                    {!notification.is_read ? (
                      <span className="rounded-full bg-[var(--bc-danger)] px-2 py-0.5 text-xs font-medium text-white">
                        Non lu
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 font-semibold text-[#0F172A]">{notification.title}</p>
                  <p className="mt-1 text-sm leading-6 text-[#475569]">{notification.message}</p>
                  {notification.ai_recommendation ? (
                    <div className="mt-3 rounded-lg border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-ai-start)]">
                        <Brain className="h-3.5 w-3.5" />
                        <span>Recommandation IA</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[#0F172A]">
                        {notification.ai_recommendation}
                      </p>
                      {notification.action_suggeree ? (
                        <p className="mt-1 text-sm leading-6 text-[#475569]">
                          {notification.action_suggeree}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[#64748B]">
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
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-[#475569] hover:bg-white"
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
                        className="rounded-lg border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-2.5 py-1 text-xs font-medium text-[var(--bc-danger)] hover:bg-red-100"
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

      <div className="border-t border-gray-200 p-3 text-center">
        <button
          type="button"
          onClick={() => setShowAll((currentValue) => !currentValue)}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--bc-primary)] transition-colors hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary-hover)]"
        >
          <Bell className="h-4 w-4" />
          {showAll ? "Afficher les 5 dernieres" : "Voir toutes les notifications"}
        </button>
      </div>
    </div>
  );
}
