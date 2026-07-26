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
  LoaderCircle,
  Settings,
  Shield,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { createPortal } from "react-dom";
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
import {
  toggleFilterPanel,
  subscribeToFilterPanelState,
  type FilterPanelState,
} from "../lib/filter-panel";
import { buildSearchUrl, canUseHeaderSearch, getPageSearchQuery } from "../lib/page-search";
import { formatRoleLabel, getUserAvatarUrl } from "../lib/api";
import { canAccessAdminCenter, canAccessSuperAdmin } from "../lib/roles";
import { exportCurrentView, type ExportFormat } from "../lib/view-export";
import NotificationsPanel from "./NotificationsPanel";

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationAnchorRect, setNotificationAnchorRect] = useState<DOMRect | null>(null);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [activeExportFormat, setActiveExportFormat] = useState<ExportFormat | null>(null);
  const notificationButtonRef = useRef<HTMLButtonElement | null>(null);

  const isAdmin = canAccessAdminCenter(user);
  const isSuperAdmin = canAccessSuperAdmin(user);
  const [filterPanelState, setFilterPanelState] = useState<FilterPanelState>({
    activeCount: 0,
    isOpen: false,
  });

  useEffect(() => {
    return subscribeToFilterPanelState((state) => {
      setFilterPanelState(state);
    });
  }, []);

  useEffect(() => {
    if (!isDownloadOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDownloadOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isDownloadOpen]);

  useEffect(() => {
    if (!showNotifications) {
      return;
    }

    const updateNotificationAnchor = () => {
      setNotificationAnchorRect(notificationButtonRef.current?.getBoundingClientRect() ?? null);
    };

    updateNotificationAnchor();
    window.addEventListener("resize", updateNotificationAnchor);
    window.addEventListener("scroll", updateNotificationAnchor, true);

    return () => {
      window.removeEventListener("resize", updateNotificationAnchor);
      window.removeEventListener("scroll", updateNotificationAnchor, true);
    };
  }, [showNotifications]);

  const handleExport = (format: ExportFormat) => {
    setActiveExportFormat(format);

    try {
      const result = exportCurrentView(format, location.pathname);
      toast.success(
        format === "pdf" ? "Rapport PDF en preparation" : "Rapport telecharge",
        {
          description:
            result.mode === "print"
              ? "La fenetre d'impression est ouverte pour enregistrer votre rapport."
              : `${result.filename} a ete telecharge.`,
        },
      );
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Impossible de telecharger le rapport pour la vue courante.";
      toast.error("Telechargement impossible", { description });
    } finally {
      setActiveExportFormat(null);
      setIsDownloadOpen(false);
    }
  };

  const handleOpenDownloadModal = () => {
    console.log("Download clicked");
    setIsDownloadOpen(true);
  };

  const handleToggleNotifications = () => {
    if (!showNotifications) {
      setNotificationAnchorRect(notificationButtonRef.current?.getBoundingClientRect() ?? null);
    }

    setShowNotifications((value) => !value);
  };

  const handleOpenAccount = () => {
    navigate("/profil");
  };

  const handleOpenAdminCenter = () => {
    navigate(isSuperAdmin ? "/admin/dashboard" : "/admin-center");
  };

  const handleLogout = () => {
    logout();
    navigate(isSuperAdmin ? "/admin/login" : "/login", { replace: true });
  };

  const canToggleFilters =
    location.pathname === "/dashboard" ||
    location.pathname === "/lignes" ||
    location.pathname === "/forfaits/attributions";
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
  const downloadModal =
    isDownloadOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[9999]">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
              onClick={() => setIsDownloadOpen(false)}
              aria-hidden="true"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="download-report-title"
              aria-describedby="download-report-description"
              className="fixed top-1/2 left-1/2 z-[10000] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-[var(--bc-neutral-border)] bg-white shadow-[0_36px_90px_-36px_rgba(15,23,42,0.38)] transition-colors duration-300 dark:bg-[#08101f]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-[var(--bc-neutral-border)] bg-[linear-gradient(135deg,#F8FBFF_0%,#FFFFFF_65%,#EEF4FF_100%)] px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-primary)]">
                      Telechargement
                    </p>
                    <h2
                      id="download-report-title"
                      className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--bc-neutral-strong)]"
                    >
                      Telecharger le rapport
                    </h2>
                    <p
                      id="download-report-description"
                      className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]"
                    >
                      Choisissez le format souhaite pour exporter la vue courante.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsDownloadOpen(false)}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--bc-neutral-border)] bg-white/90 text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] dark:bg-[#0f172a]"
                    aria-label="Fermer la fenetre de telechargement"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3 p-5">
                {[
                  {
                    format: "csv" as const,
                    label: "Telecharger CSV",
                    description: "Format tabulaire simple pour Excel ou import rapide.",
                    icon: FileText,
                  },
                  {
                    format: "excel" as const,
                    label: "Telecharger Excel",
                    description: "Fichier pret pour analyse, partage ou retraitement.",
                    icon: FileSpreadsheet,
                  },
                  {
                    format: "pdf" as const,
                    label: "Telecharger PDF",
                    description: "Version presentable pour lecture et impression.",
                    icon: File,
                  },
                ].map((option) => {
                  const Icon = option.icon;
                  const isActive = activeExportFormat === option.format;

                  return (
                    <button
                      key={option.format}
                      type="button"
                      onClick={() => handleExport(option.format)}
                      disabled={activeExportFormat !== null}
                      className="flex w-full items-start gap-4 rounded-[22px] border border-[var(--bc-neutral-border)] bg-[linear-gradient(135deg,#FFFFFF,#F8FAFC)] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--bc-primary-border)] hover:bg-[var(--bc-primary-soft)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[linear-gradient(135deg,#08101f,#0f172a)]"
                    >
                      <span className="bc-icon-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                        {isActive ? (
                          <LoaderCircle className="h-5 w-5 animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[var(--bc-neutral-strong)]">
                          {option.label}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-[var(--bc-neutral-body)]">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
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
          className={`relative flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
            canToggleFilters
              ? filterPanelState.activeCount > 0
                ? "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)] hover:bg-[var(--bc-primary-hover)]"
                : "border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] text-[var(--bc-neutral-body)] hover:border-[var(--bc-primary-border)] hover:text-[var(--bc-primary)]"
              : "border-[var(--bc-neutral-border)] bg-white text-[var(--bc-neutral-muted)] dark:bg-[#08101f]"
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>Filtres</span>
          {canToggleFilters && filterPanelState.activeCount > 0 ? (
            <span className="absolute -right-1 top-0 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--bc-primary)] px-1.5 text-[10px] font-semibold text-white">
              {filterPanelState.activeCount}
            </span>
          ) : null}
        </button>
      </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenDownloadModal}
            className="flex items-center gap-2 rounded-lg bg-[var(--bc-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--bc-primary-hover)]"
          >
            <Download className="w-4 h-4" />
            <span>Telecharger le rapport</span>
          </button>

          <div className="relative">
            <button
              ref={notificationButtonRef}
              type="button"
              onClick={handleToggleNotifications}
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
              anchorRect={notificationAnchorRect}
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
      {downloadModal}
    </>
  );
}
