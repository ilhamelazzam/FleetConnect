import { AnimatePresence, motion } from "motion/react";
import {
  startTransition,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router";
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileBadge2,
  FileText,
  Globe2,
  Landmark,
  LoaderCircle,
  Mail,
  MapPinned,
  Phone,
  Search,
  ShieldCheck,
  Upload,
  UserRound,
} from "lucide-react";

import AddressAutocompleteField from "../components/company-registration/AddressAutocompleteField";
import { useAddressAutocomplete, type AddressSuggestion } from "../hooks/useAddressAutocomplete";
import { ApiError, companyRegistrationApi } from "../lib/api";
import {
  buildEstimatedAddress,
  pickCoverageLabel,
  pickDetectedCity,
  pickDetectedRegion,
  type ReverseGeocodeResponse,
} from "../lib/nominatim";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

type StepKey = "account" | "company" | "documents";
type RequestedRole = "ADMIN" | "MANAGER" | "ANALYST";

interface RegisterCompanyFormState {
  responsible_full_name: string;
  responsible_phone: string;
  job_title: string;
  requested_role: RequestedRole;
  responsible_email: string;
  password: string;
  confirm_password: string;
  company_name: string;
  sector: string;
  city: string;
  address_line: string;
  region: string;
  postal_code: string;
  country: string;
  latitude: string;
  longitude: string;
  company_phone: string;
  ice: string;
  rc: string;
  tax_id: string;
  cnss: string;
  patente: string;
  website: string;
  estimated_phone_lines: string;
  employees_count: string;
  operators: string[];
  coverage_zones: string;
  logo: File | null;
  legal_representative_cin: File | null;
  commercial_register: File | null;
  fiscal_document: File | null;
  company_stamp: File | null;
}

interface StepDefinition {
  key: StepKey;
  title: string;
  subtitle: string;
  icon: typeof UserRound;
}

interface RequestedRoleOption {
  value: RequestedRole;
  label: string;
  title: string;
  summary: string;
  badge: string;
  features: string[];
  restrictions: string[];
  accent_class_name: string;
  surface_class_name: string;
  icon: typeof ShieldCheck;
}

const steps: StepDefinition[] = [
  {
    key: "account",
    title: "Informations du responsable",
    subtitle: "Identite du responsable, email professionnel et mot de passe securise.",
    icon: UserRound,
  },
  {
    key: "company",
    title: "Informations entreprise",
    subtitle: "Donnees juridiques, operateur principal et volume de lignes.",
    icon: Building2,
  },
  {
    key: "documents",
    title: "Documents",
    subtitle: "Logo, RC PDF et pieces justificatives du dossier.",
    icon: FileBadge2,
  },
];

const requestedRoleOptions: RequestedRoleOption[] = [
  {
    value: "ADMIN",
    label: "Administrateur",
    title: "Administrateur d'entreprise",
    badge: "Acces complet",
    summary:
      "Profil de pilotage complet pour administrer l'entreprise, les utilisateurs et la flotte depuis un espace unique.",
    features: [
      "Gerer les utilisateurs de l'entreprise",
      "Attribuer les roles et permissions",
      "Gerer les lignes telephoniques",
      "Gerer les forfaits",
      "Gerer les ressources de flotte",
      "Consulter tous les tableaux de bord",
      "Acceder aux parametres de l'entreprise",
      "Valider les demandes internes",
    ],
    restrictions: [],
    accent_class_name: "text-[#1D4ED8]",
    surface_class_name: "border-[#BFDBFE] bg-[linear-gradient(135deg,#EFF6FF_0%,#F8FAFF_48%,#EEF2FF_100%)]",
    icon: ShieldCheck,
  },
  {
    value: "MANAGER",
    label: "Manager",
    title: "Manager",
    badge: "Supervision",
    summary:
      "Profil oriente supervision terrain pour suivre les equipes, les KPI telecom et les actions de pilotage quotidiennes.",
    features: [
      "Superviser les equipes",
      "Consulter les KPI",
      "Suivre les depenses",
      "Consulter les alertes",
      "Consulter les recommandations IA",
      "Suivre les lignes et forfaits attribues",
      "Generer des rapports",
    ],
    restrictions: [
      "Ne peut pas gerer les roles critiques",
      "Ne peut pas modifier les parametres globaux",
    ],
    accent_class_name: "text-[#0F766E]",
    surface_class_name: "border-[#99F6E4] bg-[linear-gradient(135deg,#ECFEFF_0%,#F0FDFA_48%,#EEF2FF_100%)]",
    icon: Briefcase,
  },
  {
    value: "ANALYST",
    label: "Analyste",
    title: "Analyste",
    badge: "Lecture analytique",
    summary:
      "Profil dedie a l'analyse telecom, a la lecture des CDR et a l'export des rapports de performance et de risque.",
    features: [
      "Analyser les consommations",
      "Consulter les CDR",
      "Consulter les anomalies",
      "Consulter les risques de fraude",
      "Analyser le roaming",
      "Consulter les recommandations IA",
      "Exporter les rapports",
      "Consulter le dashboard analytique",
    ],
    restrictions: [
      "Ne peut pas creer ou supprimer des utilisateurs",
      "Ne peut pas modifier les parametres de l'entreprise",
    ],
    accent_class_name: "text-[#7C3AED]",
    surface_class_name: "border-[#DDD6FE] bg-[linear-gradient(135deg,#F5F3FF_0%,#FAF5FF_48%,#EFF6FF_100%)]",
    icon: FileText,
  },
];

const initialFormState: RegisterCompanyFormState = {
  responsible_full_name: "",
  responsible_phone: "",
  job_title: "",
  requested_role: "ADMIN",
  responsible_email: "",
  password: "",
  confirm_password: "",
  company_name: "",
  sector: "",
  city: "",
  address_line: "",
  region: "",
  postal_code: "",
  country: "",
  latitude: "",
  longitude: "",
  company_phone: "",
  ice: "",
  rc: "",
  tax_id: "",
  cnss: "",
  patente: "",
  website: "",
  estimated_phone_lines: "",
  employees_count: "",
  operators: [],
  coverage_zones: "",
  logo: null,
  legal_representative_cin: null,
  commercial_register: null,
  fiscal_document: null,
  company_stamp: null,
};

type LocationConfidence = "high" | "medium" | "low";
type LocationConfirmationStatus = "UNCONFIRMED" | "CONFIRMED";

interface DetectedLocation {
  address: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  coverageLabel: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  confidence: LocationConfidence;
  confirmationStatus: LocationConfirmationStatus;
  mapUrl: string;
}

interface GeolocationAvailability {
  canUseGeolocation: boolean;
  reason: "ready" | "insecure_context" | "unsupported_browser";
  message: string | null;
}

function validatePasswordStrength(password: string): string | null {
  const passwordIsValid =
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    password.length >= 8;

  if (!passwordIsValid) {
    return "Le mot de passe doit contenir 8 caracteres minimum, une majuscule, une minuscule et un chiffre.";
  }

  return null;
}

function validateFile(file: File | null, required: boolean): string | null {
  if (!file) {
    return required ? "Ce document est obligatoire." : null;
  }

  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return "Formats autorises: PDF, JPG, PNG.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return "Taille maximale autorisee: 5 Mo.";
  }

  return null;
}

