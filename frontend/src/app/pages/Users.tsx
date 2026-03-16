import {
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCog,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  formatRoleLabel,
  getUserAvatarUrl,
  usersApi,
  type ApiUser,
  type CreateUserPayload,
  type UpdateUserPayload,
} from "../lib/api";

const MAX_USER_PHOTO_SIZE_BYTES = 512 * 1024;

const rolePermissions = {
  Administrateur: [
    "Acces complet",
    "Gestion utilisateurs",
    "Configuration systeme",
    "Exports illimites",
  ],
  Manager: ["Lecture/ecriture", "Validation alertes", "Recommandations", "Exports limites"],
  Analyste: ["Lecture seule", "Consultation rapports", "Exports basiques"],
};

const initialFormState: CreateUserPayload = {
  full_name: "",
  email: "",
  password: "",
  photo_url: null,
  role: "manager",
  is_active: true,
};

interface UserEditFormState {
  full_name: string;
  email: string;
  password: string;
  photo_url: string | null;
  role: string;
  is_active: boolean;
}

const initialEditFormState: UserEditFormState = {
  full_name: "",
  email: "",
  password: "",
  photo_url: null,
  role: "manager",
  is_active: true,
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Impossible de lire l'image selectionnee."));
    };

    reader.onerror = () => reject(new Error("Impossible de lire l'image selectionnee."));
    reader.readAsDataURL(file);
  });
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function normalizeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}

function toEditFormState(user: ApiUser): UserEditFormState {
  return {
    full_name: user.full_name,
    email: user.email,
    password: "",
    photo_url: user.photo_url,
    role: user.role,
    is_active: user.is_active,
  };
}

function buildUpdatePayload(
  originalUser: ApiUser,
  editForm: UserEditFormState,
): UpdateUserPayload {
  const payload: UpdateUserPayload = {};

  if (editForm.full_name.trim() !== originalUser.full_name) {
    payload.full_name = editForm.full_name.trim();
  }

  if (editForm.email.trim().toLowerCase() !== originalUser.email.toLowerCase()) {
    payload.email = editForm.email.trim();
  }

  if (editForm.password.trim() !== "") {
    payload.password = editForm.password;
  }

  if ((editForm.photo_url ?? null) !== (originalUser.photo_url ?? null)) {
    payload.photo_url = editForm.photo_url ?? null;
  }

  if (editForm.role !== originalUser.role) {
    payload.role = editForm.role;
  }

  if (editForm.is_active !== originalUser.is_active) {
    payload.is_active = editForm.is_active;
  }

  return payload;
}

