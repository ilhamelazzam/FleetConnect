import { useEffect, useState } from "react";

import {
  searchAddressSuggestions,
  type AddressSuggestion,
} from "../lib/nominatim";

interface UseAddressAutocompleteResult {
  suggestions: AddressSuggestion[];
  isLoading: boolean;
  error: string;
  hasNoResults: boolean;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError")
  );
}

export function useAddressAutocomplete(
  query: string,
  enabled = true,
): UseAddressAutocompleteResult {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasCompletedSearch, setHasCompletedSearch] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSuggestions([]);
      setError("");
      setIsLoading(false);
      setHasCompletedSearch(false);
      return;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
      setSuggestions([]);
      setError("");
      setIsLoading(false);
      setHasCompletedSearch(false);
      return;
    }

    const controller = new AbortController();
    let isActive = true;

    setSuggestions([]);
    setError("");
    setHasCompletedSearch(false);

    const timeoutId = window.setTimeout(async () => {
      setIsLoading(true);

      try {
        const nextSuggestions = await searchAddressSuggestions(trimmedQuery, controller.signal);
        if (!isActive) {
          return;
        }

        setSuggestions(nextSuggestions);
        setHasCompletedSearch(true);
      } catch (error) {
        if (!isActive || isAbortError(error)) {
          return;
        }

        console.error("Nominatim address search failed", error);
        setSuggestions([]);
        setError(
          error instanceof Error
            ? error.message
            : "Impossible de proposer des suggestions d'adresse pour le moment.",
        );
        setHasCompletedSearch(true);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      isActive = false;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  return {
    suggestions,
    isLoading,
    error,
    hasNoResults:
      hasCompletedSearch && !isLoading && !error && suggestions.length === 0 && query.trim().length >= 3,
  };
}

export type { AddressSuggestion };