function splitCoverageZones(input: string): string[] {
  return input
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getAccountStepValidationErrors(
  formState: RegisterCompanyFormState,
): Record<string, string> {
  const nextErrors: Record<string, string> = {};

  if (!formState.responsible_full_name.trim()) {
    nextErrors.responsible_full_name = "Le nom complet est requis.";
  }
  if (!formState.responsible_phone.trim()) {
    nextErrors.responsible_phone = "Le telephone est requis.";
  }
  if (!formState.job_title.trim()) {
    nextErrors.job_title = "La fonction / poste est requise.";
  }
  if (!formState.requested_role.trim()) {
    nextErrors.requested_role = "Selectionnez un role FleetConnect.";
  }
  if (!formState.responsible_email.trim()) {
    nextErrors.responsible_email = "L'email professionnel est requis.";
  }
  if (!formState.password) {
    nextErrors.password = "Le mot de passe est requis.";
  } else {
    const passwordError = validatePasswordStrength(formState.password);
    if (passwordError) {
      nextErrors.password = passwordError;
    }
  }
  if (!formState.confirm_password) {
    nextErrors.confirm_password = "Confirmez le mot de passe.";
  } else if (formState.password !== formState.confirm_password) {
    nextErrors.confirm_password = "Les mots de passe ne correspondent pas.";
  }

  return nextErrors;
}

function getCompanyStepValidationErrors(
  formState: RegisterCompanyFormState,
): Record<string, string> {
  const nextErrors: Record<string, string> = {};

  if (!formState.company_name.trim()) {
    nextErrors.company_name = "Le nom de l'entreprise est requis.";
  }
  if (!formState.sector.trim()) {
    nextErrors.sector = "Le secteur d'activite est requis.";
  }
  if (!formState.city.trim()) {
    nextErrors.city = "La ville est requise.";
  }
  if (!formState.company_phone.trim()) {
    nextErrors.company_phone = "Le telephone entreprise est requis.";
  }
  if (!formState.ice.trim()) {
    nextErrors.ice = "Le numero ICE est requis.";
  }
  if (!formState.rc.trim()) {
    nextErrors.rc = "Le registre de commerce est requis.";
  }
  if (!formState.estimated_phone_lines.trim()) {
    nextErrors.estimated_phone_lines = "Le volume de lignes estimees est requis.";
  }
  if (!formState.employees_count.trim()) {
    nextErrors.employees_count = "Le nombre d'employes est requis.";
  }
  if (formState.operators.length === 0) {
    nextErrors.operators = "Selectionnez au moins un operateur.";
  }
  if (splitCoverageZones(formState.coverage_zones).length === 0) {
    nextErrors.coverage_zones = "Indiquez au moins une zone ou ville de couverture.";
  }

  return nextErrors;
}

function getDocumentStepValidationErrors(
  formState: RegisterCompanyFormState,
): Record<string, string> {
  const nextErrors: Record<string, string> = {};

  const legalCINError = validateFile(formState.legal_representative_cin, true);
  if (legalCINError) {
    nextErrors.legal_representative_cin = legalCINError;
  }
  const registerError = validateFile(formState.commercial_register, true);
  if (registerError) {
    nextErrors.commercial_register = registerError;
  }

  const optionalFileKeys: Array<
    keyof Pick<RegisterCompanyFormState, "logo" | "fiscal_document" | "company_stamp">
  > = ["logo", "fiscal_document", "company_stamp"];
  optionalFileKeys.forEach((key) => {
    const error = validateFile(formState[key], false);
    if (error) {
      nextErrors[key] = error;
    }
  });

  return nextErrors;
}

function getStepValidationErrors(
  stepKey: StepKey,
  formState: RegisterCompanyFormState,
): Record<string, string> {
  if (stepKey === "account") {
    return getAccountStepValidationErrors(formState);
  }
  if (stepKey === "company") {
    return getCompanyStepValidationErrors(formState);
  }
  return getDocumentStepValidationErrors(formState);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  return normalizedHostname === "localhost" || normalizedHostname === "127.0.0.1";
}

function appendCoverageZone(input: string, nextZone: string): string {
  const trimmedZone = nextZone.trim();
  if (!trimmedZone) {
    return input;
  }

  const normalizedNextZone = trimmedZone.toLocaleLowerCase();
  const zoneAlreadyExists = splitCoverageZones(input).some(
    (zone) => zone.toLocaleLowerCase() === normalizedNextZone,
  );

  if (zoneAlreadyExists) {
    return input;
  }

  const trimmedInput = input.trim();
  return trimmedInput ? `${trimmedInput}\n${trimmedZone}` : trimmedZone;
}

function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function buildMapUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`;
}

function getLocationConfidence(accuracy: number): LocationConfidence {
  if (accuracy < 30) {
    return "high";
  }

  if (accuracy <= 100) {
    return "medium";
  }

  return "low";
}

function getLocationConfidenceLabel(confidence: LocationConfidence): string {
  if (confidence === "high") {
    return "Precision elevee";
  }

  if (confidence === "medium") {
    return "Precision moyenne";
  }

  return "Precision faible";
}

function getLocationConfidenceClasses(confidence: LocationConfidence): string {
  if (confidence === "high") {
    return "border-emerald-200 bg-emerald-50 text-[#047857]";
  }

  if (confidence === "medium") {
    return "border-amber-200 bg-amber-50 text-[#B45309]";
  }

  return "border-orange-200 bg-orange-50 text-[#C2410C]";
}

function formatAccuracy(accuracy: number): string {
  return `${Math.round(accuracy)} metres`;
}

function getGeolocationAvailability(): GeolocationAvailability {
  if (typeof window === "undefined") {
    return {
      canUseGeolocation: false,
      reason: "unsupported_browser",
      message:
        "La geolocalisation n'est pas prise en charge par ce navigateur. Renseignez votre adresse manuellement.",
    };
  }

  const hasSecureContext = window.isSecureContext;
  const hostnameIsAllowed = isLoopbackHostname(window.location.hostname);
  const canUseSecureContext = hasSecureContext || hostnameIsAllowed;

  if (!canUseSecureContext) {
    return {
      canUseGeolocation: false,
      reason: "insecure_context",
      message:
        "La detection automatique de la position est indisponible sur cette adresse non securisee. Utilisez HTTPS, localhost ou saisissez manuellement votre ville.",
    };
  }

  if (
    typeof navigator === "undefined" ||
    !navigator.geolocation ||
    typeof navigator.geolocation.getCurrentPosition !== "function"
  ) {
    return {
      canUseGeolocation: false,
      reason: "unsupported_browser",
      message:
        "La geolocalisation n'est pas prise en charge par ce navigateur. Renseignez votre adresse manuellement.",
    };
  }

  return {
    canUseGeolocation: true,
    reason: "ready",
    message: null,
  };
}

function getGeolocationErrorMessage(error: { code?: number }): string {
  switch (error.code) {
    case 1:
      return "L'acces a votre position a ete refuse. Vous pouvez continuer en saisissant manuellement votre adresse et votre ville.";
    case 2:
      return "La position actuelle est indisponible pour le moment. Saisissez votre adresse manuellement ou reessayez.";
    case 3:
      return "La detection a depasse le delai prevu. Reessayez ou renseignez votre adresse manuellement.";
    default:
      return "Impossible de recuperer votre position actuelle. Renseignez votre adresse manuellement.";
  }
}

function getCurrentBrowserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    const geolocationAvailability = getGeolocationAvailability();
    if (!geolocationAvailability.canUseGeolocation) {
      reject(new Error(geolocationAvailability.message || "Geolocalisation indisponible."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 300000,
    });
  });
}

async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  accuracy: number,
): Promise<DetectedLocation> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    "accept-language": "fr",
    addressdetails: "1",
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Impossible de retrouver l'adresse associee a votre position.");
  }

  const payload = (await response.json()) as ReverseGeocodeResponse;
  const coordinateLabel = formatCoordinates(latitude, longitude);
  const confidence = getLocationConfidence(accuracy);

  return {
    address: buildEstimatedAddress(payload.address, payload.display_name) || coordinateLabel,
    city: pickDetectedCity(payload.address),
    region: pickDetectedRegion(payload.address),
    postalCode: payload.address?.postcode?.trim() || "",
    country: payload.address?.country?.trim() || "",
    coverageLabel: pickCoverageLabel(payload.address),
    latitude,
    longitude,
    accuracy,
    confidence,
    confirmationStatus: "UNCONFIRMED",
    mapUrl: buildMapUrl(latitude, longitude),
  };
}

function buildFormData(
  formState: RegisterCompanyFormState,
  detectedLocation: DetectedLocation | null,
): FormData {
  const formData = new FormData();
  const persistDetectedAddress =
    !detectedLocation || detectedLocation.confirmationStatus === "CONFIRMED";

  formData.append("responsible_full_name", formState.responsible_full_name.trim());
  formData.append("responsible_phone", formState.responsible_phone.trim());
  formData.append("job_title", formState.job_title.trim());
  formData.append("requested_role", formState.requested_role);
  formData.append("responsible_email", formState.responsible_email.trim());
  formData.append("password", formState.password);
  formData.append("company_name", formState.company_name.trim());
  formData.append("sector", formState.sector.trim());
  formData.append("city", formState.city.trim());
  formData.append("address_line", persistDetectedAddress ? formState.address_line.trim() : "");
  formData.append("region", formState.region.trim());
  formData.append("postal_code", formState.postal_code.trim());
  formData.append("country", formState.country.trim());
  if (formState.latitude.trim()) {
    formData.append("latitude", formState.latitude.trim());
  }
  if (formState.longitude.trim()) {
    formData.append("longitude", formState.longitude.trim());
  }
  formData.append("company_phone", formState.company_phone.trim());
  formData.append("ice", formState.ice.trim());
  formData.append("rc", formState.rc.trim());
  formData.append("tax_id", formState.tax_id.trim());
  formData.append("cnss", formState.cnss.trim());
  formData.append("patente", formState.patente.trim());
  formData.append("website", formState.website.trim());
  formData.append("estimated_phone_lines", formState.estimated_phone_lines.trim() || "0");
  formData.append("employees_count", formState.employees_count.trim() || "0");
  formData.append("coverage_zones", formState.coverage_zones.trim());
  formState.operators.forEach((operator) => formData.append("operators", operator));

  if (formState.logo) {
    formData.append("logo", formState.logo);
  }
  if (formState.legal_representative_cin) {
    formData.append("legal_representative_cin", formState.legal_representative_cin);
  }
  if (formState.commercial_register) {
    formData.append("commercial_register", formState.commercial_register);
  }
  if (formState.fiscal_document) {
    formData.append("fiscal_document", formState.fiscal_document);
  }
  if (formState.company_stamp) {
    formData.append("company_stamp", formState.company_stamp);
  }

  return formData;
}

export default function RegisterCompany() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [formState, setFormState] = useState<RegisterCompanyFormState>(initialFormState);
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<keyof RegisterCompanyFormState, boolean>>
  >({});
  const [attemptedSteps, setAttemptedSteps] = useState<Partial<Record<StepKey, boolean>>>({});
  const [globalError, setGlobalError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [submittedRequestId, setSubmittedRequestId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [detectedLocation, setDetectedLocation] = useState<DetectedLocation | null>(null);
  const [locationError, setLocationError] = useState("");
  const [emailEligibilityMessage, setEmailEligibilityMessage] = useState("");
  const [emailEligibilityReason, setEmailEligibilityReason] = useState<
    "available" | "active_request_exists" | "active_user_exists" | "resubmission_allowed" | null
  >(null);
  const [isCheckingEmailEligibility, setIsCheckingEmailEligibility] = useState(false);
  const [manualAddressQuery, setManualAddressQuery] = useState("");
  const [shouldSearchManualAddress, setShouldSearchManualAddress] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const {
    suggestions: manualAddressSuggestions,
    isLoading: isSearchingManualAddress,
    error: manualAddressSearchError,
    hasNoResults: hasNoManualAddressResults,
  } = useAddressAutocomplete(manualAddressQuery, shouldSearchManualAddress);

  const geolocationAvailability = useMemo(() => getGeolocationAvailability(), []);
  const coverageZoneCount = useMemo(
    () => splitCoverageZones(formState.coverage_zones).length,
    [formState.coverage_zones],
  );
  const completionPercentage = useMemo(
    () => Math.round(((stepIndex + 1) / steps.length) * 100),
    [stepIndex],
  );
  const selectedRequestedRole = useMemo(
    () =>
      requestedRoleOptions.find((option) => option.value === formState.requested_role) ??
      requestedRoleOptions[0],
    [formState.requested_role],
  );

  const currentStep = steps[stepIndex];
  const currentStepErrors = useMemo(
    () => getStepValidationErrors(currentStep.key, formState),
    [currentStep.key, formState],
  );
  const visibleFieldErrors = useMemo(() => {
    const shouldShowAll = attemptedSteps[currentStep.key];
    const nextErrors: Record<string, string> = {};

    Object.entries(currentStepErrors).forEach(([key, message]) => {
      if (shouldShowAll || touchedFields[key as keyof RegisterCompanyFormState]) {
        nextErrors[key] = message;
      }
    });

    return nextErrors;
  }, [attemptedSteps, currentStep.key, currentStepErrors, touchedFields]);
  const emailEligibilityBlocksSubmission =
    currentStep.key === "account" &&
    (emailEligibilityReason === "active_request_exists" ||
      emailEligibilityReason === "active_user_exists");
  const isCurrentStepBlocked =
    Object.keys(currentStepErrors).length > 0 || emailEligibilityBlocksSubmission;
  const detectedLocationNeedsConfirmation =
    detectedLocation?.confirmationStatus === "UNCONFIRMED";

  const handleManualAddressQueryChange = (value: string) => {
    setManualAddressQuery(value);
    setShouldSearchManualAddress(true);
  };

  const handleResponsibleEmailChange = (value: string) => {
    setFieldValue("responsible_email", value);
    setEmailEligibilityMessage("");
    setEmailEligibilityReason(null);
  };

  const handleResponsibleEmailBlur = async () => {
    const normalizedEmail = formState.responsible_email.trim();
    if (normalizedEmail.length < 5) {
      setEmailEligibilityMessage("");
      setEmailEligibilityReason(null);
      return;
    }

    setIsCheckingEmailEligibility(true);
    try {
      const response = await companyRegistrationApi.checkEligibility(normalizedEmail);
      setEmailEligibilityMessage(response.message);
      setEmailEligibilityReason(response.reason);
    } catch {
      setEmailEligibilityMessage(
        "La verification de l'email est momentanement indisponible. Le controle final sera effectue a l'envoi.",
      );
      setEmailEligibilityReason(null);
    } finally {
      setIsCheckingEmailEligibility(false);
    }
  };

  const setFieldValue = <K extends keyof RegisterCompanyFormState>(
    key: K,
    value: RegisterCompanyFormState[K],
  ) => {
    setFormState((current) => ({ ...current, [key]: value }));
    setTouchedFields((current) => ({ ...current, [key]: true }));
  };

  const setLocationFieldValue = <
    K extends keyof Pick<
      RegisterCompanyFormState,
      "address_line" | "city" | "region" | "postal_code" | "country"
    >,
  >(
    key: K,
    value: RegisterCompanyFormState[K],
  ) => {
    setFormState((current) => ({
      ...current,
      [key]: value,
      latitude: "",
      longitude: "",
    }));
    setTouchedFields((current) => ({ ...current, [key]: true }));
    setDetectedLocation(null);
  };

  const getFieldError = <K extends keyof RegisterCompanyFormState>(key: K) =>
    visibleFieldErrors[key as string];

  const toggleOperator = (operator: string) => {
    setFieldValue(
      "operators",
      formState.operators.includes(operator)
        ? formState.operators.filter((item) => item !== operator)
        : [...formState.operators, operator],
    );
  };

  const handleFileChange =
    (key: keyof Pick<
      RegisterCompanyFormState,
      "logo" | "legal_representative_cin" | "commercial_register" | "fiscal_document" | "company_stamp"
    >) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setFieldValue(key, file);
    };

  const goToNextStep = () => {
    if (isCurrentStepBlocked) {
      setAttemptedSteps((current) => ({ ...current, [currentStep.key]: true }));
      return;
    }

    startTransition(() => {
      setStepIndex((current) => Math.min(current + 1, steps.length - 1));
    });
  };

  const goToPreviousStep = () => {
    startTransition(() => {
      setStepIndex((current) => Math.max(current - 1, 0));
    });
  };

  const handleSubmit = async () => {
    if (isCurrentStepBlocked) {
      setAttemptedSteps((current) => ({ ...current, [currentStep.key]: true }));
      return;
    }

    setGlobalError("");
    setIsSubmitting(true);

    try {
      const response = await companyRegistrationApi.submit(buildFormData(formState, detectedLocation));
      setSubmittedRequestId(response.request_id);
      setSuccessMessage(response.message);
      setTouchedFields({});
      setAttemptedSteps({});
      setShowPassword(false);
      setShowConfirmPassword(false);
    } catch (error) {
      if (error instanceof ApiError) {
        setGlobalError(error.message);
      } else {
        setGlobalError("Impossible d'envoyer la demande pour le moment.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDetectCurrentLocation = async () => {
    if (!geolocationAvailability.canUseGeolocation) {
      setLocationError(geolocationAvailability.message || "");
      return;
    }

    setLocationError("");
    setDetectedLocation(null);
    setIsDetectingLocation(true);

    try {
      const position = await getCurrentBrowserPosition();
      const nextLocation = await reverseGeocodeCoordinates(
        position.coords.latitude,
        position.coords.longitude,
        position.coords.accuracy,
      );
      const shouldPrefillDetailedAddress = nextLocation.confidence !== "low";

      setDetectedLocation(nextLocation);
      setFormState((current) => ({
        ...current,
        address_line: shouldPrefillDetailedAddress ? nextLocation.address : current.address_line,
        city: nextLocation.city || current.city,
        region: nextLocation.region || current.region,
        postal_code: shouldPrefillDetailedAddress
          ? nextLocation.postalCode || current.postal_code
          : current.postal_code,
        country: nextLocation.country || current.country,
        latitude: String(nextLocation.latitude),
        longitude: String(nextLocation.longitude),
        coverage_zones: nextLocation.coverageLabel
          ? appendCoverageZone(current.coverage_zones, nextLocation.coverageLabel)
          : current.coverage_zones,
      }));
      setTouchedFields((current) => ({
        ...current,
        city: true,
        region: true,
        postal_code: true,
        country: true,
        ...(shouldPrefillDetailedAddress ? { address_line: true } : {}),
      }));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        setLocationError(getGeolocationErrorMessage(error as { code?: number }));
      } else if (error instanceof Error) {
        setLocationError(error.message);
      } else {
        setLocationError("Impossible de recuperer votre position actuelle.");
      }
    } finally {
      setIsDetectingLocation(false);
    }
  };

  const handleConfirmDetectedLocation = () => {
    setDetectedLocation((current) =>
      current ? { ...current, confirmationStatus: "CONFIRMED" } : current,
    );
  };

  const handleManualLocationCorrection = () => {
    setFormState((current) => ({
      ...current,
      address_line:
        detectedLocation?.confirmationStatus === "UNCONFIRMED" ? "" : current.address_line,
      latitude: "",
      longitude: "",
    }));
    setDetectedLocation(null);
    setLocationError("");
  };

  const handleAddressSuggestionSelect = (suggestion: AddressSuggestion) => {
    setDetectedLocation(null);
    setLocationError("");
    setShouldSearchManualAddress(false);
    setManualAddressQuery(suggestion.fullName);
    setFormState((current) => ({
      ...current,
      address_line: suggestion.address || suggestion.fullName || current.address_line,
      city: suggestion.city || current.city,
      region: suggestion.region || current.region,
      postal_code: suggestion.postalCode || current.postal_code,
      country: suggestion.country || current.country,
      latitude: String(suggestion.latitude),
      longitude: String(suggestion.longitude),
      coverage_zones: suggestion.city
        ? appendCoverageZone(current.coverage_zones, suggestion.city)
        : current.coverage_zones,
    }));
    setTouchedFields((current) => ({
      ...current,
      address_line: true,
      city: true,
      region: true,
      postal_code: true,
      country: true,
    }));
  };

  if (submittedRequestId !== null) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.18),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(124,58,237,0.14),transparent_34%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_100%)] p-4 sm:p-6">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-5xl items-center">
          <div className="w-full rounded-[32px] border border-white/80 bg-white/90 p-8 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:p-12">
            <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
              <div className="rounded-[28px] bg-[linear-gradient(160deg,#0F172A_0%,#1E3A8A_54%,#06B6D4_100%)] p-7 text-white shadow-[0_22px_60px_-30px_rgba(15,23,42,0.75)]">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium">
                  <BadgeCheck className="h-4 w-4" />
                  <span>Demande transmise</span>
                </div>
                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                  Votre entreprise est en cours de verification.
                </h1>
                <p className="mt-4 text-sm leading-7 text-white/80">
                  L'equipe FleetConnect IA va examiner votre dossier, verifier les justificatifs
                  et vous notifier par email des qu'une decision sera prise.
                </p>
                <div className="mt-8 rounded-3xl border border-white/15 bg-white/10 p-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/60">
                    Reference de dossier
                  </p>
                  <p className="mt-3 text-4xl font-semibold">#{submittedRequestId}</p>
                </div>
              </div>

              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-[#0F766E]">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Soumission reussie</span>
                </div>
                <h2 className="mt-6 text-3xl font-semibold tracking-tight text-[#0F172A]">
                  {successMessage}
                </h2>
                <p className="mt-4 text-sm leading-7 text-[#475569]">
                  Une fois la demande approuvee, le compte administrateur entreprise sera cree
                  automatiquement et vous pourrez vous connecter via la page de login existante.
                </p>

                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  <ActionCard
                    title="Email professionnel"
                    description="Utilisez ensuite l'email responsable deja renseigne."
                    icon={Mail}
                  />
                  <ActionCard
                    title="Connexion existante"
                    description="Aucune nouvelle URL: le login actuel restera votre point d'entree."
                    icon={ShieldCheck}
                  />
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#1D4ED8] px-5 py-3 text-sm font-semibold text-white shadow-[0_20px_36px_-18px_rgba(37,99,235,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#1E40AF]"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>Aller au login</span>
                  </button>
                  <Link
                    to="/"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span>Retour a l'accueil</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(6,182,212,0.12),transparent_24%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_52%,#EEF2FF_100%)] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="text-sm font-medium text-[#1D4ED8] hover:text-[#1E40AF]">
            Retour a l'accueil
          </Link>
          <div className="text-sm text-[#64748B]">
            Vous avez deja un compte ?{" "}
            <Link to="/login" className="font-semibold text-[#1D4ED8] hover:text-[#1E40AF]">
              Se connecter
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[32px] bg-[linear-gradient(160deg,#0F172A_0%,#1E3A8A_48%,#7C3AED_100%)] p-6 text-white shadow-[0_28px_90px_-40px_rgba(15,23,42,0.72)]">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/90">
              <Landmark className="h-4 w-4" />
              <span>Inscription entreprise</span>
            </div>

            <h1 className="mt-6 text-3xl font-semibold tracking-tight">
              Ouvrez votre cockpit FleetConnect IA en 3 etapes.
            </h1>
            <p className="mt-4 text-sm leading-7 text-white/80">
              Soumettez votre dossier, vos justificatifs et les parametres de votre flotte
              telephonique pour activer un environnement entreprise securise.
            </p>

            <div className="mt-8 space-y-3">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = index === stepIndex;
                const isCompleted = index < stepIndex;

                return (
                  <div
                    key={step.key}
                    className={`rounded-3xl border px-4 py-4 transition-all ${
                      isActive
                        ? "border-white/35 bg-white/18 shadow-[0_18px_34px_-24px_rgba(255,255,255,0.7)]"
                        : isCompleted
                          ? "border-emerald-300/30 bg-emerald-400/10"
                          : "border-white/10 bg-white/5"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                          isCompleted
                            ? "bg-emerald-400 text-[#052E16]"
                            : isActive
                              ? "bg-white text-[#1D4ED8]"
                              : "bg-white/10 text-white"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-white/60">
                          Etape {index + 1}
                        </p>
                        <p className="mt-1 font-semibold">{step.title}</p>
                        <p className="mt-1 text-sm leading-6 text-white/70">{step.subtitle}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 rounded-[28px] border border-white/12 bg-white/10 p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-white/60">Signal flotte</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <MiniStat label="Operateurs selectionnes" value={String(formState.operators.length)} />
                <MiniStat label="Zones de couverture" value={String(coverageZoneCount)} />
                <MiniStat
                  label="Pieces chargees"
                  value={String(
                    [
                      formState.logo,
                      formState.legal_representative_cin,
                      formState.commercial_register,
                      formState.fiscal_document,
                      formState.company_stamp,
                    ].filter(Boolean).length,
                  )}
                />
              </div>
            </div>
          </aside>

          <section className="overflow-hidden rounded-[32px] border border-white/80 bg-white/92 shadow-[0_28px_90px_-40px_rgba(15,23,42,0.28)] backdrop-blur-xl">
            <div className="border-b border-slate-200/80 px-6 py-5 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#64748B]">
                    Parcours guide
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#0F172A]">
                    {currentStep.title}
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[#475569]">{currentStep.subtitle}</p>
                </div>
                <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm font-medium text-[#1D4ED8]">
                  Etape {stepIndex + 1} / {steps.length} · {completionPercentage}%
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_75%,#06B6D4_100%)] transition-all duration-300"
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
            </div>

            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep.key}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  {currentStep.key === "account" ? (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <TextField
                        label="Nom complet"
                        icon={UserRound}
                        value={formState.responsible_full_name}
                        error={getFieldError("responsible_full_name")}
                        onChange={(value) => setFieldValue("responsible_full_name", value)}
                      />
                      <TextField
                        label="Telephone"
                        icon={Phone}
                        value={formState.responsible_phone}
                        error={getFieldError("responsible_phone")}
                        onChange={(value) => setFieldValue("responsible_phone", value)}
                      />
                      <TextField
                        label="Fonction / poste"
                        icon={Briefcase}
                        value={formState.job_title}
                        error={getFieldError("job_title")}
                        onChange={(value) => setFieldValue("job_title", value)}
                        helper="Exemples: Responsable IT, Responsable Telecom, DSI."
                      />
                      <TextField
                        label="Email professionnel"
                        type="email"
                        icon={Mail}
                        value={formState.responsible_email}
                        error={
                          getFieldError("responsible_email") ||
                          (emailEligibilityReason === "active_request_exists" ||
                          emailEligibilityReason === "active_user_exists"
                            ? emailEligibilityMessage
                            : undefined)
                        }
                        onChange={handleResponsibleEmailChange}
                        onBlur={() => void handleResponsibleEmailBlur()}
                        helper={
                          emailEligibilityReason === "resubmission_allowed"
                            ? emailEligibilityMessage
                            : undefined
                        }
                        trailingAction={
                          isCheckingEmailEligibility ? (
                            <LoaderCircle className="h-4 w-4 animate-spin text-[#1D4ED8]" />
                          ) : null
                        }
                      />
                      <div className="sm:col-span-2">
                        <SelectField
                          label="Role demande dans FleetConnect IA"
                          icon={UserRound}
                          value={formState.requested_role}
                          error={getFieldError("requested_role")}
                          options={requestedRoleOptions.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          onChange={(value) =>
                            setFieldValue("requested_role", value as RequestedRole)
                          }
                          helper="Valeur par defaut: Administrateur. Le premier compte d'une entreprise est active en Administrateur pour garantir la gouvernance initiale."
                        />
                        <RolePreviewCard role={selectedRequestedRole} />
                      </div>
                      <TextField
                        label="Mot de passe"
                        type={showPassword ? "text" : "password"}
                        icon={ShieldCheck}
                        value={formState.password}
                        error={getFieldError("password")}
                        onChange={(value) => setFieldValue("password", value)}
                        helper="8 caracteres minimum, avec majuscule, minuscule et chiffre."
                        trailingAction={
                          <button
                            type="button"
                            onClick={() => setShowPassword((current) => !current)}
                            aria-label={
                              showPassword
                                ? "Masquer le mot de passe"
                                : "Afficher le mot de passe"
                            }
                            className="rounded-full p-1 text-[#64748B] transition-colors hover:text-[#1D4ED8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        }
                      />
                      <TextField
                        label="Confirmation mot de passe"
                        type={showConfirmPassword ? "text" : "password"}
                        icon={ShieldCheck}
                        value={formState.confirm_password}
                        error={getFieldError("confirm_password")}
                        onChange={(value) => setFieldValue("confirm_password", value)}
                        trailingAction={
                          <button
                            type="button"
                            onClick={() => setShowConfirmPassword((current) => !current)}
                            aria-label={
                              showConfirmPassword
                                ? "Masquer la confirmation du mot de passe"
                                : "Afficher la confirmation du mot de passe"
                            }
                            className="rounded-full p-1 text-[#64748B] transition-colors hover:text-[#1D4ED8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        }
                      />
                    </div>
                  ) : null}

                  {currentStep.key === "company" ? (
                    <div className="space-y-6">
                      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        <TextField
                          label="Nom de l'entreprise"
                          icon={Building2}
                          value={formState.company_name}
                          error={getFieldError("company_name")}
                          onChange={(value) => setFieldValue("company_name", value)}
                        />
                        <TextField
                          label="Secteur d'activite"
                          icon={Briefcase}
                          value={formState.sector}
                          error={getFieldError("sector")}
                          onChange={(value) => setFieldValue("sector", value)}
                        />
                        <TextField
                          label="Telephone entreprise"
                          icon={Phone}
                          value={formState.company_phone}
                          error={getFieldError("company_phone")}
                          onChange={(value) => setFieldValue("company_phone", value)}
                        />
                        <TextField
                          label="ICE"
                          icon={FileText}
                          value={formState.ice}
                          error={getFieldError("ice")}
                          onChange={(value) => setFieldValue("ice", value)}
                        />
                        <TextField
                          label="RC"
                          icon={FileText}
                          value={formState.rc}
                          error={getFieldError("rc")}
                          onChange={(value) => setFieldValue("rc", value)}
                        />
                        <TextField
                          label="IF"
                          icon={FileText}
                          value={formState.tax_id}
                          error={getFieldError("tax_id")}
                          onChange={(value) => setFieldValue("tax_id", value)}
                        />
                        <TextField
                          label="CNSS"
                          icon={FileText}
                          value={formState.cnss}
                          error={getFieldError("cnss")}
                          onChange={(value) => setFieldValue("cnss", value)}
                        />
                        <TextField
                          label="Patente"
                          icon={FileText}
                          value={formState.patente}
                          error={getFieldError("patente")}
                          onChange={(value) => setFieldValue("patente", value)}
                        />
                        <TextField
                          label="Site web"
                          icon={Globe2}
                          value={formState.website}
                          error={getFieldError("website")}
                          onChange={(value) => setFieldValue("website", value)}
                        />
                        <TextField
                          label="Nombre de lignes"
                          type="number"
                          icon={Phone}
                          value={formState.estimated_phone_lines}
                          error={getFieldError("estimated_phone_lines")}
                          onChange={(value) => setFieldValue("estimated_phone_lines", value)}
                        />
                        <TextField
                          label="Nombre de collaborateurs"
                          type="number"
                          icon={UserRound}
                          value={formState.employees_count}
                          error={getFieldError("employees_count")}
                          onChange={(value) => setFieldValue("employees_count", value)}
                        />
                      </div>

                      <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
                        <div className="flex items-center gap-3">
                          <Building2 className="h-5 w-5 text-[#1D4ED8]" />
                          <div>
                            <h3 className="font-semibold text-[#0F172A]">Operateur principal / operateurs utilises</h3>
                            <p className="text-sm text-[#64748B]">
                              Selectionnez le reseau principal de l'entreprise et ajoutez les operateurs complementaires si besoin.
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          {["Maroc Telecom", "Orange", "inwi"].map((operator) => {
                            const selected = formState.operators.includes(operator);
                            return (
                              <button
                                key={operator}
                                type="button"
                                onClick={() => toggleOperator(operator)}
                                className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                                  selected
                                    ? "border-[#1D4ED8] bg-[#DBEAFE] text-[#1D4ED8] shadow-[0_12px_30px_-24px_rgba(37,99,235,0.85)]"
                                    : "border-slate-200 bg-white text-[#0F172A] hover:border-slate-300 hover:bg-slate-50"
                                }`}
                              >
                                <p className="font-semibold">{operator}</p>
                                <p className="mt-1 text-sm opacity-80">
                                  {selected ? "Selectionne pour le dossier" : "Ajouter a la flotte declaree"}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                        {getFieldError("operators") ? (
                          <p className="mt-3 text-sm font-medium text-[#DC2626]">
                            {getFieldError("operators")}
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)]">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#DBEAFE] text-[#1D4ED8]">
                              <MapPinned className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-semibold text-[#0F172A]">Position actuelle</h3>
                              <p className="mt-1 text-sm leading-6 text-[#64748B]">
                                Detectez votre position pour afficher votre adresse actuelle et
                                pre-remplir votre ville de couverture.
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => void handleDetectCurrentLocation()}
                            disabled={
                              isDetectingLocation || !geolocationAvailability.canUseGeolocation
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm font-semibold text-[#1D4ED8] transition-all hover:-translate-y-0.5 hover:bg-[#DBEAFE] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isDetectingLocation ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <MapPinned className="h-4 w-4" />
                            )}
                            <span>
                              {isDetectingLocation
                                ? "Detection de votre position..."
                                : "Utiliser ma position actuelle"}
                            </span>
                          </button>
                        </div>

                        {isDetectingLocation ? (
                          <div className="mt-4 rounded-[24px] border border-[#BFDBFE] bg-[#EFF6FF] p-4 text-sm text-[#1D4ED8]">
                            <div className="flex items-center gap-3">
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                              <p className="font-medium">Detection de votre position...</p>
                            </div>
                          </div>
                        ) : detectedLocation ? (
                          <div
                            className={`mt-4 rounded-[24px] border p-4 ${
                              detectedLocation.confidence === "low"
                                ? "border-orange-200 bg-orange-50/80"
                                : "border-emerald-200 bg-emerald-50/80"
                            }`}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <p
                                  className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                                    detectedLocation.confidence === "low"
                                      ? "text-[#C2410C]"
                                      : "text-[#0F766E]"
                                  }`}
                                >
                                  Adresse estimee a partir de votre position
                                </p>
                                <p className="mt-2 text-sm font-medium leading-6 text-[#0F172A]">
                                  {detectedLocation.address}
                                </p>
                                <p className="mt-2 text-sm text-[#475569]">
                                  Verifiez et corrigez cette adresse avant de poursuivre.
                                </p>
                                {detectedLocation.confidence === "low" ? (
                                  <p className="mt-2 text-sm font-medium text-[#C2410C]">
                                    Votre position est approximative. Saisissez ou confirmez
                                    l'adresse exacte de l'entreprise.
                                  </p>
                                ) : null}
                                {detectedLocationNeedsConfirmation ? (
                                  <p className="mt-2 text-sm text-[#475569]">
                                    L'adresse detaillee ne sera enregistree qu'apres confirmation
                                    explicite ou correction manuelle.
                                  </p>
                                ) : (
                                  <p className="mt-2 text-sm font-medium text-[#047857]">
                                    Adresse confirmee pour le dossier.
                                  </p>
                                )}
                              </div>

                              <div className="flex flex-wrap gap-2 lg:max-w-[280px] lg:justify-end">
                                <span
                                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${getLocationConfidenceClasses(
                                    detectedLocation.confidence,
                                  )}`}
                                >
                                  {getLocationConfidenceLabel(detectedLocation.confidence)}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-[#475569]">
                                  Precision estimee : {formatAccuracy(detectedLocation.accuracy)}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-[#475569]">
                                  Statut : {detectedLocation.confirmationStatus}
                                </span>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#475569]">
                              {detectedLocation.coverageLabel ? (
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                                  Ville ajoutee :{" "}
                                  {detectedLocation.city || detectedLocation.coverageLabel}
                                </span>
                              ) : null}
                              {detectedLocation.country ? (
                                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                                  Pays : {detectedLocation.country}
                                </span>
                              ) : null}
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                                Coordonnees :{" "}
                                {formatCoordinates(
                                  detectedLocation.latitude,
                                  detectedLocation.longitude,
                                )}
                              </span>
                            </div>

                            {detectedLocation.confidence === "low" &&
                            !formState.address_line.trim() ? (
                              <div className="mt-3 rounded-2xl border border-orange-200 bg-white/90 px-4 py-3 text-sm text-[#9A3412]">
                                L'adresse detaillee n'a pas ete pre-remplie car la precision GPS
                                est insuffisante.
                              </div>
                            ) : null}

                            <div className="mt-4 flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={handleConfirmDetectedLocation}
                                className="inline-flex items-center justify-center rounded-2xl bg-[#1D4ED8] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_36px_-18px_rgba(37,99,235,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#1E40AF]"
                              >
                                Confirmer cette adresse
                              </button>
                              <button
                                type="button"
                                onClick={handleManualLocationCorrection}
                                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50"
                              >
                                Corriger manuellement
                              </button>
                              <a
                                href={detectedLocation.mapUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-sm font-semibold text-[#1D4ED8] hover:text-[#1E40AF]"
                              >
                                <Globe2 className="h-4 w-4" />
                                <span>Voir cette position sur la carte</span>
                              </a>
                            </div>
                          </div>
                        ) : locationError ? (
                          <div className="mt-4 rounded-[24px] border border-red-200 bg-red-50/80 p-4 text-sm font-medium text-[#B91C1C]">
                            {locationError}
                          </div>
                        ) : geolocationAvailability.message ? (
                          <div className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50/80 p-4 text-sm font-medium text-[#B45309]">
                            {geolocationAvailability.message}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-[#64748B]">
                            La detection automatique est facultative. Vous pouvez aussi saisir
                            manuellement votre adresse et votre ville.
                          </div>
                        )}

                        <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                          <div className="flex items-center gap-3">
                            <Globe2 className="h-5 w-5 text-[#1D4ED8]" />
                            <div>
                              <h4 className="font-semibold text-[#0F172A]">
                                Saisie manuelle de secours
                              </h4>
                              <p className="text-sm text-[#64748B]">
                                Renseignez manuellement ces informations si la detection
                                automatique est indisponible, approximative ou refusee.
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 rounded-[22px] border border-slate-200 bg-white/90 p-4">
                            <AddressAutocompleteField
                              label="Recherche d'adresse"
                              icon={Search}
                              value={manualAddressQuery}
                              onChange={handleManualAddressQueryChange}
                              onSuggestionSelect={handleAddressSuggestionSelect}
                              suggestions={manualAddressSuggestions}
                              isLoading={isSearchingManualAddress}
                              hasNoResults={hasNoManualAddressResults}
                              searchError={manualAddressSearchError}
                              helper="Saisissez au moins 3 caracteres pour obtenir des suggestions."
                              containerClassName="md:col-span-2"
                            />
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <TextField
                              label="Adresse"
                              icon={MapPinned}
                              value={formState.address_line}
                              onChange={(value) => setLocationFieldValue("address_line", value)}
                              helper="Optionnel. Utilisez cette zone pour confirmer ou corriger l'adresse estimee."
                              containerClassName="md:col-span-2"
                            />
                            <TextField
                              label="Ville"
                              icon={MapPinned}
                              value={formState.city}
                              error={getFieldError("city")}
                              onChange={(value) => setLocationFieldValue("city", value)}
                              helper="Requise pour le dossier entreprise."
                            />
                            <TextField
                              label="Region"
                              icon={Landmark}
                              value={formState.region}
                              onChange={(value) => setLocationFieldValue("region", value)}
                            />
                            <TextField
                              label="Code postal"
                              icon={FileText}
                              value={formState.postal_code}
                              onChange={(value) => setLocationFieldValue("postal_code", value)}
                            />
                            <TextField
                              label="Pays"
                              icon={Globe2}
                              value={formState.country}
                              onChange={(value) => setLocationFieldValue("country", value)}
                            />
                            <TextField
                              label="Latitude"
                              icon={MapPinned}
                              value={formState.latitude}
                              onChange={(value) => setFieldValue("latitude", value)}
                              helper="Renseignee automatiquement apres selection d'une adresse."
                              readOnly
                            />
                            <TextField
                              label="Longitude"
                              icon={MapPinned}
                              value={formState.longitude}
                              onChange={(value) => setFieldValue("longitude", value)}
                              helper="Renseignee automatiquement apres selection d'une adresse."
                              readOnly
                            />
                          </div>
                        </div>
                      </div>

                      <TextAreaField
                        label="Zones ou villes de couverture"
                        icon={MapPinned}
                        value={formState.coverage_zones}
                        error={getFieldError("coverage_zones")}
                        helper="Separez les villes par virgule ou par ligne. La geolocalisation peut ajouter votre ville actuelle."
                        onChange={(value) => setFieldValue("coverage_zones", value)}
                      />
                    </div>
                  ) : null}

                  {currentStep.key === "documents" ? (
                    <div className="space-y-5">
                      <FileField
                        label="Logo entreprise"
                        required={false}
                        file={formState.logo}
                        error={getFieldError("logo")}
                        onChange={handleFileChange("logo")}
                      />
                      <FileField
                        label="CIN du representant legal"
                        required
                        file={formState.legal_representative_cin}
                        error={getFieldError("legal_representative_cin")}
                        onChange={handleFileChange("legal_representative_cin")}
                      />
                      <FileField
                        label="Registre de commerce"
                        required
                        file={formState.commercial_register}
                        error={getFieldError("commercial_register")}
                        onChange={handleFileChange("commercial_register")}
                      />
                      <FileField
                        label="Patente / IF / justificatif fiscal"
                        required={false}
                        file={formState.fiscal_document}
                        error={getFieldError("fiscal_document")}
                        onChange={handleFileChange("fiscal_document")}
                      />
                      <FileField
                        label="Justificatifs complementaires"
                        required={false}
                        file={formState.company_stamp}
                        error={getFieldError("company_stamp")}
                        onChange={handleFileChange("company_stamp")}
                      />
                    </div>
                  ) : null}
                </motion.div>
              </AnimatePresence>

              {globalError ? (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[#B91C1C]">
                  {globalError}
                </div>
              ) : null}

              <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-[#64748B]">
                  <CircleAlert className="h-4 w-4" />
                  <span>Formats autorises: PDF, JPG, PNG. Taille max: 5 Mo.</span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {stepIndex > 0 ? (
                    <button
                      type="button"
                      onClick={goToPreviousStep}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Retour</span>
                    </button>
                  ) : null}

                  {stepIndex < steps.length - 1 ? (
                    <button
                      type="button"
                      onClick={goToNextStep}
                      disabled={isCurrentStepBlocked}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[#1D4ED8] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_32px_-18px_rgba(37,99,235,0.6)] transition-all hover:-translate-y-0.5 hover:bg-[#1E40AF] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    >
                      <span>Suivant</span>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSubmit()}
                      disabled={isSubmitting || isCurrentStepBlocked}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_55%,#06B6D4_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_20px_36px_-18px_rgba(99,102,241,0.52)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Upload className="h-4 w-4" />
                      <span>{isSubmitting ? "Envoi en cours..." : "Envoyer la demande"}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/8 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-white/60">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ActionCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Mail;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#DBEAFE] text-[#1D4ED8]">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-semibold text-[#0F172A]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#475569]">{description}</p>
    </div>
  );
}

function TextField({
  label,
  icon: Icon,
  value,
  onChange,
  onBlur,
  error,
  helper,
  type = "text",
  containerClassName,
  trailingAction,
  readOnly = false,
}: {
  label: string;
  icon: typeof Mail;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  helper?: string;
  type?: "text" | "email" | "password" | "number";
  containerClassName?: string;
  trailingAction?: ReactNode;
  readOnly?: boolean;
}) {
  return (
    <label className={`block ${containerClassName || ""}`}>
      <span className="mb-2 block text-sm font-medium text-[#0F172A]">{label}</span>
      <div
        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
          error ? "border-red-300 bg-red-50/70" : "border-slate-200 bg-slate-50/70"
        }`}
      >
        <Icon className={`h-5 w-5 ${error ? "text-[#DC2626]" : "text-[#64748B]"}`} />
        <input
          aria-label={label}
          type={type}
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className="w-full bg-transparent text-sm text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
        />
        {trailingAction}
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-[#DC2626]">{error}</p> : null}
      {!error && helper ? <p className="mt-2 text-sm text-[#64748B]">{helper}</p> : null}
    </label>
  );
}

function SelectField({
  label,
  icon: Icon,
  value,
  onChange,
  options,
  error,
  helper,
  containerClassName,
}: {
  label: string;
  icon: typeof Mail;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  error?: string;
  helper?: string;
  containerClassName?: string;
}) {
  return (
    <label className={`block ${containerClassName || ""}`}>
      <span className="mb-2 block text-sm font-medium text-[#0F172A]">{label}</span>
      <div
        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
          error ? "border-red-300 bg-red-50/70" : "border-slate-200 bg-slate-50/70"
        }`}
      >
        <Icon className={`h-5 w-5 ${error ? "text-[#DC2626]" : "text-[#64748B]"}`} />
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full bg-transparent text-sm font-medium text-[#0F172A] outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-[#DC2626]">{error}</p> : null}
      {!error && helper ? <p className="mt-2 text-sm text-[#64748B]">{helper}</p> : null}
    </label>
  );
}

function RolePreviewCard({ role }: { role: RequestedRoleOption }) {
  const Icon = role.icon;

  return (
    <motion.div
      key={role.value}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`mt-4 rounded-[28px] border p-5 shadow-[0_18px_40px_-30px_rgba(37,99,235,0.28)] ${role.surface_class_name}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div
            className={`inline-flex items-center gap-2 rounded-full border border-white/90 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${role.accent_class_name}`}
          >
            <BadgeCheck className="h-3.5 w-3.5" />
            <span>{role.badge}</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-[#0F172A]">{role.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#475569]">{role.summary}</p>
        </div>
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ${role.accent_class_name}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[24px] border border-white/80 bg-white/85 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
            Fonctionnalites
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {role.features.map((item) => (
              <span
                key={item}
                className={`inline-flex items-center gap-2 rounded-full border border-white bg-white px-3 py-1.5 text-xs font-medium ${role.accent_class_name}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{item}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/80 bg-white/85 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">
            Restrictions
          </p>
          {role.restrictions.length ? (
            <div className="mt-3 space-y-2">
              {role.restrictions.map((item) => (
                <div key={item} className="flex items-start gap-2 text-sm text-[#475569]">
                  <CircleAlert className="mt-0.5 h-4 w-4 text-[#F59E0B]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2 text-sm text-[#475569]">
              <CheckCircle2 className={`mt-0.5 h-4 w-4 ${role.accent_class_name}`} />
              <span>Acces complet au perimetre entreprise valide par le Super Administrateur.</span>
            </div>
          )}
        </div>
      </div>

      {role.value !== "ADMIN" ? (
        <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-[#92400E]">
          Le premier compte d'une entreprise est provisionne en Administrateur pour garantir au
          moins un compte d'administration actif.
        </div>
      ) : null}
    </motion.div>
  );
}

function TextAreaField({
  label,
  icon: Icon,
  value,
  onChange,
  error,
  helper,
}: {
  label: string;
  icon: typeof Mail;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[#0F172A]">{label}</span>
      <div
        className={`rounded-3xl border px-4 py-4 transition-colors ${
          error ? "border-red-300 bg-red-50/70" : "border-slate-200 bg-slate-50/70"
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon className={`h-5 w-5 ${error ? "text-[#DC2626]" : "text-[#64748B]"}`} />
          <textarea
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            className="w-full resize-none bg-transparent text-sm text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
          />
        </div>
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-[#DC2626]">{error}</p> : null}
      {!error && helper ? <p className="mt-2 text-sm text-[#64748B]">{helper}</p> : null}
    </label>
  );
}

function FileField({
  label,
  required,
  file,
  error,
  onChange,
}: {
  label: string;
  required: boolean;
  file: File | null;
  error?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block">
      <div
        className={`rounded-[28px] border p-5 transition-colors ${
          error ? "border-red-300 bg-red-50/70" : "border-slate-200 bg-slate-50/80"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[#1D4ED8] shadow-sm">
              <FileBadge2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-[#0F172A]">{label}</p>
                {required ? (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#DC2626]">
                    Obligatoire
                  </span>
                ) : (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
                    Optionnel
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-[#64748B]">
                PDF, JPG ou PNG. Taille maximale: 5 Mo.
              </p>
              {file ? (
                <p className="mt-3 text-sm font-medium text-[#0F172A]">{file.name}</p>
              ) : (
                <p className="mt-3 text-sm text-[#94A3B8]">Aucun fichier selectionne.</p>
              )}
            </div>
          </div>

          <span className="inline-flex items-center gap-2 rounded-2xl bg-[#DBEAFE] px-4 py-2 text-sm font-semibold text-[#1D4ED8]">
            <Upload className="h-4 w-4" />
            <span>Choisir un fichier</span>
          </span>
        </div>

        <input
          aria-label={label}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={onChange}
          className="mt-4 block w-full cursor-pointer text-sm text-[#475569] file:mr-4 file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-2 file:font-medium file:text-[#0F172A]"
        />
      </div>
      {error ? <p className="mt-2 text-sm font-medium text-[#DC2626]">{error}</p> : null}
    </label>
  );
}
