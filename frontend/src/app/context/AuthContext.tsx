import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { authApi, type ApiUser } from "../lib/api";
import {
  clearStoredSession,
  hasPersistentSession,
  readStoredSession,
  subscribeToAuthSessionChanges,
  writeStoredSession,
} from "../lib/auth-session";

interface LoginInput {
  email: string;
  password: string;
  remember: boolean;
}

interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  photoUrl?: string | null;
  role: string;
  remember: boolean;
}

interface AuthContextValue {
  user: ApiUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<ApiUser>;
  register: (input: RegisterInput) => Promise<ApiUser>;
  logout: () => void;
  refreshCurrentUser: () => Promise<void>;
}

type AuthContextGlobal = typeof globalThis & {
  __fleetconnect_auth_context__?: ReturnType<typeof createContext<AuthContextValue | undefined>>;
};

const authContextGlobal = globalThis as AuthContextGlobal;
const AuthContext =
  authContextGlobal.__fleetconnect_auth_context__ ??
  createContext<AuthContextValue | undefined>(undefined);

authContextGlobal.__fleetconnect_auth_context__ = AuthContext;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    return subscribeToAuthSessionChanges(() => {
      const storedSession = readStoredSession();
      setToken(storedSession?.accessToken ?? null);
      setUser(storedSession?.user ?? null);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession(): Promise<void> {
      const storedSession = readStoredSession();

      if (!storedSession) {
        if (isMounted) {
          setIsLoading(false);
        }
        return;
      }

      if (isMounted) {
        setToken(storedSession.accessToken);
        setUser(storedSession.user);
      }

      try {
        const currentUser = await authApi.getCurrentUser(storedSession.accessToken);
        const latestSession = readStoredSession() ?? storedSession;

        writeStoredSession(
          {
            accessToken: latestSession.accessToken,
            refreshToken: latestSession.refreshToken,
            user: currentUser,
          },
          hasPersistentSession(),
        );
      } catch {
        clearStoredSession();
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async ({ email, password, remember }: LoginInput): Promise<ApiUser> => {
    const response = await authApi.login({ email, password });
    const session = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      user: response.user,
    };

    writeStoredSession(session, remember);
    setToken(session.accessToken);
    setUser(session.user);

    return session.user;
  };

  const register = async ({
    fullName,
    email,
    password,
    photoUrl,
    role,
    remember,
  }: RegisterInput): Promise<ApiUser> => {
    const response = await authApi.register({
      full_name: fullName,
      email,
      password,
      photo_url: photoUrl ?? null,
      role,
    });
    const session = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      user: response.user,
    };

    writeStoredSession(session, remember);
    setToken(session.accessToken);
    setUser(session.user);

    return session.user;
  };

  const logout = () => {
    clearStoredSession();
    setToken(null);
    setUser(null);
  };

  const refreshCurrentUser = async () => {
    const storedSession = readStoredSession();
    if (!storedSession) {
      return;
    }

    const currentUser = await authApi.getCurrentUser(storedSession.accessToken);
    const latestSession = readStoredSession() ?? storedSession;

    writeStoredSession(
      {
        accessToken: latestSession.accessToken,
        refreshToken: latestSession.refreshToken,
        user: currentUser,
      },
      hasPersistentSession(),
    );
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: Boolean(user && token),
        isLoading,
        login,
        register,
        logout,
        refreshCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
