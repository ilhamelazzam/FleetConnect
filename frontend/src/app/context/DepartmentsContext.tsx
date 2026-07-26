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
  fleetAccessApi,
  type ApiDepartment,
  type CreateDepartmentPayload,
  type UpdateDepartmentPayload,
} from "../lib/api";
import { canManageUsers } from "../lib/roles";
import { useAuth } from "./AuthContext";

export interface DepartmentsContextValue {
  departments: ApiDepartment[];
  allDepartments: ApiDepartment[];
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  refreshDepartments: () => Promise<void>;
  createDepartment: (payload: CreateDepartmentPayload) => Promise<ApiDepartment>;
  updateDepartment: (
    departmentId: number,
    payload: UpdateDepartmentPayload,
  ) => Promise<ApiDepartment>;
  removeDepartment: (departmentId: number) => Promise<void>;
}

export const DepartmentsContext = createContext<DepartmentsContextValue | undefined>(undefined);

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Departements indisponibles.";
}

export function DepartmentsProvider({ children }: { children: ReactNode }) {
  const { token, isAuthenticated, user } = useAuth();
  const [departments, setDepartments] = useState<ApiDepartment[]>([]);
  const [allDepartments, setAllDepartments] = useState<ApiDepartment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshDepartments = useCallback(async () => {
    if (!token || !isAuthenticated) {
      setDepartments([]);
      setAllDepartments([]);
      setErrorMessage(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const activePromise = fleetAccessApi.departments(token);
      const allPromise = canManageUsers(user)
        ? fleetAccessApi.departments(token, { include_inactive: true })
        : activePromise;
      const [activeDepartments, managementDepartments] = await Promise.all([
        activePromise,
        allPromise,
      ]);
      setDepartments(activeDepartments);
      setAllDepartments(managementDepartments);
    } catch (error) {
      setErrorMessage(normalizeErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, token, user]);

  useEffect(() => {
    void refreshDepartments();
  }, [refreshDepartments]);

  const createDepartment = useCallback(
    async (payload: CreateDepartmentPayload) => {
      if (!token) {
        throw new Error("Session indisponible.");
      }

      setIsSaving(true);
      try {
        const createdDepartment = await fleetAccessApi.createDepartment(token, payload);
        await refreshDepartments();
        return createdDepartment;
      } finally {
        setIsSaving(false);
      }
    },
    [refreshDepartments, token],
  );

  const updateDepartment = useCallback(
    async (departmentId: number, payload: UpdateDepartmentPayload) => {
      if (!token) {
        throw new Error("Session indisponible.");
      }

      setIsSaving(true);
      try {
        const updatedDepartment = await fleetAccessApi.updateDepartment(
          token,
          departmentId,
          payload,
        );
        await refreshDepartments();
        return updatedDepartment;
      } finally {
        setIsSaving(false);
      }
    },
    [refreshDepartments, token],
  );

  const removeDepartment = useCallback(
    async (departmentId: number) => {
      if (!token) {
        throw new Error("Session indisponible.");
      }

      setIsSaving(true);
      try {
        await fleetAccessApi.removeDepartment(token, departmentId);
        await refreshDepartments();
      } finally {
        setIsSaving(false);
      }
    },
    [refreshDepartments, token],
  );

  const contextValue = useMemo(
    () => ({
      departments,
      allDepartments,
      isLoading,
      isSaving,
      errorMessage,
      refreshDepartments,
      createDepartment,
      updateDepartment,
      removeDepartment,
    }),
    [
      allDepartments,
      createDepartment,
      departments,
      errorMessage,
      isLoading,
      isSaving,
      refreshDepartments,
      removeDepartment,
      updateDepartment,
    ],
  );

  return (
    <DepartmentsContext.Provider value={contextValue}>
      {children}
    </DepartmentsContext.Provider>
  );
}

export function useDepartments(): DepartmentsContextValue {
  const context = useContext(DepartmentsContext);
  if (!context) {
    throw new Error("useDepartments must be used within a DepartmentsProvider");
  }
  return context;
}
