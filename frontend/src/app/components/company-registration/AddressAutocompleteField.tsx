import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";

import type { AddressSuggestion } from "../../hooks/useAddressAutocomplete";

function buildSuggestionLocationLabel(suggestion: AddressSuggestion): string {
  const parts = [suggestion.city, suggestion.region].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" - ");
  }

  return suggestion.country || suggestion.address;
}

export default function AddressAutocompleteField({
  label,
  icon: Icon,
  value,
  onChange,
  onSuggestionSelect,
  suggestions,
  isLoading,
  hasNoResults,
  searchError,
  helper,
  error,
  containerClassName,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  onSuggestionSelect: (suggestion: AddressSuggestion) => void;
  suggestions: AddressSuggestion[];
  isLoading: boolean;
  hasNoResults: boolean;
  searchError: string;
  helper?: string;
  error?: string;
  containerClassName?: string;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const blurTimeoutRef = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const queryHasMinLength = value.trim().length >= 3;
  const showPanel =
    isOpen &&
    queryHasMinLength &&
    (isLoading || Boolean(searchError) || hasNoResults || suggestions.length > 0);

  useEffect(() => {
    setActiveIndex(suggestions.length > 0 ? 0 : -1);
  }, [suggestions]);

  useEffect(() => {
    if (!queryHasMinLength) {
      setIsOpen(false);
      return;
    }

    if (isLoading || Boolean(searchError) || hasNoResults || suggestions.length > 0) {
      setIsOpen(true);
    }
  }, [hasNoResults, isLoading, queryHasMinLength, searchError, suggestions.length]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const clearBlurTimeout = () => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const selectSuggestion = (suggestion: AddressSuggestion) => {
    clearBlurTimeout();
    onSuggestionSelect(suggestion);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!showPanel || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    }
  };

  return (
    <label className={`block ${containerClassName || ""}`}>
      <span className="mb-2 block text-sm font-medium text-[#0F172A]">{label}</span>
      <div className="relative">
        <div
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
            error ? "border-red-300 bg-red-50/70" : "border-slate-200 bg-slate-50/70"
          }`}
        >
          <Icon className={`h-5 w-5 ${error ? "text-[#DC2626]" : "text-[#64748B]"}`} />
          <input
            id={inputId}
            aria-label={label}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showPanel}
            aria-controls={showPanel ? listboxId : undefined}
            aria-activedescendant={
              showPanel && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined
            }
            aria-busy={isLoading}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              if (event.target.value.trim().length >= 3) {
                setIsOpen(true);
              } else {
                setIsOpen(false);
              }
            }}
            onFocus={() => {
              if (queryHasMinLength) {
                setIsOpen(true);
              }
            }}
            onBlur={() => {
              clearBlurTimeout();
              blurTimeoutRef.current = window.setTimeout(() => {
                setIsOpen(false);
                setActiveIndex(-1);
              }, 120);
            }}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
          />
          {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-[#1D4ED8]" /> : null}
        </div>

        {showPanel ? (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_18px_40px_-30px_rgba(15,23,42,0.32)]"
          >
            {isLoading ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-[#1D4ED8]">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>Recherche d'adresses en cours...</span>
              </div>
            ) : null}

            {!isLoading && searchError ? (
              <div className="px-4 py-3 text-sm font-medium text-[#B91C1C]">{searchError}</div>
            ) : null}

            {!isLoading && !searchError && hasNoResults ? (
              <div className="px-4 py-3 text-sm text-[#64748B]">Aucun resultat</div>
            ) : null}

            {!isLoading && !searchError && suggestions.length > 0 ? (
              <div className="max-h-80 overflow-y-auto py-2">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    id={`${inputId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => selectSuggestion(suggestion)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      index === activeIndex
                        ? "bg-[#EFF6FF]"
                        : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[#0F172A]">{suggestion.fullName}</p>
                    <p className="mt-1 text-xs text-[#64748B]">
                      {buildSuggestionLocationLabel(suggestion)}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-[#DC2626]">{error}</p> : null}
      {!error && helper ? <p className="mt-2 text-sm text-[#64748B]">{helper}</p> : null}
    </label>
  );
}
