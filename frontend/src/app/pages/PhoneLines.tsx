import { useEffect, useState } from "react";
import { Calendar, Download, Filter, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import AddLineModal, { type LineFormData } from "../components/AddLineModal";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Calendar as CalendarUI } from "../components/ui/calendar";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  phoneLinesApi,
  type ApiPhoneLine,
  type CreatePhoneLinePayload,
} from "../lib/api";

const getOperatorStyles = (operator: string) => {
  if (operator === "Orange Maroc") {
    return { bg: "#FFF5EB", color: "#FF6600" };
  }
  if (operator === "Maroc Telecom") {
    return { bg: "#FFEEF0", color: "#E60012" };
  }
  if (operator === "inwi") {
    return { bg: "#E6F7FF", color: "#009FE3" };
  }
  return { bg: "#F3F4F6", color: "#6B7280" };
};

function getPlanLimit(planName: string): number | null {
  if (planName === "Standard 20Go") {
    return 20;
  }
  if (planName === "Premium 50Go") {
    return 50;
  }
  if (planName === "Business 100Go") {
    return 100;
  }
  if (planName === "Enterprise 200Go") {
    return 200;
  }
  return null;
}

function normalizePhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  return phoneNumber.trim().startsWith("+") ? `+${digits}` : digits;
}

function formatPhoneNumberDisplay(phoneNumber: string): string {
  if (!phoneNumber.startsWith("+")) {
    return phoneNumber;
  }

  const digits = phoneNumber.slice(1);
  return `+${digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim()}`;
}

function formatStatusLabel(status: string): string {
  if (status === "active") {
    return "Actif";
  }
  if (status === "inactive") {
    return "Inactif";
  }
  if (status === "suspended") {
    return "Suspendu";
  }
  return status;
}

function getStatusClasses(status: string): string {
  if (status === "active") {
    return "bg-green-50 text-[#16A34A]";
  }
  if (status === "suspended") {
    return "bg-orange-50 text-[#F59E0B]";
  }
  return "bg-gray-50 text-[#64748B]";
}

function getRiskLabel(line: ApiPhoneLine): string {
  if (line.status === "inactive") {
    return "Aucun";
  }
  if (line.status === "suspended") {
    return "Moyen";
  }
  if ((line.monthly_limit ?? 0) >= 100) {
    return "Eleve";
  }
  if ((line.monthly_limit ?? 0) >= 50) {
    return "Moyen";
  }
  return "Faible";
}

