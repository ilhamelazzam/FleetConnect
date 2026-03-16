import { FileText, Download, Mail, Calendar } from "lucide-react";

const reports = [
  {
    id: "RPT-001",
    name: "Rapport mensuel des coûts",
    description: "Analyse complète des coûts mensuels par département et opérateur",
    period: "Mars 2026",
    generated: "2026-03-09",
    size: "2.4 MB",
    format: "PDF",
  },
  {
    id: "RPT-002",
    name: "Rapport anomalies",
    description: "Liste détaillée de toutes les anomalies détectées et leur traitement",
    period: "Mars 2026",
    generated: "2026-03-09",
    size: "1.8 MB",
    format: "Excel",
  },
  {
    id: "RPT-003",
    name: "Rapport prédictions",
    description: "Prévisions de coûts avec analyse des facteurs influents",
    period: "T2 2026",
    generated: "2026-03-08",
    size: "3.1 MB",
    format: "PDF",
  },
  {
    id: "RPT-004",
    name: "Rapport recommandations",
    description: "Recommandations d'optimisation et économies potentielles",
    period: "Mars 2026",
    generated: "2026-03-07",
    size: "1.5 MB",
    format: "PDF",
  },
  {
    id: "RPT-005",
    name: "Rapport consommation détaillée",
    description: "Événements de consommation ligne par ligne",
    period: "Février 2026",
    generated: "2026-03-01",
    size: "5.2 MB",
    format: "Excel",
  },
  {
    id: "RPT-006",
    name: "Rapport KPIs exécutif",
    description: "Vue synthétique des KPIs pour la direction",
    period: "Q1 2026",
    generated: "2026-03-05",
    size: "890 KB",
    format: "PDF",
  },
];

const recentExports = [
  { date: "2026-03-09 14:32", user: "Admin", report: "Rapport mensuel des coûts", format: "PDF", status: "Terminé" },
  { date: "2026-03-09 10:15", user: "Manager Commercial", report: "Rapport anomalies", format: "Excel", status: "Terminé" },
  { date: "2026-03-08 16:45", user: "Admin", report: "Rapport prédictions", format: "PDF", status: "Terminé" },
  { date: "2026-03-07 11:30", user: "Directeur IT", report: "Rapport consommation détaillée", format: "Excel", status: "Terminé" },
];

export default function Reports() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Rapports & Exports</h1>
          <p className="text-[#64748B]">Générez et téléchargez vos rapports d'analyse</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button className="flex items-center gap-3 p-4 bg-gradient-to-r from-[#2563EB] to-[#06B6D4] text-white rounded-xl hover:opacity-90 transition-opacity">
          <FileText className="w-6 h-6" />
          <div className="text-left">
            <p className="font-semibold">Nouveau rapport personnalisé</p>
            <p className="text-xs text-white/80">Créez un rapport sur mesure</p>
          </div>
        </button>
        <button className="flex items-center gap-3 p-4 bg-white border-2 border-gray-200 rounded-xl hover:border-[#2563EB] transition-colors">
          <Calendar className="w-6 h-6 text-[#2563EB]" />
          <div className="text-left">
            <p className="font-semibold text-[#0F172A]">Programmer un rapport</p>
            <p className="text-xs text-[#64748B]">Configuration automatique</p>
          </div>
        </button>
        <button className="flex items-center gap-3 p-4 bg-white border-2 border-gray-200 rounded-xl hover:border-[#2563EB] transition-colors">
          <Mail className="w-6 h-6 text-[#2563EB]" />
          <div className="text-left">
            <p className="font-semibold text-[#0F172A]">Envoyer par email</p>
            <p className="text-xs text-[#64748B]">Distribution automatique</p>
          </div>
        </button>
      </div>

      {/* Available Reports */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-[#F8FAFC]">
          <h2 className="text-lg font-semibold text-[#0F172A]">Rapports disponibles</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
          {reports.map((report) => (
            <div
              key={report.id}
              className="border-2 border-gray-200 rounded-xl p-4 hover:border-[#2563EB] transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[#2563EB] bg-opacity-10 rounded-lg flex items-center justify-center">
                    <FileText className="w-6 h-6 text-[#2563EB]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0F172A] mb-1">{report.name}</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        report.format === "PDF"
                          ? "bg-red-50 text-[#DC2626]"
                          : "bg-green-50 text-[#16A34A]"
                      }`}
                    >
                      {report.format}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-[#64748B] mb-3">{report.description}</p>

              <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                <div>
                  <p className="text-[#64748B]">Période</p>
                  <p className="font-medium text-[#0F172A]">{report.period}</p>
                </div>
                <div>
                  <p className="text-[#64748B]">Généré le</p>
                  <p className="font-medium text-[#0F172A]">{report.generated}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <span className="text-xs text-[#64748B]">Taille: {report.size}</span>
                <div className="flex gap-2">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563EB] text-white rounded-lg text-xs font-medium hover:bg-[#1d4ed8] transition-colors">
                    <Download className="w-3.5 h-3.5" />
                    <span>Télécharger</span>
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-[#64748B] rounded-lg text-xs font-medium hover:bg-[#F8FAFC] transition-colors">
                    <Mail className="w-3.5 h-3.5" />
                    <span>Envoyer</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export History */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#0F172A]">Historique des exports</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F8FAFC] border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Date & Heure</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Utilisateur</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Rapport</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Format</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentExports.map((exp, idx) => (
                <tr key={idx} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-6 py-4 text-sm text-[#0F172A]">{exp.date}</td>
                  <td className="px-6 py-4 text-sm text-[#64748B]">{exp.user}</td>
                  <td className="px-6 py-4 text-sm font-medium text-[#0F172A]">{exp.report}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        exp.format === "PDF"
                          ? "bg-red-50 text-[#DC2626]"
                          : "bg-green-50 text-[#16A34A]"
                      }`}
                    >
                      {exp.format}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-[#16A34A]">
                      {exp.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Report Templates */}
      <div className="bg-gradient-to-br from-[#F8FAFC] to-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Modèles de rapports</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-[#0F172A] mb-2">Rapport mensuel standard</h3>
            <p className="text-sm text-[#64748B] mb-3">Vue d'ensemble mensuelle complète</p>
            <button className="w-full px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1d4ed8] transition-colors">
              Utiliser ce modèle
            </button>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-[#0F172A] mb-2">Rapport exécutif</h3>
            <p className="text-sm text-[#64748B] mb-3">Synthèse pour la direction</p>
            <button className="w-full px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1d4ed8] transition-colors">
              Utiliser ce modèle
            </button>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-[#0F172A] mb-2">Audit détaillé</h3>
            <p className="text-sm text-[#64748B] mb-3">Analyse approfondie technique</p>
            <button className="w-full px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1d4ed8] transition-colors">
              Utiliser ce modèle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
