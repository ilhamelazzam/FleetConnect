import {
  Search,
  Bell,
  Download,
  Filter,
  Calendar,
  User,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  File,
  LogOut,
  Settings,
  Shield,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";

import { Calendar as CalendarUI } from "../components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationsContext";
import { toggleFilterPanel } from "../lib/filter-panel";
import { buildSearchUrl, canUseHeaderSearch, getPageSearchQuery } from "../lib/page-search";
import { formatRoleLabel, getUserAvatarUrl } from "../lib/api";
import { canAccessAdminCenter } from "../lib/roles";
import { exportCurrentView, type ExportFormat } from "../lib/view-export";
import NotificationsPanel from "./NotificationsPanel";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [activeExportFormat, setActiveExportFormat] = useState<ExportFormat | null>(null);

  const isAdmin = canAccessAdminCenter(user);

  const handleExport = (format: ExportFormat) => {
    setActiveExportFormat(format);

    try {
      const result = exportCurrentView(format, location.pathname);
      toast.success(
        format === "pdf" ? "Preparation du PDF" : "Export genere",
        {
          description:
            result.mode === "print"
              ? "La fenetre d'impression est ouverte pour enregistrer le PDF."
              : `${result.filename} a ete telecharge.`,
        },
      );
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Impossible de generer l'export pour la vue courante.";
      toast.error("Echec de l'export", { description });
    } finally {
      setActiveExportFormat(null);
      setShowExportMenu(false);
    }
  };

  const handleOpenAccount = () => {
    navigate("/profil");
  };

  const handleOpenAdminCenter = () => {
    navigate("/admin");
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const canToggleFilters =
    location.pathname === "/dashboard" || location.pathname === "/lignes";
  const canSearchCurrentPage = canUseHeaderSearch(location.pathname);

  useEffect(() => {
    if (!canSearchCurrentPage) {
      setSearchValue("");
      return;
    }

    setSearchValue(getPageSearchQuery(location.search));
  }, [canSearchCurrentPage, location.search]);

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setSearchValue(nextValue);

    if (!canSearchCurrentPage) {
      return;
    }

    navigate(buildSearchUrl(location.pathname, location.search, nextValue), { replace: true });
  };

  const currentDate = format(selectedDate, "d MMMM yyyy", { locale: fr });
  const formattedDate = currentDate.charAt(0).toUpperCase() + currentDate.slice(1);

  return (
    <header className="flex h-16 items-center justify-between border-b border-[var(--bc-neutral-border)] bg-white/95 px-6 backdrop-blur transition-colors duration-300 dark:bg-[#08101f]/95">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--bc-neutral-body)]" />
          <input
            type="text"
            value={searchValue}
            onChange={handleSearchChange}
            placeholder={canSearchCurrentPage ? "Rechercher..." : "Recherche indisponible ici"}
            disabled={!canSearchCurrentPage}
            className={`w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--bc-primary)] focus:border-transparent ${
              canSearchCurrentPage
                ? "border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] text-[var(--bc-neutral-strong)]"
                : "cursor-not-allowed border-[var(--bc-neutral-border)] bg-white text-[var(--bc-neutral-muted)] dark:bg-[#08101f]"
            }`}
          />
        </div>

        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-3 py-2 text-sm text-[var(--bc-neutral-body)] transition-colors hover:border-[var(--bc-primary-border)] hover:text-[var(--bc-primary)]"
            >
              <Calendar className="w-4 h-4" />
              <span>{formattedDate}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarUI
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                if (!date) {
                  return;
                }

                setSelectedDate(date);
                setIsCalendarOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => {
            if (canToggleFilters) {
              toggleFilterPanel();
            }
          }}
          className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
            canToggleFilters
              ? "border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] text-[var(--bc-neutral-body)] hover:border-[var(--bc-primary-border)] hover:text-[var(--bc-primary)]"
              : "border-[var(--bc-neutral-border)] bg-white text-[var(--bc-neutral-muted)] dark:bg-[#08101f]"
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>Filtres</span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setShowExportMenu((value) => !value)}
            className="flex items-center gap-2 rounded-lg bg-[var(--bc-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--bc-primary-hover)]"
          >
            <Download className="w-4 h-4" />
            <span>Exporter</span>
          </button>

          {showExportMenu ? (
            <div className="absolute right-0 z-50 mt-2 w-48 rounded-2xl border border-[var(--bc-neutral-border)] bg-white shadow-xl transition-colors duration-300 dark:bg-[#08101f]">
              <div className="py-2">
                <button
                  type="button"
                  onClick={() => handleExport("csv")}
                  disabled={activeExportFormat !== null}
                  className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--bc-neutral-strong)] transition-colors hover:bg-[var(--bc-primary-soft)]"
                >
                  <FileText className="w-4 h-4 text-[var(--bc-primary)]" />
                  <span>Exporter CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("excel")}
                  disabled={activeExportFormat !== null}
                  className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--bc-neutral-strong)] transition-colors hover:bg-[var(--bc-primary-soft)]"
                >
                  <FileSpreadsheet className="w-4 h-4 text-[var(--bc-primary)]" />
                  <span>Exporter Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("pdf")}
                  disabled={activeExportFormat !== null}
                  className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--bc-neutral-strong)] transition-colors hover:bg-[var(--bc-primary-soft)]"
                >
                  <File className="w-4 h-4 text-[var(--bc-primary)]" />
                  <span>Exporter PDF</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowNotifications((value) => !value)}
            className="relative rounded-lg p-2 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary)]"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 ? (
              <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bc-danger)] text-xs font-medium text-white">
                {unreadCount}
              </span>
            ) : null}
          </button>

          <NotificationsPanel
            isOpen={showNotifications}
            onClose={() => setShowNotifications(false)}
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ml-3 flex items-center gap-2 rounded-lg border-l border-[var(--bc-neutral-border)] pl-3 transition-colors hover:bg-[var(--bc-primary-soft)]"
              aria-label="Ouvrir le menu du profil"
            >
              <div className="bc-gradient-primary flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
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
                <p className="font-medium text-[var(--bc-neutral-strong)]">{user?.full_name ?? "Admin"}</p>
                <p className="text-xs text-[var(--bc-neutral-body)]">
                  {user ? formatRoleLabel(user.role) : "Administrateur"}
                </p>
              </div>
              <ChevronDown className="w-4 h-4 text-[var(--bc-neutral-muted)]" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-72 rounded-2xl border border-[var(--bc-neutral-border)] bg-white p-2 shadow-xl transition-colors duration-300 dark:bg-[#08101f]"
          >
            <DropdownMenuLabel className="px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="bc-gradient-primary flex h-10 w-10 items-center justify-center overflow-hidden rounded-full">
                  {user ? (
                    <img
                      src={getUserAvatarUrl(user.full_name, user.photo_url)}
                      alt={user.full_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--bc-neutral-strong)]">
                    {user?.full_name ?? "Utilisateur"}
                  </p>
                  <p className="truncate text-xs text-[var(--bc-neutral-body)]">{user?.email ?? "-"}</p>
                  <p className="mt-1 text-xs font-medium text-[var(--bc-primary)]">
                    {user ? formatRoleLabel(user.role) : "Administrateur"}
                  </p>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator className="bg-[var(--bc-neutral-border)]" />

            <DropdownMenuItem
              onSelect={handleOpenAccount}
              className="rounded-xl px-3 py-2.5 text-[var(--bc-neutral-strong)] focus:bg-[var(--bc-primary-soft)] focus:text-[var(--bc-primary)]"
            >
              <Settings className="w-4 h-4 text-[var(--bc-primary)]" />
              <span>Mon compte</span>
            </DropdownMenuItem>

            {isAdmin ? (
              <DropdownMenuItem
                onSelect={handleOpenAdminCenter}
                className="rounded-xl px-3 py-2.5 text-[var(--bc-neutral-strong)] focus:bg-[var(--bc-primary-soft)] focus:text-[var(--bc-primary)]"
              >
                <Shield className="w-4 h-4 text-[var(--bc-ai-start)]" />
                <span>Centre admin</span>
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuSeparator className="bg-[var(--bc-neutral-border)]" />

            <DropdownMenuItem
              onSelect={handleLogout}
              className="rounded-xl px-3 py-2.5 text-[var(--bc-danger)] focus:bg-[var(--bc-danger-soft)] focus:text-[var(--bc-danger)]"
            >
              <LogOut className="w-4 h-4 text-[var(--bc-danger)]" />
              <span>Se deconnecter</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
