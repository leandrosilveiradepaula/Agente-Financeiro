"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  KeyRound,
  LogOut,
  RotateCcw,
  ShieldAlert,
  ShieldCheck
} from "lucide-react";

type AccountUser = {
  id: string;
  name: string;
  email: string;
  user_profile: string;
  is_active: boolean;
  locked_until: string | null;
  failed_login_attempts: number;
  last_login_at: string | null;
  last_logout_at: string | null;
  created_at: string;
  updated_at: string;
  password_changed_at: string | null;
  must_change_password: boolean;
};

type AccessState = "checking" | "unauthenticated" | "allowed";

const emptyPasswordForm = {
  current_password: "",
  new_password: "",
  confirm_password: ""
};

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function getAccountStatus(user: AccountUser) {
  if (!user.is_active) return "Inativo";

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return "Bloqueado";
  }

  return "Ativo";
}

function isStrongEnoughPassword(password: string) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" && data.error ? data.error : fallback;
  } catch {
    return fallback;
  }
}

export default function MinhaContaPage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [loading, setLoading] = useState(true);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    setError("");
  }, []);

  const showError = useCallback((text: string) => {
    setError(text);
    setMessage("");
  }, []);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/account/me", { cache: "no-store" });

      if (response.status === 401) {
        setAccessState("unauthenticated");
        setUser(null);
        return;
      }

      if (!response.ok) {
        throw new Error(await readApiError(response, "account_load_failed"));
      }

      const data = (await response.json()) as { user?: AccountUser };
      setUser(data.user ?? null);
      setAccessState("allowed");
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível carregar sua conta: ${reason}`);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  async function logout() {
    setLogoutLoading(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store"
      });
    } finally {
      window.location.href = "/";
    }
  }

  async function submitChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showError("A confirmação da senha não confere.");
      return;
    }

    if (!isStrongEnoughPassword(passwordForm.new_password)) {
      showError("A nova senha deve ter pelo menos 8 caracteres, uma letra e um número.");
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm)
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "change_password_failed"));
      }

      const data = (await response.json()) as { user?: AccountUser };
      setUser(data.user ?? user);
      setPasswordForm(emptyPasswordForm);
      showMessage("Senha alterada com sucesso.");
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível alterar a senha: ${reason}`);
    } finally {
      setPasswordLoading(false);
      setPasswordForm(emptyPasswordForm);
    }
  }

  async function revokeOtherSessions() {
    if (!window.confirm("Encerrar outras sessões da sua conta?")) return;

    setSessionsLoading(true);

    try {
      const response = await fetch("/api/account/revoke-other-sessions", {
        method: "POST",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "revoke_sessions_failed"));
      }

      const data = (await response.json()) as { revoked_sessions_count?: number };
      const count = data.revoked_sessions_count;

      showMessage(
        typeof count === "number"
          ? `Outras sessões encerradas com sucesso. Sessões encerradas: ${count}.`
          : "Outras sessões encerradas com sucesso."
      );
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(`Não foi possível encerrar outras sessões: ${reason}`);
    } finally {
      setSessionsLoading(false);
    }
  }

  if (accessState === "checking" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-steel shadow-soft">
          Carregando sua conta...
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
            Faça login na interface do agente financeiro para acessar sua conta.
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

  return (
    <main className="min-h-screen px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-3 text-sm font-semibold text-lake">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              Segurança da conta
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
              Minha conta
            </h1>
            <p className="mt-2 text-sm text-steel">
              Gerencie seus dados de acesso e segurança.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Voltar ao Agente
            </Link>
            <button
              type="button"
              onClick={logout}
              disabled={logoutLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sair
            </button>
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

        {user?.must_change_password ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Você precisa alterar sua senha temporária.
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <article className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="text-lg font-semibold text-ink">Dados da conta</h2>
            {user ? (
              <dl className="mt-4 grid gap-3 text-sm">
                <ReadonlyField label="Nome" value={user.name} />
                <ReadonlyField label="E-mail" value={user.email} />
                <ReadonlyField label="Perfil" value={user.user_profile} />
                <ReadonlyField label="Status" value={getAccountStatus(user)} />
                <ReadonlyField label="Último login" value={formatDate(user.last_login_at)} />
                <ReadonlyField
                  label="Última alteração de senha"
                  value={formatDate(user.password_changed_at)}
                />
                <ReadonlyField label="Criado em" value={formatDate(user.created_at)} />
              </dl>
            ) : null}
          </article>

          <article className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <KeyRound className="h-5 w-5 text-lake" aria-hidden="true" />
              Alterar senha
            </h2>
            <form className="mt-4 grid gap-4" onSubmit={submitChangePassword}>
              <PasswordField
                label="Senha atual"
                value={passwordForm.current_password}
                onChange={(value) =>
                  setPasswordForm((current) => ({ ...current, current_password: value }))
                }
                autoComplete="current-password"
              />
              <PasswordField
                label="Nova senha"
                value={passwordForm.new_password}
                onChange={(value) =>
                  setPasswordForm((current) => ({ ...current, new_password: value }))
                }
                autoComplete="new-password"
              />
              <PasswordField
                label="Confirmar nova senha"
                value={passwordForm.confirm_password}
                onChange={(value) =>
                  setPasswordForm((current) => ({ ...current, confirm_password: value }))
                }
                autoComplete="new-password"
              />
              <button
                type="submit"
                disabled={
                  passwordLoading ||
                  !passwordForm.current_password ||
                  !passwordForm.new_password ||
                  !passwordForm.confirm_password
                }
                className="inline-flex h-11 w-fit items-center justify-center rounded-md bg-lake px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                {passwordLoading ? "Alterando..." : "Alterar senha"}
              </button>
            </form>
          </article>
        </section>

        <article className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <RotateCcw className="h-5 w-5 text-lake" aria-hidden="true" />
            Sessões
          </h2>
          <p className="mt-2 text-sm text-steel">Sua sessão atual está ativa.</p>
          <button
            type="button"
            onClick={revokeOtherSessions}
            disabled={sessionsLoading}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            {sessionsLoading ? "Encerrando..." : "Encerrar outras sessões"}
          </button>
        </article>
      </div>
    </main>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <dt className="text-xs font-bold uppercase tracking-wide text-steel">{label}</dt>
      <dd className="mt-1 font-semibold text-ink">{value || "-"}</dd>
    </div>
  );
}

function PasswordField(props: {
  label: string;
  value: string;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{props.label}</span>
      <input
        type="password"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
        autoComplete={props.autoComplete}
      />
    </label>
  );
}
