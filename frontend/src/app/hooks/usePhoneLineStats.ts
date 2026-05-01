import { useEffect, useState } from "react";

import { useAuth } from "../context/AuthContext";
import { phoneLinesApi } from "../lib/api";

interface UsePhoneLineStatsResult {
  totalLines: number | null;
  newLinesThisMonth: number | null;
  averageDataUsageGb: number | null;
  previousAverageDataUsageGb: number | null;
  averageDataUsageChangePct: number | null;
  totalAiAlerts: number | null;
  criticalAiAlerts: number | null;
  estimatedMonthlySavingsMad: number | null;
  lineStatsError: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function usePhoneLineStats(): UsePhoneLineStatsResult {
  const { token } = useAuth();
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [newLinesThisMonth, setNewLinesThisMonth] = useState<number | null>(null);
  const [averageDataUsageGb, setAverageDataUsageGb] = useState<number | null>(null);
  const [previousAverageDataUsageGb, setPreviousAverageDataUsageGb] = useState<number | null>(null);
  const [averageDataUsageChangePct, setAverageDataUsageChangePct] = useState<number | null>(null);
  const [totalAiAlerts, setTotalAiAlerts] = useState<number | null>(null);
  const [criticalAiAlerts, setCriticalAiAlerts] = useState<number | null>(null);
  const [estimatedMonthlySavingsMad, setEstimatedMonthlySavingsMad] = useState<number | null>(null);
  const [lineStatsError, setLineStatsError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  async function loadLineStats(currentToken: string | null): Promise<void> {
    if (!currentToken) {
      setTotalLines(null);
      setNewLinesThisMonth(null);
      setAverageDataUsageGb(null);
      setPreviousAverageDataUsageGb(null);
      setAverageDataUsageChangePct(null);
      setTotalAiAlerts(null);
      setCriticalAiAlerts(null);
      setEstimatedMonthlySavingsMad(null);
      setLineStatsError(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const stats = await phoneLinesApi.stats(currentToken);
      setTotalLines(stats.total);
      setNewLinesThisMonth(stats.created_this_month);
      setAverageDataUsageGb(stats.average_data_usage_gb);
      setPreviousAverageDataUsageGb(stats.previous_average_data_usage_gb);
      setAverageDataUsageChangePct(stats.average_data_usage_change_pct);
      setTotalAiAlerts(stats.total_ai_alerts);
      setCriticalAiAlerts(stats.critical_ai_alerts);
      setEstimatedMonthlySavingsMad(stats.estimated_monthly_savings_mad);
      setLineStatsError(false);
    } catch {
      setTotalLines(null);
      setNewLinesThisMonth(null);
      setAverageDataUsageGb(null);
      setPreviousAverageDataUsageGb(null);
      setAverageDataUsageChangePct(null);
      setTotalAiAlerts(null);
      setCriticalAiAlerts(null);
      setEstimatedMonthlySavingsMad(null);
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
    averageDataUsageGb,
    previousAverageDataUsageGb,
    averageDataUsageChangePct,
    totalAiAlerts,
    criticalAiAlerts,
    estimatedMonthlySavingsMad,
    lineStatsError,
    isLoading,
    refresh: () => loadLineStats(token),
  };
}
