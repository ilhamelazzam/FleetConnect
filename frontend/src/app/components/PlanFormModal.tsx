import { useEffect, useState } from "react";
import { Globe, MessageSquareText, Package2, Radio, Wallet } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export interface PlanFormData {
  name: string;
  operator_name: string;
  monthly_price: number;
  voice_quota: string;
  data_quota: string;
  sms_quota: string;
  roaming_zone: string;
  active_lines: number;
  description: string;
}

interface PlanFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  initialData?: PlanFormData | null;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSubmit: (data: PlanFormData) => Promise<void>;
}

const defaultFormData: PlanFormData = {
  name: "",
  operator_name: "Orange Maroc",
  monthly_price: 0,
  voice_quota: "",
  data_quota: "",
  sms_quota: "",
  roaming_zone: "",
  active_lines: 0,
  description: "",
};

const smsQuotaOptions = [
  "Illimite",
  "500 SMS",
  "1000 SMS",
  "2000 SMS",
  "5000 SMS",
];

const roamingZoneOptions = [
  "Aucun",
  "Maghreb",
  "International",
  "Monde",
];

function withCurrentValue(options: string[], currentValue: string): string[] {
  const normalizedValue = currentValue.trim();

  if (!normalizedValue || options.includes(normalizedValue)) {
    return options;
  }

  return [normalizedValue, ...options];
}

export default function PlanFormModal({
  open,
  mode,
  initialData,
  isSubmitting = false,
  errorMessage = null,
  onClose,
  onSubmit,
}: PlanFormModalProps) {
  const [formData, setFormData] = useState<PlanFormData>(defaultFormData);
  const availableSmsQuotaOptions = withCurrentValue(smsQuotaOptions, formData.sms_quota);
  const availableRoamingZoneOptions = withCurrentValue(roamingZoneOptions, formData.roaming_zone);

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
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden border border-gray-200 bg-white p-0">
        <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
          <DialogTitle className="flex items-center gap-2 text-2xl font-bold text-[#0F172A]">
            <Package2 className="h-6 w-6 text-[#2D6CDF]" />
            {mode === "create" ? "Ajouter un forfait" : "Modifier le forfait"}
          </DialogTitle>
          <DialogDescription className="text-sm text-[#64748B]">
            {mode === "create"
              ? "Ce formulaire cree un forfait directement dans le backend."
              : "Les modifications sont enregistrees directement dans le backend."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void handleSubmit(event)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 space-y-6 overflow-y-auto p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Nom du forfait</span>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Premium 50Go"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                  minLength={2}
                />
              </label>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Operateur</span>
                <select
                  value={formData.operator_name}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      operator_name: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                >
                  <option value="Orange Maroc">Orange Maroc</option>
                  <option value="Maroc Telecom">Maroc Telecom</option>
                  <option value="inwi">inwi</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Prix mensuel (MAD)</span>
                <div className="relative">
                  <Wallet className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                  <input
                    type="number"
                    min={0}
                    value={formData.monthly_price}
                    onChange={(event) =>
                      setFormData((previous) => ({
                        ...previous,
                        monthly_price: Number(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pr-4 pl-11 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                    required
                  />
                </div>
              </label>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Lignes actives</span>
                <div className="relative">
                  <Radio className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                  <input
                    type="number"
                    min={0}
                    value={formData.active_lines}
                    onChange={(event) =>
                      setFormData((previous) => ({
                        ...previous,
                        active_lines: Number(event.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pr-4 pl-11 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                    required
                  />
                </div>
              </label>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Voix</span>
                <input
                  type="text"
                  value={formData.voice_quota}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      voice_quota: event.target.value,
                    }))
                  }
                  placeholder="Illimite"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                />
              </label>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Data</span>
                <input
                  type="text"
                  value={formData.data_quota}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      data_quota: event.target.value,
                    }))
                  }
                  placeholder="50Go"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                />
              </label>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">SMS</span>
                <div className="relative">
                  <MessageSquareText className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                  <select
                    value={formData.sms_quota}
                    onChange={(event) =>
                      setFormData((previous) => ({
                        ...previous,
                        sms_quota: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pr-4 pl-11 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                    required
                  >
                    <option value="" disabled>
                      Choisir un quota SMS
                    </option>
                    {availableSmsQuotaOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Roaming</span>
                <div className="relative">
                  <Globe className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                  <select
                    value={formData.roaming_zone}
                    onChange={(event) =>
                      setFormData((previous) => ({
                        ...previous,
                        roaming_zone: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pr-4 pl-11 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                    required
                  >
                    <option value="" disabled>
                      Choisir une zone roaming
                    </option>
                    {availableRoamingZoneOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="block text-sm font-medium text-[#0F172A]">Description</span>
                <textarea
                  value={formData.description}
                  onChange={(event) =>
                    setFormData((previous) => ({
                      ...previous,
                      description: event.target.value,
                    }))
                  }
                  rows={4}
                  placeholder="Description courte du forfait"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                />
              </label>
            </div>

            {errorMessage ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {errorMessage}
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 gap-3 border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-[#2D6CDF] px-4 py-2.5 font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? mode === "create"
                  ? "Creation..."
                  : "Mise a jour..."
                : mode === "create"
                  ? "Ajouter le forfait"
                  : "Enregistrer les modifications"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
