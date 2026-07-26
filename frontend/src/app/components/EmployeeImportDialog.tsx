import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
  Info,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Upload,
  UsersRound,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  employeesApi,
  type ApiEmployeeImportOptions,
  type ApiEmployeeImportPreview,
  type ApiEmployeeImportPreviewRow,
  type ApiEmployeeImportRowOverride,
  type ApiEmployeeImportSummary,
} from "../lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "./ui/utils";

interface EmployeeImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: (summary: ApiEmployeeImportSummary) => void;
}

interface ImportOptionsState {
  mapping_overrides: Record<string, string | null>;
  row_overrides: ApiEmployeeImportRowOverride[];
  default_values: Record<string, string | null>;
  auto_fix_enabled: boolean;
}

const PRIMARY_MAPPING_FIELDS = ["full_name", "email", "department_name", "job_profile"] as const;

function createEmptyOptions(): ImportOptionsState {
  return {
    mapping_overrides: {},
    row_overrides: [],
    default_values: {},
    auto_fix_enabled: false,
  };
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message === "Failed to fetch") {
    return "Connexion au service impossible. Verifiez que le repertoire des collaborateurs est accessible.";
  }
  if (error instanceof Error) return error.message;
  return fallbackMessage;
}

function normalizeTransportOptions(options: ImportOptionsState): ApiEmployeeImportOptions | undefined {
  const mapping_overrides = Object.fromEntries(
    Object.entries(options.mapping_overrides)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const default_values = Object.fromEntries(
    Object.entries(options.default_values)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const row_overrides = [...options.row_overrides]
    .sort((left, right) => left.row_number - right.row_number)
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== undefined),
      ) as ApiEmployeeImportRowOverride,
    )
    .filter((row) => Object.keys(row).length > 1);

  const normalizedOptions: ApiEmployeeImportOptions = {};
  if (Object.keys(mapping_overrides).length > 0) normalizedOptions.mapping_overrides = mapping_overrides;
  if (Object.keys(default_values).length > 0) normalizedOptions.default_values = default_values;
  if (row_overrides.length > 0) normalizedOptions.row_overrides = row_overrides;
  if (options.auto_fix_enabled) normalizedOptions.auto_fix_enabled = true;

  return Object.keys(normalizedOptions).length > 0 ? normalizedOptions : undefined;
}

function buildOptionsSignature(options: ImportOptionsState): string {
  return JSON.stringify(normalizeTransportOptions(options) ?? {});
}

