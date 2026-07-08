"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Eye,
  KeyRound,
  Lock,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  UserPlus,
  X
} from "lucide-react";

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  profile: string;
};

type AdminUser = {
  id: string;
  name: string;
  email: string;
  user_profile: string;
  is_active: boolean;
  locked_until: string | null;
  failed_login_attempts: number;
  last_login_at: string | null;
  created_at: string;
  disabled_at: string | null;
  must_change_password: boolean;
};

type AuditEvent = {
  id: string;
  created_at: string;
  actor_email: string | null;
  actor_profile: string | null;
  action: string;
  success: boolean;
  reason: string | null;
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type AccessState = "checking" | "unauthenticated" | "forbidden" | "allowed";
type PanelMode = "new" | "edit" | "reset" | "audit" | null;

const PROFILES = ["admin", "diretoria", "financeiro", "auditoria", "comercial"];

const emptyCreateForm = {
  name: "",
  email: "",
  user_profile: "financeiro",
  password: "",
  must_change_password: true
};

const SELF_ACTION_DISABLED_TITLE =
  "Esta ação não está disponível para o próprio usuário logado.";

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function getUserStatus(user: AdminUser) {
  if (!user.is_active) return "Inativo";

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return "Bloqueado";
  }

  return "Ativo";
}

function statusClass(status: string) {
  if (status === "Ativo") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "Bloqueado") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="max-h-52 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  );
}

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" && data.error ? data.error : fallback;
  } catch {
    return fallback;
  }
}

