import {
  Search,
  Bell,
  Download,
  Filter,
  Calendar,
  User,
  FileText,
  FileSpreadsheet,
  File,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../context/AuthContext";
import { formatRoleLabel, getUserAvatarUrl } from "../lib/api";

export default function Header() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const notifications = [
    {
      id: 1,
      type: "anomaly",
      message: "Depassement data detecte sur la ligne +212 6 12 34 56 78",
      time: "Il y a 5 min",
      unread: true,
    },
    {
      id: 2,
      type: "recommendation",
      message: "Nouvelle recommandation IA disponible",
      time: "Il y a 1h",
      unread: true,
    },
    {
      id: 3,
      type: "line",
      message: "Nouvelle ligne ajoutee au parc",
      time: "Il y a 2h",
      unread: false,
    },
    {
      id: 4,
      type: "anomaly",
      message: "Anomalie detectee: consommation inhabituelle",
      time: "Il y a 3h",
      unread: false,
    },
  ];

  const unreadCount = notifications.filter((notification) => notification.unread).length;

  const handleExport = (format: string) => {
    alert(`Export ${format} - Fonctionnalite a venir`);
    setShowExportMenu(false);
  };

  const currentDate = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const formattedDate = currentDate.charAt(0).toUpperCase() + currentDate.slice(1);

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-4 flex-1">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#64748B]" />
          <input
            type="text"
            placeholder="Rechercher..."
            className="w-full pl-10 pr-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
          />
        </div>

        <button className="flex items-center gap-2 px-3 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm text-[#64748B] hover:text-[#0F172A] hover:border-gray-300 transition-colors">
          <Calendar className="w-4 h-4" />
          <span>{formattedDate}</span>
        </button>

        <button className="flex items-center gap-2 px-3 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm text-[#64748B] hover:text-[#0F172A] hover:border-gray-300 transition-colors">
          <Filter className="w-4 h-4" />
          <span>Filtres</span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setShowExportMenu((value) => !value)}
            className="flex items-center gap-2 px-4 py-2 bg-[#2D6CDF] text-white rounded-lg text-sm font-medium hover:bg-[#1d4ed8] transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>

          {showExportMenu ? (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
              <div className="py-2">
                <button
                  onClick={() => handleExport("CSV")}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
                >
                  <FileText className="w-4 h-4 text-[#16A34A]" />
                  <span>Exporter CSV</span>
                </button>
                <button
                  onClick={() => handleExport("Excel")}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-[#16A34A]" />
                  <span>Exporter Excel</span>
                </button>
                <button
                  onClick={() => handleExport("PDF")}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
                >
                  <File className="w-4 h-4 text-[#DC2626]" />
                  <span>Exporter PDF</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowNotifications((value) => !value)}
            className="relative p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] rounded-lg transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 ? (
              <span className="absolute top-1 right-1 w-5 h-5 bg-[#DC2626] text-white text-xs rounded-full flex items-center justify-center font-medium">
                {unreadCount}
              </span>
            ) : null}
          </button>

          {showNotifications ? (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
              <div className="p-4 border-b border-gray-200 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-[#0F172A]">Notifications</h3>
                  <p className="text-xs text-[#64748B] mt-1">{unreadCount} nouvelles notifications</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNotifications(false)}
                  className="p-1.5 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] rounded-lg transition-colors"
                  aria-label="Fermer les notifications"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`p-4 border-b border-gray-100 hover:bg-[#F8FAFC] cursor-pointer transition-colors ${
                      notification.unread ? "bg-blue-50/50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                          notification.type === "anomaly"
                            ? "bg-[#DC2626]"
                            : notification.type === "recommendation"
                              ? "bg-[#2D6CDF]"
                              : "bg-[#16A34A]"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#0F172A]">{notification.message}</p>
                        <p className="text-xs text-[#64748B] mt-1">{notification.time}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 text-center border-t border-gray-200">
                <button className="text-sm text-[#2D6CDF] hover:text-[#1d4ed8] font-medium">
                  Voir toutes les notifications
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => navigate("/admin")}
          className="flex items-center gap-2 pl-3 ml-3 border-l border-gray-200 rounded-lg hover:bg-[#F8FAFC] transition-colors"
        >
          <div className="w-8 h-8 overflow-hidden bg-gradient-to-br from-[#2D6CDF] to-[#06B6D4] rounded-full flex items-center justify-center">
            {user ? (
              <img
                src={getUserAvatarUrl(user.full_name, user.photo_url)}
                alt={user.full_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-4 h-4 text-white" />
            )}
          </div>
          <div className="text-sm text-left">
            <p className="font-medium text-[#0F172A]">{user?.full_name ?? "Admin"}</p>
            <p className="text-xs text-[#64748B]">
              {user ? formatRoleLabel(user.role) : "Administrateur"}
            </p>
          </div>
        </button>
      </div>
    </header>
  );
}