function getRiskClasses(risk: string): string {
  if (risk === "Eleve") {
    return "bg-red-50 text-[#DC2626]";
  }
  if (risk === "Moyen") {
    return "bg-orange-50 text-[#F59E0B]";
  }
  if (risk === "Faible") {
    return "bg-green-50 text-[#16A34A]";
  }
  return "bg-gray-50 text-[#64748B]";
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function toFormData(line: ApiPhoneLine): LineFormData {
  return {
    phone_number: line.phone_number,
    assigned_to: line.assigned_to ?? "",
    department: line.department ?? "",
    operator_name: line.operator_name,
    plan_name: line.plan_name,
  };
}

function buildPhoneLinePayload(data: LineFormData): CreatePhoneLinePayload {
  return {
    phone_number: normalizePhoneNumber(data.phone_number),
    operator_name: data.operator_name,
    plan_name: data.plan_name,
    assigned_to: data.assigned_to,
    department: data.department,
    status: "active",
    monthly_limit: getPlanLimit(data.plan_name),
    notes: null,
  };
}

export default function PhoneLines() {
  const { token } = useAuth();
  const [lines, setLines] = useState<ApiPhoneLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<ApiPhoneLine | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [showFilters, setShowFilters] = useState(false);

  async function loadLines(): Promise<void> {
    if (!token) {
      setLines([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const apiLines = await phoneLinesApi.list(token);
      setLines(apiLines);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Impossible de charger les lignes."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLines();
  }, [token]);

  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true);

    try {
      await loadLines();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExport = () => {
    alert("Export des donnees en cours... (CSV/Excel/PDF)");
  };

  const closeModal = () => {
    if (isSubmitting) {
      return;
    }
    setIsAddModalOpen(false);
    setEditingLine(null);
    setFormError(null);
  };

  const openCreateModal = () => {
    setEditingLine(null);
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (line: ApiPhoneLine) => {
    setEditingLine(line);
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleSubmitLine = async (data: LineFormData): Promise<void> => {
    if (!token) {
      setFormError("Session expiree. Reconnectez-vous.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (editingLine) {
        const updatedLine = await phoneLinesApi.update(token, editingLine.id, {
          ...buildPhoneLinePayload(data),
          status: editingLine.status,
          notes: editingLine.notes,
        });
        setLines((previousLines) =>
          previousLines.map((line) => (line.id === updatedLine.id ? updatedLine : line)),
        );
      } else {
        const createdLine = await phoneLinesApi.create(token, buildPhoneLinePayload(data));
        setLines((previousLines) => [createdLine, ...previousLines]);
      }

      closeModal();
    } catch (error) {
      setFormError(
        normalizeError(error, "Impossible d enregistrer cette ligne pour le moment."),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLine = async (line: ApiPhoneLine): Promise<void> => {
    if (!token) {
      setErrorMessage("Session expiree. Reconnectez-vous.");
      return;
    }

    const confirmed = window.confirm(
      `Supprimer la ligne ${formatPhoneNumberDisplay(line.phone_number)} ?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await phoneLinesApi.remove(token, line.id);
      setLines((previousLines) => previousLines.filter((currentLine) => currentLine.id !== line.id));
    } catch (error) {
      setErrorMessage(normalizeError(error, "Suppression impossible pour le moment."));
    }
  };

  const filteredLines = lines.filter((line) => {
    const matchesSearch =
      searchQuery.trim() === "" ||
      line.phone_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (line.assigned_to ?? "").toLowerCase().includes(searchQuery.toLowerCase());

    const matchesOperator =
      selectedOperator === "all" || line.operator_name === selectedOperator;
    const matchesDepartment =
      selectedDepartment === "all" || line.department === selectedDepartment;
    const matchesStatus = selectedStatus === "all" || line.status === selectedStatus;

    return matchesSearch && matchesOperator && matchesDepartment && matchesStatus;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Gestion des lignes</h1>
          <p className="text-[#64748B]">Gerez toutes les lignes telephoniques de votre flotte</p>
        </div>
        <div className="flex gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-[#64748B] rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors">
                <Calendar className="w-5 h-5" />
                <span>
                  {dateRange.from
                    ? format(dateRange.from, "MMM yyyy", { locale: fr })
                    : "Mars 2026"}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <CalendarUI
                mode="single"
                selected={dateRange.from}
                onSelect={(date) => setDateRange({ from: date })}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-[#64748B] rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors"
          >
            <Download className="w-5 h-5" />
            <span>Exporter</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-[#2D6CDF] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors shadow-lg shadow-blue-500/30"
          >
            <Plus className="w-5 h-5" />
            <span>Ajouter ligne</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => setShowFilters((previousValue) => !previousValue)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm font-medium text-[#64748B] hover:bg-gray-100 transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span>{showFilters ? "Masquer filtres" : "Afficher filtres"}</span>
          </button>
          <span className="text-sm text-[#64748B]">
            {filteredLines.length} ligne{filteredLines.length > 1 ? "s" : ""} trouvee
            {filteredLines.length > 1 ? "s" : ""}
          </span>
        </div>

        {showFilters ? (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 pt-4 border-t border-gray-200">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type="text"
                placeholder="Rechercher une ligne..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
              />
            </div>
            <select
              value={selectedOperator}
              onChange={(event) => setSelectedOperator(event.target.value)}
              className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
            >
              <option value="all">Tous les operateurs</option>
              <option value="Orange Maroc">Orange Maroc</option>
              <option value="Maroc Telecom">Maroc Telecom</option>
              <option value="inwi">inwi</option>
            </select>
            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
            >
              <option value="all">Tous les departements</option>
              <option value="Commercial">Commercial</option>
              <option value="IT">IT</option>
              <option value="Direction">Direction</option>
              <option value="RH">RH</option>
              <option value="Marketing">Marketing</option>
              <option value="Support">Support</option>
              <option value="Ventes">Ventes</option>
              <option value="Finance">Finance</option>
              <option value="Logistique">Logistique</option>
            </select>
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Actif</option>
              <option value="suspended">Suspendu</option>
              <option value="inactive">Inactif</option>
            </select>
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm text-[#64748B]">Chargement des lignes...</p>
          </div>
        ) : filteredLines.length === 0 ? (
          <div className="px-6 py-14 text-center space-y-4">
            <p className="text-sm text-[#64748B]">
              Aucune ligne ne correspond aux filtres actuels.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2D6CDF] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Ajouter votre premiere ligne</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F8FAFC] border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Numero</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Utilisateur</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Departement</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Operateur</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Statut</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Forfait</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Consommation</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Score risque</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredLines.map((line) => {
                  const operatorStyles = getOperatorStyles(line.operator_name);
                  const riskLabel = getRiskLabel(line);
                  return (
                    <tr key={line.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2 font-medium text-[#0F172A]">
                          <span>{formatPhoneNumberDisplay(line.phone_number)}</span>
                          <span className="text-xs text-[#64748B]">
                            {`L-${String(line.id).padStart(3, "0")}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#0F172A]">
                        {line.assigned_to ?? "-"}
                      </td>
                      <td className="px-6 py-4 text-sm text-[#64748B]">
                        {line.department ?? "-"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{
                            backgroundColor: operatorStyles.bg,
                            color: operatorStyles.color,
                          }}
                        >
                          {line.operator_name}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusClasses(line.status)}`}
                        >
                          {formatStatusLabel(line.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-[#0F172A]">{line.plan_name}</td>
                      <td className="px-6 py-4 text-sm text-[#0F172A]">
                        {line.monthly_limit ? `0 / ${line.monthly_limit}Go` : "Illimite"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getRiskClasses(riskLabel)}`}
                        >
                          {riskLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-start gap-3 whitespace-nowrap">
                          <Link
                            to={`/lignes/${line.id}`}
                            className="text-sm text-[#2D6CDF] hover:text-[#1d4ed8] font-medium"
                          >
                            Détails
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEditModal(line)}
                            className="inline-flex items-center gap-1 text-sm text-[#64748B] hover:text-[#0F172A] font-medium"
                          >
                            <Pencil className="w-4 h-4" />
                            <span>Modifier</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteLine(line)}
                            className="inline-flex items-center gap-1 text-sm text-[#DC2626] hover:text-[#b91c1c] font-medium"
                          >
                            <Trash2 className="w-4 h-4" />
                            <span>Supprimer</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#64748B]">
          Affichage de {filteredLines.length} ligne{filteredLines.length > 1 ? "s" : ""} sur{" "}
          {lines.length}
        </p>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={isLoading || isRefreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          <span>{isRefreshing ? "Rafraichissement..." : "Rafraichir"}</span>
        </button>
      </div>

      <AddLineModal
        open={isAddModalOpen}
        mode={editingLine ? "edit" : "create"}
        initialData={editingLine ? toFormData(editingLine) : null}
        isSubmitting={isSubmitting}
        errorMessage={formError}
        onClose={closeModal}
        onSubmit={handleSubmitLine}
      />
    </div>
  );
}
