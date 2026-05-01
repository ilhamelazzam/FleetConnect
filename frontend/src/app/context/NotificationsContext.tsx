import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
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

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState<ApiNotificationFilter>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshNotifications = useCallback(async () => {
    if (!token || !isAuthenticated) {
      setNotifications([]);
      setUnreadCount(0);
      setTotalCount(0);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await notificationsApi.list(token, {
        filter: activeFilter,
        limit: 50,
      });
      setNotifications(response.items);
      setUnreadCount(response.unread_count);
      setTotalCount(response.total);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Notifications indisponibles.");
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, isAuthenticated, token]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!token || !isAuthenticated) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshNotifications();
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, refreshNotifications, token]);

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
