import { useEffect, useState } from "react";

import { useAuth } from "../context/AuthContext";
import { phoneLinesApi } from "../lib/api";

interface UsePhoneLineStatsResult {
  totalLines: number | null;
  newLinesThisMonth: number | null;
  lineStatsError: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function usePhoneLineStats(): UsePhoneLineStatsResult {
  const { token } = useAuth();
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [newLinesThisMonth, setNewLinesThisMonth] = useState<number | null>(null);
  const [lineStatsError, setLineStatsError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  async function loadLineStats(currentToken: string | null): Promise<void> {
    if (!currentToken) {
      setTotalLines(null);
      setNewLinesThisMonth(null);
      setLineStatsError(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const stats = await phoneLinesApi.stats(currentToken);
      setTotalLines(stats.total);
      setNewLinesThisMonth(stats.created_this_month);
      setLineStatsError(false);
    } catch {
      setTotalLines(null);
      setNewLinesThisMonth(null);
      setLineStatsError(true);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLineStats(token);
  }, [token]);

  return {
    totalLines,
    newLinesThisMonth,
    lineStatsError,
    isLoading,
    refresh: () => loadLineStats(token),
  };
}