function getRowStatusMeta(row: ApiEmployeeImportPreviewRow) {
  if (row.row_status === "error") {
    return {
      label: "Erreur",
      icon: CircleAlert,
      badgeClassName: "border-red-200 bg-red-50 text-[#B91C1C]",
      containerClassName: "border-red-200 bg-[linear-gradient(135deg,#FFF5F5,#FFFFFF)]",
    };
  }
  if (row.row_status === "incomplete") {
    return {
      label: "Incomplet",
      icon: AlertTriangle,
      badgeClassName: "border-amber-200 bg-amber-50 text-[#B45309]",
      containerClassName: "border-amber-200 bg-[linear-gradient(135deg,#FFF9ED,#FFFFFF)]",
    };
  }
  return {
    label: "Importable",
    icon: CheckCircle2,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-[#059669]",
    containerClassName: "border-emerald-200 bg-[linear-gradient(135deg,#F0FDF4,#FFFFFF)]",
  };
}

function getQualityTone(score: number) {
  if (score >= 85) return "text-[#059669]";
  if (score >= 65) return "text-[#B45309]";
  return "text-[#B91C1C]";
}

function getEditableValue(row: ApiEmployeeImportPreviewRow, fieldName: keyof ApiEmployeeImportPreviewRow) {
  const value = row[fieldName];
  return typeof value === "string" ? value : "";
}

export default function EmployeeImportDialog({
  open,
  onClose,
  onImported,
}: EmployeeImportDialogProps) {
  const { token } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastPreviewSignatureRef = useRef<string>("");
  const previewRequestIdRef = useRef(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewOptions, setPreviewOptions] = useState<ImportOptionsState>(createEmptyOptions);
  const [preview, setPreview] = useState<ApiEmployeeImportPreview | null>(null);
  const [importSummary, setImportSummary] = useState<ApiEmployeeImportSummary | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isRefreshingPreview, setIsRefreshingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canImport = Boolean(selectedFile && preview && !isPreviewLoading && !isImporting);
  const previewSignature = buildOptionsSignature(previewOptions);

  async function requestPreview(
    file: File,
    options: ImportOptionsState,
    mode: "initial" | "refresh" = "initial",
  ) {
    if (!token) {
      setErrorMessage("Session indisponible.");
      return;
    }

    const requestId = ++previewRequestIdRef.current;
    const transportOptions = normalizeTransportOptions(options);
    const nextSignature = JSON.stringify(transportOptions ?? {});

    if (mode === "initial") {
      setIsPreviewLoading(true);
      setErrorMessage(null);
      setImportSummary(null);
    } else {
      setIsRefreshingPreview(true);
    }

    try {
      const response = await employeesApi.previewImport(token, file, transportOptions);
      if (requestId !== previewRequestIdRef.current) return;

      setPreview(response);
      setErrorMessage(null);
      lastPreviewSignatureRef.current = nextSignature;

      if (response.total_rows === 0) {
        toast.warning("Fichier vide", {
          description: "Aucune ligne exploitable n'a ete detectee dans le fichier.",
        });
      }
    } catch (error) {
      if (requestId !== previewRequestIdRef.current) return;

      if (mode === "initial") {
        setPreview(null);
      }
      setErrorMessage(
        normalizeError(error, "Impossible de previsualiser le fichier collaborateurs."),
      );
    } finally {
      if (requestId !== previewRequestIdRef.current) return;
      if (mode === "initial") {
        setIsPreviewLoading(false);
      } else {
        setIsRefreshingPreview(false);
      }
    }
  }

  useEffect(() => {
    if (open) return;

    setSelectedFile(null);
    setPreviewOptions(createEmptyOptions());
    setPreview(null);
    setImportSummary(null);
    setIsPreviewLoading(false);
    setIsRefreshingPreview(false);
    setIsImporting(false);
    setErrorMessage(null);
    lastPreviewSignatureRef.current = "";
  }, [open]);

  useEffect(() => {
    if (!selectedFile || !preview) return;
    if (previewSignature === lastPreviewSignatureRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void requestPreview(selectedFile, previewOptions, "refresh");
    }, 320);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [preview, previewOptions, previewSignature, selectedFile]);

  function handleSelectFile(file: File | null) {
    setSelectedFile(file);
    setPreview(null);
    setImportSummary(null);
    setErrorMessage(null);

    const nextOptions = createEmptyOptions();
    setPreviewOptions(nextOptions);
    lastPreviewSignatureRef.current = JSON.stringify({});

    if (!file) return;
    void requestPreview(file, nextOptions, "initial");
  }

  function updatePreviewOptions(
    updater: (current: ImportOptionsState) => ImportOptionsState,
    optimisticRowUpdate?: (current: ApiEmployeeImportPreview) => ApiEmployeeImportPreview,
  ) {
    setImportSummary(null);
    setPreviewOptions((current) => updater(current));
    if (optimisticRowUpdate) {
      setPreview((current) => (current ? optimisticRowUpdate(current) : current));
    }
  }

  function handleMappingChange(fieldName: string, value: string) {
    updatePreviewOptions((current) => ({
      ...current,
      mapping_overrides: {
        ...current.mapping_overrides,
        [fieldName]: value === "__unmapped__" ? null : value,
      },
    }));
  }

  function handleDefaultValue(targetField: string, value: string | null) {
    if (!value) return;

    updatePreviewOptions((current) => ({
      ...current,
      default_values: {
        ...current.default_values,
        [targetField]: value,
      },
    }));
  }

  function handleAutoFix() {
    updatePreviewOptions((current) => ({
      ...current,
      auto_fix_enabled: true,
    }));
  }

  function handleRowEdit(
    rowNumber: number,
    fieldName:
      | "full_name"
      | "email"
      | "department_name"
      | "job_profile"
      | "employee_identifier"
      | "employee_code",
    value: string,
  ) {
    updatePreviewOptions(
      (current) => {
        const nextOverrides = [...current.row_overrides];
        const rowIndex = nextOverrides.findIndex((row) => row.row_number === rowNumber);
        const nextRow =
          rowIndex >= 0
            ? { ...nextOverrides[rowIndex], [fieldName]: value || null }
            : { row_number: rowNumber, [fieldName]: value || null };

        if (rowIndex >= 0) {
          nextOverrides[rowIndex] = nextRow;
        } else {
          nextOverrides.push(nextRow);
        }

        return {
          ...current,
          row_overrides: nextOverrides.filter((row) => Object.keys(row).length > 1),
        };
      },
      (currentPreview) => ({
        ...currentPreview,
        preview_rows: currentPreview.preview_rows.map((row) =>
          row.row_number === rowNumber ? { ...row, [fieldName]: value || null } : row,
        ),
      }),
    );
  }

  async function handleImport() {
    if (!token || !selectedFile) return;

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const response = await employeesApi.importFile(
        token,
        selectedFile,
        normalizeTransportOptions(previewOptions),
      );
      setImportSummary(response);
      onImported(response);

      if (response.imported_count > 0) {
        toast.success("Import collaborateurs termine", {
          description: `${response.imported_count} employe(s) importe(s), ${response.incomplete_count} incomplet(s), ${response.rejected_count} rejete(s).`,
        });
      } else {
        toast.warning("Aucun nouvel employe ajoute", {
          description: `${response.duplicate_count} doublon(s) et ${response.invalid_count} ligne(s) invalide(s) detecte(s).`,
        });
      }

      void requestPreview(selectedFile, previewOptions, "refresh");
    } catch (error) {
      setErrorMessage(normalizeError(error, "Import impossible pour ce fichier."));
    } finally {
      setIsImporting(false);
    }
  }

  function handleSuggestionAction(suggestion: NonNullable<ApiEmployeeImportPreview["suggestions"]>[number]) {
    if (suggestion.action_type === "apply_default_value" && suggestion.target_field && suggestion.suggested_value) {
      handleDefaultValue(suggestion.target_field, suggestion.suggested_value);
      return;
    }

    if (suggestion.action_type === "auto_fix") {
      handleAutoFix();
      return;
    }

    if (suggestion.action_type === "review_mapping" && suggestion.target_field && suggestion.suggested_value) {
      handleMappingChange(suggestion.target_field, suggestion.suggested_value);
      return;
    }

    if (suggestion.action_type === "complete_after_import") {
      toast.message("Import partiel autorise", {
        description: "Les lignes incompletes peuvent etre importees puis completees ensuite.",
      });
    }
  }

  const summaryCards = useMemo(
    () =>
      preview
        ? [
            {
              label: "Lignes detectees",
              value: preview.total_rows,
              tone: "border-slate-200 bg-white text-[#0F172A]",
            },
            {
              label: "Pretes",
              value: preview.ready_rows,
              tone: "border-emerald-200 bg-emerald-50 text-[#059669]",
            },
            {
              label: "Incompletes",
              value: preview.incomplete_rows,
              tone: "border-amber-200 bg-amber-50 text-[#B45309]",
            },
            {
              label: "Erreurs",
              value: preview.error_rows,
              tone: "border-red-200 bg-red-50 text-[#B91C1C]",
            },
          ]
        : [],
    [preview],
  );

  const primaryFieldMappings = preview
    ? preview.field_mappings.filter((field) =>
        PRIMARY_MAPPING_FIELDS.includes(
          field.field_name as (typeof PRIMARY_MAPPING_FIELDS)[number],
        ),
      )
    : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isPreviewLoading && !isImporting) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,78rem)] max-w-none flex-col gap-0 overflow-hidden rounded-[30px] border border-[#DCE5F1] bg-white p-0">
        <div className="border-b border-[#E2E8F0] bg-[linear-gradient(135deg,#FFFFFF,#F7FAFF)] px-6 py-5 pr-14">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#DBEAFE,#EFF6FF)] text-[#1D4ED8]">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-2xl font-bold text-[#0F172A]">
                  Importer collaborateurs
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm leading-6 text-[#64748B]">
                  Transformez un CSV ou un Excel RH en import fiable, corrigez les colonnes,
                  traitez les anomalies et validez le resultat avant d'enregistrer.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto scroll-smooth px-6 py-6">
          <section className="overflow-hidden rounded-[26px] border border-[#BFDBFE] bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] p-5 shadow-sm">
            <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#1D4ED8]">
                  <UsersRound className="h-3.5 w-3.5" />
                  Import RH intelligent
                </div>
                <h3 className="mt-4 text-lg font-semibold text-[#0F172A]">
                  Analyse, validation et correction assistent l'utilisateur a chaque etape.
                </h3>
                <p className="mt-2 max-w-3xl text-sm text-[#64748B]">
                  Champs pris en charge: nom, email, departement, fonction, identifiant,
                  statut et matricule. Les lignes incompletes restent importables, les erreurs
                  bloquantes sont explicites.
                </p>
              </div>

              <div className="flex min-w-0 shrink-0 flex-col gap-3 sm:flex-row xl:max-w-[44%] xl:items-center">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={(event) => handleSelectFile(event.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl border-gray-200 bg-white"
                  onClick={() => inputRef.current?.click()}
                  disabled={isPreviewLoading || isImporting}
                >
                  <Upload className="h-4 w-4" />
                  {selectedFile ? "Changer de fichier" : "Choisir un fichier"}
                </Button>
                <div className="min-w-0 rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm text-[#475569] sm:max-w-[280px] xl:max-w-[360px]">
                  <p className="truncate font-medium text-[#0F172A]">
                    {selectedFile ? selectedFile.name : "CSV ou XLSX"}
                  </p>
                  <p className="mt-1 text-xs text-[#64748B]">
                    {preview ? `Format detecte: ${preview.detected_format.toUpperCase()}` : "Ajoutez le fichier RH source"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {isPreviewLoading ? (
            <div className="rounded-[24px] border border-[#DCE5F1] bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3 text-sm text-[#475569]">
                <LoaderCircle className="h-4 w-4 animate-spin text-[#1D4ED8]" />
                Analyse du fichier en cours...
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
              {errorMessage}
            </div>
          ) : null}

          {preview ? (
            <section className="space-y-5">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
                <div className="rounded-[24px] border border-[#DCE5F1] bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-[#F8FAFC] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#475569]">
                        <Sparkles className="h-3.5 w-3.5 text-[#1D4ED8]" />
                        Qualite des donnees
                      </div>
                      <p className={cn("mt-4 text-3xl font-bold", getQualityTone(preview.quality_score))}>
                        {preview.quality_score}%
                      </p>
                      <p className="mt-1 text-sm text-[#64748B]">
                        Score calcule selon la completude, la validite et la coherence du fichier.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {summaryCards.map((item) => (
                        <div
                          key={item.label}
                          className={cn("rounded-2xl border px-4 py-3 text-sm", item.tone)}
                        >
                          <p className="text-xs uppercase tracking-[0.14em] opacity-80">{item.label}</p>
                          <p className="mt-2 text-xl font-semibold">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <Progress value={preview.quality_score} className="h-2 bg-[#DBEAFE]" />
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[#475569]">
                      <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1">
                        {preview.global_notice ?? "Analyse disponible."}
                      </span>
                      <span className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1">
                        {preview.fixable_anomalies} correction(s) simple(s) detectee(s)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[24px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                          Actions rapides
                        </p>
                        <p className="mt-2 text-sm text-[#475569]">
                          Corrigez automatiquement les ecarts simples puis importez sans bloquer le flux.
                        </p>
                      </div>
                      {isRefreshingPreview ? (
                        <RefreshCw className="mt-0.5 h-4 w-4 animate-spin text-[#1D4ED8]" />
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 justify-start rounded-xl border-[#DCE5F1] bg-white"
                        onClick={handleAutoFix}
                        disabled={previewOptions.auto_fix_enabled || isImporting}
                      >
                        <Wand2 className="h-4 w-4 text-[#1D4ED8]" />
                        {previewOptions.auto_fix_enabled
                          ? "Correction automatique active"
                          : "Corriger automatiquement"}
                      </Button>
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-[#92400E]">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-semibold">
                              {preview.anomalies_count} anomalies detectees
                            </p>
                            <p className="mt-1">
                              Correction recommandee avant validation pour maximiser la qualite.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-[#DCE5F1] bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      Resume final
                    </p>
                    {importSummary ? (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-[#065F46]">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              <p className="font-semibold">
                                {importSummary.imported_count} employe(s) importes
                              </p>
                              <p className="mt-1">
                                Qualite finale: {importSummary.quality_score}% apres validation.
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#059669]">Importes</p>
                            <p className="mt-2 text-xl font-semibold text-[#065F46]">
                              {importSummary.imported_count}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#B45309]">Incomplets</p>
                            <p className="mt-2 text-xl font-semibold text-[#92400E]">
                              {importSummary.incomplete_count}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-red-200 bg-red-50/70 px-4 py-3">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#B91C1C]">Rejetes</p>
                            <p className="mt-2 text-xl font-semibold text-[#991B1B]">
                              {importSummary.rejected_count}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-[#64748B]">
                        L'ecran final affichera ici les employes importes, incomplets et rejetes.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <div className="rounded-[24px] border border-[#E2E8F0] bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#1D4ED8]">
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[#0F172A]">Mapping interactif des colonnes</h3>
                      <p className="text-sm text-[#64748B]">
                        Ajustez les champs non reconnus pour fiabiliser la previsualisation.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {primaryFieldMappings.map((field) => (
                      <div
                        key={field.field_name}
                        className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[#0F172A]">{field.label}</p>
                            <p className="mt-1 text-xs text-[#64748B]">
                              {field.helper_text ?? "Detection automatique active."}
                            </p>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="rounded-full border border-[#E2E8F0] bg-white p-1 text-[#64748B]"
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent sideOffset={8} className="max-w-[260px] bg-[#0F172A] text-white">
                              Associez cette colonne pour ameliorer la qualite des donnees.
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        <div className="mt-3">
                          <Select
                            value={field.source_column ?? "__unmapped__"}
                            onValueChange={(value) => handleMappingChange(field.field_name, value)}
                            disabled={isImporting}
                          >
                            <SelectTrigger className="h-11 rounded-xl border-[#DCE5F1] bg-white">
                              <SelectValue placeholder="Choisir une colonne" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unmapped__">Ne pas associer</SelectItem>
                              {preview.available_columns.map((column) => (
                                <SelectItem key={`${field.field_name}-${column}`} value={column}>
                                  {column}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {(field.suggested_columns.length > 0 ? field.suggested_columns : preview.available_columns.slice(0, 3)).map((column) => (
                            <button
                              key={`${field.field_name}-${column}-suggestion`}
                              type="button"
                              onClick={() => handleMappingChange(field.field_name, column)}
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                field.source_column === column
                                  ? "border-blue-200 bg-blue-50 text-[#1D4ED8]"
                                  : "border-[#DCE5F1] bg-white text-[#475569] hover:border-blue-200 hover:bg-blue-50 hover:text-[#1D4ED8]",
                              )}
                            >
                              {column}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-[#E2E8F0] bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                    Suggestions intelligentes
                  </p>
                  {preview.suggestions.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {preview.suggestions.map((suggestion) => (
                        <div
                          key={suggestion.id}
                          className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4"
                        >
                          <p className="text-sm font-semibold text-[#0F172A]">{suggestion.title}</p>
                          <p className="mt-1 text-sm text-[#64748B]">{suggestion.description}</p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-[#94A3B8]">
                              {suggestion.affected_rows > 0
                                ? `${suggestion.affected_rows} ligne(s) concernee(s)`
                                : "Suggestion de structure"}
                            </span>
                            {suggestion.action_label ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 rounded-xl border-[#DCE5F1] bg-white"
                                onClick={() => handleSuggestionAction(suggestion)}
                                disabled={isImporting}
                              >
                                {suggestion.action_label}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[#64748B]">
                      Aucune suggestion supplementaire pour ce fichier.
                    </p>
                  )}

                  {preview.missing_required_fields.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-[#92400E]">
                      <p className="font-semibold">Champs obligatoires non identifies</p>
                      <p className="mt-1">{preview.missing_required_fields.join(", ")}</p>
                    </div>
                  ) : null}

                  {preview.warnings.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#475569]">
                      <p className="font-semibold text-[#0F172A]">Points de vigilance</p>
                      <ul className="mt-2 space-y-2">
                        {preview.warnings.map((warning) => (
                          <li key={warning} className="flex items-start gap-2">
                            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#1D4ED8]" />
                            <span>{warning}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#E2E8F0] bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-[#0F172A]">Preview editable</h3>
                    <p className="mt-1 text-sm text-[#64748B]">
                      Modifiez inline les champs utiles. Les statuts et anomalies se recalculent en continu.
                    </p>
                  </div>
                  <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
                    {preview.preview_rows.length} ligne(s) affichee(s)
                  </Badge>
                </div>

                <div className="mt-5 space-y-3">
                  {preview.preview_rows.map((row) => {
                    const statusMeta = getRowStatusMeta(row);
                    const StatusIcon = statusMeta.icon;

                    return (
                      <div
                        key={row.row_number}
                        className={cn(
                          "rounded-[24px] border p-4 shadow-sm transition-colors",
                          statusMeta.containerClassName,
                        )}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-center gap-3">
                            <div className="rounded-full border border-white/80 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                              Ligne {row.row_number}
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium", statusMeta.badgeClassName)}>
                                  <StatusIcon className="h-4 w-4" />
                                  {statusMeta.label}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent sideOffset={8} className="max-w-[280px] bg-[#0F172A] text-white">
                                {row.issues.length > 0
                                  ? row.issues.map((issue) => issue.message).join(" ")
                                  : "Aucune anomalie detectee sur cette ligne."}
                              </TooltipContent>
                            </Tooltip>
                          </div>

                          <div className="flex flex-wrap gap-2 text-xs text-[#64748B]">
                            <span className="rounded-full border border-white/80 bg-white px-3 py-1">
                              {row.employee_identifier ? `ID ${row.employee_identifier}` : "Sans identifiant"}
                            </span>
                            <span className="rounded-full border border-white/80 bg-white px-3 py-1">
                              {row.employee_code ? `Matricule ${row.employee_code}` : "Sans matricule"}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                              Nom
                            </label>
                            <Input
                              value={getEditableValue(row, "full_name")}
                              onChange={(event) => handleRowEdit(row.row_number, "full_name", event.target.value)}
                              placeholder="Nom complet"
                              className="h-11 rounded-xl border-white/80 bg-white"
                              disabled={isImporting}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                              Email
                            </label>
                            <Input
                              value={getEditableValue(row, "email")}
                              onChange={(event) => handleRowEdit(row.row_number, "email", event.target.value)}
                              placeholder="prenom.nom@bcskills.ma"
                              className="h-11 rounded-xl border-white/80 bg-white"
                              disabled={isImporting}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                              Departement
                            </label>
                            <Input
                              value={getEditableValue(row, "department_name")}
                              onChange={(event) => handleRowEdit(row.row_number, "department_name", event.target.value)}
                              placeholder="Ex. IT"
                              className="h-11 rounded-xl border-white/80 bg-white"
                              disabled={isImporting}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                              Fonction
                            </label>
                            <Input
                              value={getEditableValue(row, "job_profile")}
                              onChange={(event) => handleRowEdit(row.row_number, "job_profile", event.target.value)}
                              placeholder="Ex. Support IT"
                              className="h-11 rounded-xl border-white/80 bg-white"
                              disabled={isImporting}
                            />
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {row.issues.length > 0 ? (
                            row.issues.map((issue) => (
                              <span
                                key={`${row.row_number}-${issue.code}-${issue.message}`}
                                className={cn(
                                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                                  issue.severity === "error"
                                    ? "border-red-200 bg-red-50 text-[#B91C1C]"
                                    : "border-amber-200 bg-amber-50 text-[#B45309]",
                                )}
                              >
                                {issue.severity === "error" ? (
                                  <CircleAlert className="h-3.5 w-3.5" />
                                ) : (
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                )}
                                {issue.message}
                              </span>
                            ))
                          ) : (
                            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-[#059669]">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Ligne prete a l'import
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="border-t border-[#E2E8F0] px-6 py-4">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
            <div className="text-sm text-[#64748B]">
              {isRefreshingPreview ? "Analyse mise a jour en temps reel..." : "Import non bloquant avec feedback en continu."}
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-gray-200 bg-white"
                onClick={onClose}
                disabled={isPreviewLoading || isImporting}
              >
                Fermer
              </Button>
              <Button
                type="button"
                className="h-11 rounded-xl bg-[linear-gradient(135deg,#0F172A,#1D4ED8)] text-white hover:opacity-95"
                onClick={handleImport}
                disabled={!canImport}
              >
                {isImporting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {preview ? `Importer ${preview.valid_rows} collaborateur(s)` : "Importer les employes"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