export default function AdminUsersPage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [loggedUser, setLoggedUser] = useState<AuthenticatedUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    user_profile: "financeiro"
  });
  const [resetPassword, setResetPassword] = useState("");

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [users]
  );

  const showError = useCallback((text: string) => {
    setError(text);
    setMessage("");
  }, []);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    setError("");
  }, []);

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/admin/users", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("users_load_failed");
    }

    const data = (await response.json()) as { users?: AdminUser[] };
    setUsers(data.users ?? []);
  }, []);

  const checkAccessAndLoad = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
      const sessionData = (await sessionResponse.json()) as {
        authenticated?: boolean;
        user?: AuthenticatedUser | null;
      };

      if (!sessionData.authenticated || !sessionData.user) {
        setAccessState("unauthenticated");
        setLoggedUser(null);
        return;
      }

      setLoggedUser(sessionData.user);

      if (sessionData.user.profile !== "admin") {
        setAccessState("forbidden");
        return;
      }

      setAccessState("allowed");
      await loadUsers();
    } catch {
      showError("Não foi possível carregar a administração de usuários.");
    } finally {
      setLoading(false);
    }
  }, [loadUsers, showError]);

  useEffect(() => {
    checkAccessAndLoad();
  }, [checkAccessAndLoad]);

  function closePanel() {
    setPanelMode(null);
    setSelectedUser(null);
    setAuditEvents([]);
    setResetPassword("");
    setCreateForm(emptyCreateForm);
    setEditForm({ name: "", email: "", user_profile: "financeiro" });
  }

  async function refreshAfterAction(successMessage: string) {
    await loadUsers();
    showMessage(successMessage);
  }

  async function submitCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionLoading("create");

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm)
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "create_failed"));
      }

      closePanel();
      await refreshAfterAction("Usuário criado com sucesso.");
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível criar o usuário: ${reason}`);
    } finally {
      setActionLoading("");
      setCreateForm((current) => ({ ...current, password: "" }));
    }
  }

  function openEditPanel(user: AdminUser) {
    setSelectedUser(user);
    setEditForm({
      name: user.name,
      email: user.email,
      user_profile: user.user_profile
    });
    setPanelMode("edit");
  }

  async function submitEditUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;
    setActionLoading("edit");

    try {
      const isEditingSelfAdmin =
        selectedUser.id === loggedUser?.id && loggedUser?.profile === "admin";
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          user_profile: isEditingSelfAdmin ? "admin" : editForm.user_profile
        })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "edit_failed"));
      }

      closePanel();
      await refreshAfterAction("Usuário atualizado com sucesso.");
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível atualizar o usuário: ${reason}`);
    } finally {
      setActionLoading("");
    }
  }

  function openResetPanel(user: AdminUser) {
    if (user.id === loggedUser?.id) {
      showError(SELF_ACTION_DISABLED_TITLE);
      return;
    }

    setSelectedUser(user);
    setResetPassword("");
    setPanelMode("reset");
  }

  async function submitResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser || !window.confirm("Confirmar reset de senha deste usuário?")) return;

    if (selectedUser.id === loggedUser?.id) {
      showError(SELF_ACTION_DISABLED_TITLE);
      setResetPassword("");
      return;
    }

    setActionLoading("reset");

    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword })
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "reset_failed"));
      }

      closePanel();
      await refreshAfterAction("Senha temporária definida com sucesso.");
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível resetar a senha: ${reason}`);
    } finally {
      setActionLoading("");
      setResetPassword("");
    }
  }

  async function runUserAction(user: AdminUser, action: string, label: string) {
    const isSelfAction = user.id === loggedUser?.id;
    const blockedSelfActions = new Set(["disable", "unlock", "revoke-sessions"]);

    if (isSelfAction && blockedSelfActions.has(action)) {
      showError(SELF_ACTION_DISABLED_TITLE);
      return;
    }

    if (!window.confirm(`Confirmar ação: ${label}?`)) return;

    setActionLoading(`${action}:${user.id}`);

    try {
      const response = await fetch(`/api/admin/users/${user.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "disable" ? JSON.stringify({ reason: "Ação administrativa" }) : undefined
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "action_failed"));
      }

      await refreshAfterAction(`${label} concluído.`);
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível executar ${label}: ${reason}`);
    } finally {
      setActionLoading("");
    }
  }

  async function openAuditPanel(user: AdminUser) {
    setSelectedUser(user);
    setPanelMode("audit");
    setActionLoading(`audit:${user.id}`);
    setAuditEvents([]);

    try {
      const response = await fetch(`/api/admin/users/${user.id}/audit`, {
        cache: "no-store"
      });

      if (!response.ok) throw new Error("audit_failed");

      const data = (await response.json()) as { audit_events?: AuditEvent[] };
      setAuditEvents(data.audit_events ?? []);
    } catch {
      showError("Não foi possível carregar a auditoria.");
    } finally {
      setActionLoading("");
    }
  }

  if (accessState === "checking" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-steel shadow-soft">
          Carregando administração...
        </div>
      </main>
    );
  }

  if (accessState === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-soft">
          <ShieldAlert className="h-8 w-8 text-amber-600" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-semibold text-ink">Acesso negado</h1>
          <p className="mt-2 text-sm text-steel">
            Faça login na interface do agente financeiro para acessar esta área.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-lake px-4 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Voltar ao login
          </Link>
        </section>
      </main>
    );
  }

  if (accessState === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-soft">
          <Lock className="h-8 w-8 text-rose-600" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-semibold text-ink">Acesso restrito</h1>
          <p className="mt-2 text-sm text-steel">Acesso restrito a administradores.</p>
          <Link
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-ink hover:bg-slate-50"
          >
            Voltar ao Agente
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-3 text-sm font-semibold text-lake">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              Administração
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">Usuários</h1>
            <p className="mt-2 text-sm text-steel">
              Gerencie acessos, perfis e sessões do agente financeiro.
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            {loggedUser ? (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-steel shadow-sm lg:text-right">
                <p className="font-semibold text-ink">{loggedUser.name}</p>
                <p>{loggedUser.email}</p>
                <p className="font-medium text-lake">{loggedUser.profile}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Link
                href="/"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Voltar ao Agente
              </Link>
              <button
                type="button"
                onClick={() => {
                  setPanelMode("new");
                  setCreateForm(emptyCreateForm);
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-lake px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Novo usuário
              </button>
            </div>
          </div>
        </header>

        {message ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-steel">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Último login</th>
                  <th className="px-4 py-3">Tentativas falhas</th>
                  <th className="px-4 py-3">Bloqueado até</th>
                  <th className="px-4 py-3">Criado em</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedUsers.map((user) => {
                  const status = getUserStatus(user);
                  const isCurrentUser = user.id === loggedUser?.id;
                  return (
                    <tr key={user.id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-ink">{user.name}</td>
                      <td className="px-4 py-3 text-steel">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                          {user.user_profile}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(status)}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-steel">{formatDate(user.last_login_at)}</td>
                      <td className="px-4 py-3 text-steel">{user.failed_login_attempts}</td>
                      <td className="px-4 py-3 text-steel">{formatDate(user.locked_until)}</td>
                      <td className="px-4 py-3 text-steel">{formatDate(user.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex min-w-[360px] flex-wrap gap-2">
                          <button className="admin-action-button" type="button" onClick={() => openEditPanel(user)}>
                            Editar
                          </button>
                          <button
                            className="admin-action-button"
                            type="button"
                            disabled={isCurrentUser}
                            title={isCurrentUser ? SELF_ACTION_DISABLED_TITLE : undefined}
                            onClick={() => openResetPanel(user)}
                          >
                            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                            Resetar senha
                          </button>
                          {user.is_active ? (
                            <button
                              className="admin-action-button-danger"
                              type="button"
                              disabled={isCurrentUser || actionLoading === `disable:${user.id}`}
                              title={isCurrentUser ? SELF_ACTION_DISABLED_TITLE : undefined}
                              onClick={() => runUserAction(user, "disable", "Desativar usuário")}
                            >
                              Desativar
                            </button>
                          ) : (
                            <button
                              className="admin-action-button"
                              type="button"
                              disabled={actionLoading === `enable:${user.id}`}
                              onClick={() => runUserAction(user, "enable", "Reativar usuário")}
                            >
                              Reativar
                            </button>
                          )}
                          <button
                            className="admin-action-button"
                            type="button"
                            disabled={isCurrentUser || actionLoading === `unlock:${user.id}`}
                            title={isCurrentUser ? SELF_ACTION_DISABLED_TITLE : undefined}
                            onClick={() => runUserAction(user, "unlock", "Desbloquear usuário")}
                          >
                            <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                            Desbloquear
                          </button>
                          <button
                            className="admin-action-button"
                            type="button"
                            disabled={isCurrentUser || actionLoading === `revoke-sessions:${user.id}`}
                            title={isCurrentUser ? SELF_ACTION_DISABLED_TITLE : undefined}
                            onClick={() => runUserAction(user, "revoke-sessions", "Revogar sessões")}
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            Revogar sessões
                          </button>
                          <button
                            className="admin-action-button"
                            type="button"
                            disabled={actionLoading === `audit:${user.id}`}
                            onClick={() => openAuditPanel(user)}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            Auditoria
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {panelMode ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-8">
            <section className="w-full max-w-3xl rounded-md border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-ink">
                  {panelMode === "new"
                    ? "Novo usuário"
                    : panelMode === "edit"
                      ? "Editar usuário"
                      : panelMode === "reset"
                        ? "Resetar senha"
                        : "Auditoria"}
                </h2>
                <button
                  type="button"
                  onClick={closePanel}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-steel hover:bg-slate-50"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="p-5">
                {panelMode === "new" ? (
                  <form className="grid gap-4" onSubmit={submitCreateUser}>
                    <UserFormFields
                      name={createForm.name}
                      email={createForm.email}
                      profile={createForm.user_profile}
                      onNameChange={(name) => setCreateForm((current) => ({ ...current, name }))}
                      onEmailChange={(emailValue) =>
                        setCreateForm((current) => ({ ...current, email: emailValue }))
                      }
                      onProfileChange={(profile) =>
                        setCreateForm((current) => ({ ...current, user_profile: profile }))
                      }
                    />
                    <label className="block">
                      <span className="text-sm font-semibold text-ink">Senha temporária</span>
                      <input
                        type="password"
                        value={createForm.password}
                        onChange={(event) =>
                          setCreateForm((current) => ({ ...current, password: event.target.value }))
                        }
                        className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={createForm.must_change_password}
                        onChange={(event) =>
                          setCreateForm((current) => ({
                            ...current,
                            must_change_password: event.target.checked
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Obrigar troca de senha no próximo login
                    </label>
                    <SubmitButton loading={actionLoading === "create"} label="Criar usuário" />
                  </form>
                ) : null}

                {panelMode === "edit" ? (
                  <form className="grid gap-4" onSubmit={submitEditUser}>
                    <UserFormFields
                      name={editForm.name}
                      email={editForm.email}
                      profile={editForm.user_profile}
                      profileDisabled={
                        selectedUser?.id === loggedUser?.id && loggedUser?.profile === "admin"
                      }
                      onNameChange={(name) => setEditForm((current) => ({ ...current, name }))}
                      onEmailChange={(emailValue) =>
                        setEditForm((current) => ({ ...current, email: emailValue }))
                      }
                      onProfileChange={(profile) =>
                        setEditForm((current) => ({ ...current, user_profile: profile }))
                      }
                    />
                    <SubmitButton loading={actionLoading === "edit"} label="Salvar alterações" />
                  </form>
                ) : null}

                {panelMode === "reset" ? (
                  <form className="grid gap-4" onSubmit={submitResetPassword}>
                    <p className="text-sm text-steel">
                      Defina uma senha temporária para {selectedUser?.email}. Ela não será exibida
                      novamente.
                    </p>
                    <label className="block">
                      <span className="text-sm font-semibold text-ink">Nova senha temporária</span>
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                        className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
                        autoComplete="new-password"
                      />
                    </label>
                    <SubmitButton loading={actionLoading === "reset"} label="Resetar senha" />
                  </form>
                ) : null}

                {panelMode === "audit" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-steel">
                      Eventos administrativos de {selectedUser?.email}.
                    </p>
                    {auditEvents.length === 0 ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-steel">
                        Nenhum evento encontrado.
                      </div>
                    ) : (
                      auditEvents.map((event) => (
                        <article key={event.id} className="rounded-md border border-slate-200 p-4">
                          <div className="grid gap-2 text-sm md:grid-cols-2">
                            <p>
                              <span className="font-semibold text-ink">Data/hora: </span>
                              {formatDate(event.created_at)}
                            </p>
                            <p>
                              <span className="font-semibold text-ink">Admin responsável: </span>
                              {event.actor_email ?? "-"} {event.actor_profile ? `(${event.actor_profile})` : ""}
                            </p>
                            <p>
                              <span className="font-semibold text-ink">Ação: </span>
                              {event.action}
                            </p>
                            <p>
                              <span className="font-semibold text-ink">Sucesso: </span>
                              {event.success ? "Sim" : "Não"}
                            </p>
                            <p className="md:col-span-2">
                              <span className="font-semibold text-ink">Motivo: </span>
                              {event.reason || "-"}
                            </p>
                          </div>
                          <div className="mt-4 grid gap-3">
                            <div>
                              <h3 className="mb-1 text-sm font-semibold text-ink">before_data</h3>
                              <JsonBlock value={event.before_data} />
                            </div>
                            <div>
                              <h3 className="mb-1 text-sm font-semibold text-ink">after_data</h3>
                              <JsonBlock value={event.after_data} />
                            </div>
                            <div>
                              <h3 className="mb-1 text-sm font-semibold text-ink">metadata</h3>
                              <JsonBlock value={event.metadata} />
                            </div>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function UserFormFields(props: {
  name: string;
  email: string;
  profile: string;
  profileDisabled?: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onProfileChange: (value: string) => void;
}) {
  return (
    <>
      <label className="block">
        <span className="text-sm font-semibold text-ink">Nome</span>
        <input
          type="text"
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
          className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
          autoComplete="name"
        />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-ink">E-mail</span>
        <input
          type="email"
          value={props.email}
          onChange={(event) => props.onEmailChange(event.target.value)}
          className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
          autoComplete="email"
        />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-ink">Perfil</span>
        <select
          value={props.profile}
          disabled={props.profileDisabled}
          title={props.profileDisabled ? "O próprio admin não pode alterar seu perfil." : undefined}
          onChange={(event) => props.onProfileChange(event.target.value)}
          className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
        >
          {PROFILES.map((profile) => (
            <option key={profile} value={profile}>
              {profile}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex h-11 w-fit items-center justify-center rounded-md bg-lake px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
    >
      {loading ? "Processando..." : label}
    </button>
  );
}
