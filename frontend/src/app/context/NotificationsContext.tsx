import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  notificationsApi,
  type ApiNotification,
  type ApiNotificationFilter,
} from "../lib/api";
import { useAuth } from "./AuthContext";

interface NotificationsContextValue {
  notifications: ApiNotification[];
  unreadCount: number;
  totalCount: number;
  activeFilter: ApiNotificationFilter;
  isLoading: boolean;
  errorMessage: string | null;
  setActiveFilter: (filter: ApiNotificationFilter) => void;
  refreshNotifications: () => Promise<void>;
  markAsRead: (notificationId: number) => Promise<void>;
  deleteNotification: (notificationId: number) => Promise<void>;
}

type NotificationsContextGlobal = typeof globalThis & {
  __fleetconnect_notifications_context__?: ReturnType<
    typeof createContext<NotificationsContextValue | undefined>
  >;
};

const notificationsContextGlobal = globalThis as NotificationsContextGlobal;
const NotificationsContext =
  notificationsContextGlobal.__fleetconnect_notifications_context__ ??
  createContext<NotificationsContextValue | undefined>(undefined);

notificationsContextGlobal.__fleetconnect_notifications_context__ = NotificationsContext;
const ENABLE_NOTIFICATION_DEBUG_LOGS = import.meta.env.DEV;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState<ApiNotificationFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const authBlockedRef = useRef(false);

  const refreshNotifications = useCallback(async () => {
    if (isAuthLoading || !token || !isAuthenticated || authBlockedRef.current) {
      setNotifications([]);
      setUnreadCount(0);
      setTotalCount(0);
      return;
    }

    if (ENABLE_NOTIFICATION_DEBUG_LOGS) {
      console.debug("[notifications] fetch_started", {
        endpoint: "/notifications",
        filter: activeFilter,
        limit: 50,
        hasToken: Boolean(token),
      });
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await notificationsApi.list(token, {
        filter: activeFilter,
        limit: 50,
      });
      authBlockedRef.current = false;
      setNotifications(response.items);
      setUnreadCount(response.unread_count);
      setTotalCount(response.total);
      if (ENABLE_NOTIFICATION_DEBUG_LOGS) {
        console.debug("[notifications] fetch_completed", {
          endpoint: "/notifications",
          status: 200,
          total: response.total,
          unread: response.unread_count,
        });
      }
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403 || error.code === "AUTH_ERROR" || error.code === "UNAUTHORIZED")
      ) {
        authBlockedRef.current = true;
        setNotifications([]);
        setUnreadCount(0);
        setTotalCount(0);
        setErrorMessage("Session expiree.");
        if (ENABLE_NOTIFICATION_DEBUG_LOGS) {
          console.debug("[notifications] fetch_blocked_after_auth_error", {
            endpoint: "/notifications",
            status: error.status,
            code: error.code,
          });
        }
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Notifications indisponibles.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, isAuthenticated, isAuthLoading, token]);

  useEffect(() => {
    if (!token || !isAuthenticated) {
      authBlockedRef.current = false;
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (isAuthLoading || !token || !isAuthenticated || authBlockedRef.current) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshNotifications();
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, isAuthLoading, refreshNotifications, token]);

  const markAsRead = useCallback(
    async (notificationId: number) => {
      if (!token) {
        return;
      }
      const existingNotification = notifications.find(
        (notification) => notification.id === notificationId,
      );
      const updatedNotification = await notificationsApi.markRead(token, notificationId);
      setNotifications((currentNotifications) =>
        currentNotifications.map((notification) =>
          notification.id === updatedNotification.id ? updatedNotification : notification,
        ),
      );
      if (existingNotification && !existingNotification.is_read) {
        setUnreadCount((currentCount) => Math.max(0, currentCount - 1));
      }
    },
    [notifications, token],
  );

  const deleteNotification = useCallback(
    async (notificationId: number) => {
      if (!token) {
        return;
      }
      const existingNotification = notifications.find(
        (notification) => notification.id === notificationId,
      );
      await notificationsApi.remove(token, notificationId);
      setNotifications((currentNotifications) =>
        currentNotifications.filter((notification) => notification.id !== notificationId),
      );
      setTotalCount((currentCount) => Math.max(0, currentCount - 1));
      if (existingNotification && !existingNotification.is_read) {
        setUnreadCount((currentCount) => Math.max(0, currentCount - 1));
      }
    },
    [notifications, token],
  );

  const contextValue = useMemo(
    () => ({
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
    }),
    [
      activeFilter,
      deleteNotification,
      errorMessage,
      isLoading,
      markAsRead,
      notifications,
      refreshNotifications,
      totalCount,
      unreadCount,
    ],
  );

  return (
    <NotificationsContext.Provider value={contextValue}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}
