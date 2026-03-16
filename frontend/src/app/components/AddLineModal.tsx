import { useEffect, useState } from "react";
import { Building2, CreditCard, Phone, User } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

interface AddLineModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialData?: LineFormData | null;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSubmit: (data: LineFormData) => Promise<void>;
}

export interface LineFormData {
  phone_number: string;
  assigned_to: string;
  department: string;
  operator_name: string;
  plan_name: string;
}

const defaultFormData: LineFormData = {
  phone_number: "",
  assigned_to: "",
  department: "",
  operator_name: "Orange Maroc",
  plan_name: "Standard 20Go",
};

export default function AddLineModal({
  open,
  mode,
  initialData,
  isSubmitting = false,
  errorMessage = null,
  onClose,
  onSubmit,
}: AddLineModalProps) {
  const [formData, setFormData] = useState<LineFormData>(defaultFormData);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFormData(initialData ?? defaultFormData);
  }, [initialData, open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit(formData);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[#0F172A] flex items-center gap-2">
            <Phone className="w-6 h-6 text-[#2D6CDF]" />
            {mode === "create" ? "Ajouter une nouvelle ligne" : "Modifier la ligne"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6 mt-4">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Numero de telephone *
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type="tel"
                  value={formData.phone_number}
                  onChange={(event) =>
                    setFormData((previousFormData) => ({
                      ...previousFormData,
                      phone_number: event.target.value,
                    }))
                  }
                  placeholder="+212 6 12 34 56 78"
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Utilisateur *
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type="text"
                  value={formData.assigned_to}
                  onChange={(event) =>
                    setFormData((previousFormData) => ({
                      ...previousFormData,
                      assigned_to: event.target.value,
                    }))
                  }
                  placeholder="Nom complet"
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Departement *
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <select
                  value={formData.department}
                  onChange={(event) =>
                    setFormData((previousFormData) => ({
                      ...previousFormData,
                      department: event.target.value,
                    }))
                  }
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                >
                  <option value="">Selectionner un departement</option>
                  <option value="Commercial">Commercial</option>
                  <option value="Direction">Direction</option>
                  <option value="IT">IT</option>
                  <option value="RH">RH</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Support">Support</option>
                  <option value="Ventes">Ventes</option>
                  <option value="Finance">Finance</option>
                  <option value="Logistique">Logistique</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Operateur *
              </label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <select
                  value={formData.operator_name}
                  onChange={(event) =>
                    setFormData((previousFormData) => ({
                      ...previousFormData,
                      operator_name: event.target.value,
                    }))
                  }
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                >
                  <option value="Orange Maroc">Orange Maroc</option>
                  <option value="Maroc Telecom">Maroc Telecom</option>
                  <option value="inwi">inwi</option>
                </select>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Forfait *
              </label>
              <select
                value={formData.plan_name}
                onChange={(event) =>
                  setFormData((previousFormData) => ({
                    ...previousFormData,
                    plan_name: event.target.value,
                  }))
                }
                className="w-full px-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                required
              >
                <option value="Standard 20Go">Standard 20Go (20 Go)</option>
                <option value="Premium 50Go">Premium 50Go (50 Go)</option>
                <option value="Business 100Go">Business 100Go (100 Go)</option>
                <option value="Enterprise 200Go">Enterprise 200Go (200 Go)</option>
                <option value="Illimite">Illimite</option>
              </select>
            </div>
          </div>

          <div className="bg-[#F8FAFC] rounded-lg p-4 border border-gray-200">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 bg-[#2D6CDF] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-xs">i</span>
              </div>
              <div>
                <p className="text-sm text-[#0F172A] font-medium mb-1">
                  {mode === "create" ? "Activation de la ligne" : "Mise a jour de la ligne"}
                </p>
                <p className="text-xs text-[#64748B]">
                  {mode === "create"
                    ? "La nouvelle ligne sera creee dans le backend des la validation du formulaire."
                    : "Les modifications sont appliquees immediatement dans le backend."}
                </p>
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 border border-gray-200 text-[#64748B] rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] text-white rounded-lg font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? mode === "create"
                  ? "Creation..."
                  : "Mise a jour..."
                : mode === "create"
                  ? "Ajouter la ligne"
                  : "Enregistrer les modifications"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