export default function Users() {
  const { token, user: currentUser, refreshCurrentUser } = useAuth();
  const isAdmin = currentUser?.role.trim().toLowerCase() === "admin";
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserPayload>(initialFormState);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [editForm, setEditForm] = useState<UserEditFormState>(initialEditFormState);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  const [editPhotoInputKey, setEditPhotoInputKey] = useState(0);
  const [detailUser, setDetailUser] = useState<ApiUser | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  async function loadUsers() {
    if (!token) {
      setUsers([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const apiUsers = await usersApi.list(token);
      setUsers(apiUsers);
    } catch (loadError) {
      setError(normalizeErrorMessage(loadError, "Impossible de charger les utilisateurs."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, [token]);

  async function handleRefresh(): Promise<void> {
    setIsRefreshing(true);

    try {
      await loadUsers();
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleCreateFormChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ): void {
    const { name, value } = event.target;

    if (name === "is_active") {
      setCreateForm((previousForm) => ({
        ...previousForm,
        is_active: value === "true",
      }));
      return;
    }

    setCreateForm((previousForm) => ({
      ...previousForm,
      [name]: value,
    }));
  }

  function resetCreateForm(): void {
    setCreateForm(initialFormState);
    setCreateError(null);
    setPhotoInputKey((previousKey) => previousKey + 1);
  }

  function closeCreateDialog(): void {
    setIsCreateOpen(false);
    resetCreateForm();
  }

  function openCreateDialog(): void {
    resetCreateForm();
    setIsCreateOpen(true);
  }

  function resetEditForm(): void {
    setEditingUser(null);
    setEditForm(initialEditFormState);
    setEditError(null);
    setEditPhotoInputKey((previousKey) => previousKey + 1);
  }

  function closeEditDialog(): void {
    setIsEditOpen(false);
    resetEditForm();
  }

  function openEditDialog(user: ApiUser): void {
    setEditingUser(user);
    setEditForm(toEditFormState(user));
    setEditError(null);
    setIsEditOpen(true);
    setEditPhotoInputKey((previousKey) => previousKey + 1);
  }

  function closeDetailDialog(): void {
    setDetailUser(null);
    setDetailError(null);
    setIsDetailLoading(false);
  }

  async function handleCreatePhotoChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setCreateError("Selectionnez une image valide pour la photo utilisateur.");
      setPhotoInputKey((previousKey) => previousKey + 1);
      return;
    }

    if (file.size > MAX_USER_PHOTO_SIZE_BYTES) {
      setCreateError("La photo doit faire 500 Ko maximum.");
      setPhotoInputKey((previousKey) => previousKey + 1);
      return;
    }

    try {
      const photoUrl = await readFileAsDataUrl(file);
      setCreateForm((previousForm) => ({
        ...previousForm,
        photo_url: photoUrl,
      }));
      setCreateError(null);
    } catch (error) {
      setCreateError(normalizeErrorMessage(error, "Impossible de charger la photo."));
      setPhotoInputKey((previousKey) => previousKey + 1);
    }
  }

  function removeCreatePhoto(): void {
    setCreateForm((previousForm) => ({
      ...previousForm,
      photo_url: null,
    }));
    setPhotoInputKey((previousKey) => previousKey + 1);
  }

  function handleEditFormChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ): void {
    const { name, value } = event.target;

    if (name === "is_active") {
      setEditForm((previousForm) => ({
        ...previousForm,
        is_active: value === "true",
      }));
      return;
    }

    setEditForm((previousForm) => ({
      ...previousForm,
      [name]: value,
    }));
  }

  async function handleEditPhotoChange(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setEditError("Selectionnez une image valide pour la photo utilisateur.");
      setEditPhotoInputKey((previousKey) => previousKey + 1);
      return;
    }

    if (file.size > MAX_USER_PHOTO_SIZE_BYTES) {
      setEditError("La photo doit faire 500 Ko maximum.");
      setEditPhotoInputKey((previousKey) => previousKey + 1);
      return;
    }

    try {
      const photoUrl = await readFileAsDataUrl(file);
      setEditForm((previousForm) => ({
        ...previousForm,
        photo_url: photoUrl,
      }));
      setEditError(null);
    } catch (photoError) {
      setEditError(normalizeErrorMessage(photoError, "Impossible de charger la photo."));
      setEditPhotoInputKey((previousKey) => previousKey + 1);
    }
  }

  function removeEditPhoto(): void {
    setEditForm((previousForm) => ({
      ...previousForm,
      photo_url: null,
    }));
    setEditPhotoInputKey((previousKey) => previousKey + 1);
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!token) {
      setCreateError("Session expiree. Reconnectez-vous.");
      return;
    }

    setIsSubmitting(true);
    setCreateError(null);

    try {
      const createdUser = await usersApi.create(token, createForm);
      setUsers((previousUsers) => [createdUser, ...previousUsers]);
      closeCreateDialog();
    } catch (submitError) {
      setCreateError(normalizeErrorMessage(submitError, "Impossible de créer l'utilisateur."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!token || !editingUser) {
      setEditError("Session expiree. Reconnectez-vous.");
      return;
    }

    setIsEditSubmitting(true);
    setEditError(null);

    try {
      const payload = buildUpdatePayload(editingUser, editForm);

      if (Object.keys(payload).length === 0) {
        closeEditDialog();
        return;
      }

      const updatedUser = await usersApi.update(token, editingUser.id, payload);
      setUsers((previousUsers) =>
        previousUsers.map((apiUser) => (apiUser.id === updatedUser.id ? updatedUser : apiUser)),
      );
      setDetailUser((currentDetailUser) =>
        currentDetailUser?.id === updatedUser.id ? updatedUser : currentDetailUser,
      );

      if (currentUser?.id === updatedUser.id) {
        await refreshCurrentUser();
      }

      closeEditDialog();
    } catch (submitError) {
      setEditError(
        normalizeErrorMessage(submitError, "Impossible de modifier cet utilisateur."),
      );
    } finally {
      setIsEditSubmitting(false);
    }
  }

  async function openDetailDialog(userId: number): Promise<void> {
    if (!token) {
      setDetailError("Session expiree. Reconnectez-vous.");
      return;
    }

    setDetailUser(null);
    setDetailError(null);
    setIsDetailLoading(true);

    try {
      const fetchedUser = await usersApi.get(token, userId);
      setDetailUser(fetchedUser);
    } catch (detailLoadError) {
      setDetailError(normalizeErrorMessage(detailLoadError, "Impossible de charger ce profil."));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleDeleteUser(user: ApiUser): Promise<void> {
    if (!token) {
      setError("Session expiree. Reconnectez-vous.");
      return;
    }

    const confirmed = window.confirm(`Supprimer l'utilisateur ${user.full_name} ?`);
    if (!confirmed) {
      return;
    }

    try {
      await usersApi.remove(token, user.id);
      setUsers((previousUsers) => previousUsers.filter((apiUser) => apiUser.id !== user.id));
      setDetailUser((currentDetailUser) =>
        currentDetailUser?.id === user.id ? null : currentDetailUser,
      );
    } catch (deleteError) {
      setError(normalizeErrorMessage(deleteError, "Suppression impossible pour le moment."));
    }
  }

  const filteredUsers = users.filter((apiUser) => {
    const matchesSearch =
      searchQuery.trim() === "" ||
      apiUser.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      apiUser.email.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole = roleFilter === "all" || apiUser.role === roleFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" ? apiUser.is_active : !apiUser.is_active);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const adminCount = users.filter((apiUser) => apiUser.role === "admin").length;
  const managerCount = users.filter((apiUser) => apiUser.role === "manager").length;
  const analystCount = users.filter((apiUser) => apiUser.role === "analyst").length;
  const canViewUserDetails = (userId: number) => isAdmin || currentUser?.id === userId;

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Gestion des utilisateurs</h1>
            <p className="text-[#64748B]">
              Liste reelle synchronisee avec le backend FastAPI.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isLoading || isRefreshing}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Rafraichissement..." : "Rafraichir"}</span>
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={openCreateDialog}
                className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors"
              >
                <Plus className="w-5 h-5" />
                <span>Ajouter un utilisateur</span>
              </button>
            ) : null}
          </div>
        </div>

        {!isAdmin ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Consultation en lecture seule. La création d'utilisateurs reste reservée a l'administrateur.
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-[#64748B]">Total utilisateurs</p>
              <UsersIcon className="w-5 h-5 text-[#2563EB]" />
            </div>
            <p className="text-3xl font-bold text-[#0F172A]">{users.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-[#64748B]">Administrateurs</p>
              <Shield className="w-5 h-5 text-[#DC2626]" />
            </div>
            <p className="text-3xl font-bold text-[#0F172A]">{adminCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-[#64748B]">Managers</p>
              <UserCog className="w-5 h-5 text-[#F59E0B]" />
            </div>
            <p className="text-3xl font-bold text-[#0F172A]">{managerCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-[#64748B]">Analystes</p>
              <UserCog className="w-5 h-5 text-[#16A34A]" />
            </div>
            <p className="text-3xl font-bold text-[#0F172A]">{analystCount}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#64748B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Rechercher un utilisateur..."
                className="w-full pl-10 pr-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            >
              <option value="all">Tous les roles</option>
              <option value="admin">Administrateur</option>
              <option value="manager">Manager</option>
              <option value="analyst">Analyste</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Actif</option>
              <option value="inactive">Inactif</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm text-[#64748B]">Chargement des utilisateurs...</p>
            </div>
          ) : error ? (
            <div className="px-6 py-10 flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-[#DC2626]">{error}</p>
              <button
                type="button"
                onClick={() => void loadUsers()}
                className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1d4ed8] transition-colors"
              >
                Reessayer
              </button>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm text-[#64748B]">
                Aucun utilisateur ne correspond aux filtres actuels.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#F8FAFC] border-b border-gray-200">
                  <tr>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Photo
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Utilisateur
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Email
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Role
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Statut
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Cree le
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Session
                    </th>
                    <th className="text-left px-6 py-4 text-sm font-semibold text-[#0F172A]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredUsers.map((apiUser) => {
                    const avatarUrl = getUserAvatarUrl(apiUser.full_name, apiUser.photo_url);
                    const isCurrentRowUser = currentUser?.id === apiUser.id;

                    return (
                      <tr key={apiUser.id} className="hover:bg-[#F8FAFC] transition-colors">
                        {/* Colonne Photo */}
                        <td className="px-6 py-4">
                          <img
                            src={avatarUrl}
                            alt={apiUser.full_name}
                            className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-sm"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={avatarUrl}
                              alt={apiUser.full_name}
                              className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-sm"
                            />
                            <div>
                              <p className="font-medium text-[#0F172A]">{apiUser.full_name}</p>
                              <p className="text-xs text-[#64748B]">ID #{apiUser.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-[#64748B]">{apiUser.email}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                              apiUser.role === "admin"
                                ? "bg-red-50 text-[#DC2626]"
                                : apiUser.role === "manager"
                                  ? "bg-orange-50 text-[#F59E0B]"
                                  : "bg-blue-50 text-[#2563EB]"
                            }`}
                          >
                            {formatRoleLabel(apiUser.role)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                              apiUser.is_active
                                ? "bg-green-50 text-[#16A34A]"
                                : "bg-gray-50 text-[#64748B]"
                            }`}
                          >
                            {apiUser.is_active ? "Actif" : "Inactif"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-[#64748B]">
                          {formatCreatedAt(apiUser.created_at)}
                        </td>
                        <td className="px-6 py-4 text-sm text-[#64748B]">
                          {isCurrentRowUser ? "Compte courant" : "Compte API"}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap items-center gap-3 whitespace-nowrap">
                            {canViewUserDetails(apiUser.id) ? (
                              <button
                                type="button"
                                onClick={() => void openDetailDialog(apiUser.id)}
                                className="text-sm text-[#2D6CDF] hover:text-[#1d4ed8] font-medium"
                              >
                                <span>Details</span>
                              </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={() => openEditDialog(apiUser)}
                                className="inline-flex items-center gap-1 text-sm text-[#64748B] hover:text-[#0F172A] font-medium"
                              >
                                <Pencil className="w-4 h-4" />
                                <span>Modifier</span>
                              </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                                type="button"
                                disabled={isCurrentRowUser}
                                onClick={() => void handleDeleteUser(apiUser)}
                                className="inline-flex items-center gap-1 text-sm text-[#DC2626] hover:text-[#b91c1c] font-medium disabled:cursor-not-allowed disabled:text-[#FCA5A5]"
                              >
                                <Trash2 className="w-4 h-4" />
                                <span>Supprimer</span>
                              </button>
                            ) : null}
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

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Permissions par role</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {Object.entries(rolePermissions).map(([role, permissions]) => (
              <div key={role} className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-bold text-[#0F172A] mb-3">{role}</h3>
                <ul className="space-y-2">
                  {permissions.map((permission) => (
                    <li key={permission} className="flex items-center gap-2 text-sm text-[#64748B]">
                      <div className="w-1.5 h-1.5 bg-[#16A34A] rounded-full" />
                      <span>{permission}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-[#0F172A]">Nouvel utilisateur</h2>
                <p className="text-sm text-[#64748B] mt-1">
                  Ce formulaire cree un utilisateur directement dans le backend.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateDialog}
                className="p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] rounded-lg transition-colors"
                aria-label="Fermer la fenetre"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(event) => void handleCreateUser(event)} className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">Nom complet</span>
                  <input
                    type="text"
                    name="full_name"
                    value={createForm.full_name}
                    onChange={handleCreateFormChange}
                    required
                    minLength={2}
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">Email</span>
                  <input
                    type="email"
                    name="email"
                    value={createForm.email}
                    onChange={handleCreateFormChange}
                    required
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">Mot de passe</span>
                  <input
                    type="password"
                    name="password"
                    value={createForm.password}
                    onChange={handleCreateFormChange}
                    required
                    minLength={8}
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">Role</span>
                  <select
                    name="role"
                    value={createForm.role}
                    onChange={handleCreateFormChange}
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  >
                    <option value="admin">Administrateur</option>
                    <option value="manager">Manager</option>
                    <option value="analyst">Analyste</option>
                  </select>
                </label>
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Photo utilisateur</span>
                <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-[#F8FAFC] p-4 sm:flex-row sm:items-center">
                  <img
                    src={getUserAvatarUrl(
                      createForm.full_name || createForm.email || "Nouvel utilisateur",
                      createForm.photo_url,
                    )}
                    alt={createForm.full_name || "Nouvel utilisateur"}
                    className="w-20 h-20 rounded-full object-cover ring-2 ring-white shadow-sm"
                  />
                  <div className="flex-1 space-y-3">
                    <input
                      key={photoInputKey}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => void handleCreatePhotoChange(event)}
                      className="block w-full text-sm text-[#64748B] file:mr-4 file:rounded-lg file:border-0 file:bg-[#2563EB] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#1d4ed8]"
                    />
                    <p className="text-xs text-[#64748B]">
                      PNG, JPG, WEBP ou GIF. Taille maximale: 500 Ko.
                    </p>
                    {createForm.photo_url ? (
                      <button
                        type="button"
                        onClick={removeCreatePhoto}
                        className="inline-flex items-center gap-2 text-sm font-medium text-[#DC2626] hover:text-[#b91c1c]"
                      >
                        <X className="w-4 h-4" />
                        <span>Retirer la photo</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Statut</span>
                <select
                  name="is_active"
                  value={String(createForm.is_active)}
                  onChange={handleCreateFormChange}
                  className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                >
                  <option value="true">Actif</option>
                  <option value="false">Inactif</option>
                </select>
              </label>

              {createError ? (
                <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-[#B91C1C]">
                  {createError}
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCreateDialog}
                  className="px-4 py-2.5 bg-white text-[#0F172A] border border-gray-200 rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2.5 bg-[#2563EB] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Creation..." : "Créer l'utilisateur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isEditOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-[#0F172A]">Modifier l'utilisateur</h2>
                <p className="text-sm text-[#64748B] mt-1">
                  Mettez a jour les informations de cet utilisateur dans le backend.
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditDialog}
                className="p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] rounded-lg transition-colors"
                aria-label="Fermer la fenetre"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(event) => void handleUpdateUser(event)} className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">Nom complet</span>
                  <input
                    type="text"
                    name="full_name"
                    value={editForm.full_name}
                    onChange={handleEditFormChange}
                    required
                    minLength={2}
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">Email</span>
                  <input
                    type="email"
                    name="email"
                    value={editForm.email}
                    onChange={handleEditFormChange}
                    required
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">
                    Nouveau mot de passe
                  </span>
                  <input
                    type="password"
                    name="password"
                    value={editForm.password}
                    onChange={handleEditFormChange}
                    minLength={8}
                    placeholder="Laissez vide pour conserver"
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  />
                </label>

                <label className="space-y-2">
                  <span className="block text-sm font-medium text-[#0F172A]">Role</span>
                  <select
                    name="role"
                    value={editForm.role}
                    onChange={handleEditFormChange}
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                  >
                    <option value="admin">Administrateur</option>
                    <option value="manager">Manager</option>
                    <option value="analyst">Analyste</option>
                  </select>
                </label>
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Photo utilisateur</span>
                <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-[#F8FAFC] p-4 sm:flex-row sm:items-center">
                  <img
                    src={getUserAvatarUrl(
                      editForm.full_name || editForm.email || "Utilisateur",
                      editForm.photo_url,
                    )}
                    alt={editForm.full_name || "Utilisateur"}
                    className="w-20 h-20 rounded-full object-cover ring-2 ring-white shadow-sm"
                  />
                  <div className="flex-1 space-y-3">
                    <input
                      key={editPhotoInputKey}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => void handleEditPhotoChange(event)}
                      className="block w-full text-sm text-[#64748B] file:mr-4 file:rounded-lg file:border-0 file:bg-[#2563EB] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#1d4ed8]"
                    />
                    <p className="text-xs text-[#64748B]">
                      PNG, JPG, WEBP ou GIF. Taille maximale: 500 Ko.
                    </p>
                    {editForm.photo_url ? (
                      <button
                        type="button"
                        onClick={removeEditPhoto}
                        className="inline-flex items-center gap-2 text-sm font-medium text-[#DC2626] hover:text-[#b91c1c]"
                      >
                        <X className="w-4 h-4" />
                        <span>Retirer la photo</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <label className="space-y-2">
                <span className="block text-sm font-medium text-[#0F172A]">Statut</span>
                <select
                  name="is_active"
                  value={String(editForm.is_active)}
                  onChange={handleEditFormChange}
                  className="w-full px-4 py-2.5 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
                >
                  <option value="true">Actif</option>
                  <option value="false">Inactif</option>
                </select>
              </label>

              {editError ? (
                <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-[#B91C1C]">
                  {editError}
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEditDialog}
                  className="px-4 py-2.5 bg-white text-[#0F172A] border border-gray-200 rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isEditSubmitting}
                  className="px-4 py-2.5 bg-[#2563EB] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isEditSubmitting ? "Mise a jour..." : "Enregistrer les modifications"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isDetailLoading || detailUser || detailError ? (
        <div className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-[#0F172A]">Details utilisateur</h2>
                <p className="text-sm text-[#64748B] mt-1">
                  Informations detaillees synchronisees depuis le backend.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetailDialog}
                className="p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] rounded-lg transition-colors"
                aria-label="Fermer la fenetre"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {isDetailLoading ? (
                <p className="text-sm text-[#64748B]">Chargement du profil...</p>
              ) : detailError ? (
                <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-[#B91C1C]">
                  {detailError}
                </div>
              ) : detailUser ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <img
                      src={getUserAvatarUrl(detailUser.full_name, detailUser.photo_url)}
                      alt={detailUser.full_name}
                      className="w-20 h-20 rounded-full object-cover ring-2 ring-white shadow-sm"
                    />
                    <div>
                      <h3 className="text-xl font-bold text-[#0F172A]">{detailUser.full_name}</h3>
                      <p className="text-sm text-[#64748B]">ID #{detailUser.id}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Email</p>
                      <p className="mt-2 text-sm text-[#0F172A] break-all">{detailUser.email}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Role</p>
                      <p className="mt-2 text-sm text-[#0F172A]">{formatRoleLabel(detailUser.role)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Statut</p>
                      <p className="mt-2 text-sm text-[#0F172A]">
                        {detailUser.is_active ? "Actif" : "Inactif"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Derniere connexion</p>
                      <p className="mt-2 text-sm text-[#0F172A]">
                        {detailUser.last_login_at ? formatCreatedAt(detailUser.last_login_at) : "Jamais"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Cree le</p>
                      <p className="mt-2 text-sm text-[#0F172A]">{formatCreatedAt(detailUser.created_at)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Mis a jour le</p>
                      <p className="mt-2 text-sm text-[#0F172A]">{formatCreatedAt(detailUser.updated_at)}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
