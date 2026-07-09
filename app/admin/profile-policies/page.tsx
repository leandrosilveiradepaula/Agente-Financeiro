"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BarChart3,
  Edit3,
  Lock,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  X
} from "lucide-react";

type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  profile: string;
};

type AccountPolicy = {
  profile: string;
  display_name: string;
  can_generate_sql: boolean;
  can_execute_sql: boolean;
  can_view_sql: boolean;
  can_view_own_runs: boolean;
  can_view_all_runs: boolean;
  can_manage_users: boolean;
  can_view_admin_area: boolean;
  max_rows: number | null;
  max_execution_time_ms: number | null;
};

type ProfilePolicy = AccountPolicy & {
  id: string;
  created_at: string;
  updated_at: string;
  description: string | null;
  is_active: boolean;
  allowed_intents: string[];
  denied_intents: string[];
  allowed_tables: string[];
  denied_tables: string[];
  allowed_columns: JsonObject;
  denied_columns: JsonObject;
  required_filters: JsonObject;
  metadata: JsonObject;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };
type AccessState = "checking" | "unauthenticated" | "forbidden" | "allowed";

type PolicyForm = {
  display_name: string;
  description: string;
  is_active: boolean;
  can_generate_sql: boolean;
  can_execute_sql: boolean;
  can_view_sql: boolean;
  can_view_own_runs: boolean;
  can_view_all_runs: boolean;
  can_manage_users: boolean;
  can_view_admin_area: boolean;
  max_rows: string;
  max_execution_time_ms: string;
  allowed_intents: string;
  denied_intents: string;
  allowed_tables: string;
  denied_tables: string;
  allowed_columns: string;
  denied_columns: string;
  required_filters: string;
  metadata: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  cannot_disable_admin_policy: "Não é permitido desativar a política admin.",
  cannot_remove_admin_core_permissions:
    "Não é permitido remover permissões essenciais do perfil admin.",
  invalid_allowed_tables: "A lista de tabelas permitidas é inválida.",
  invalid_denied_tables: "A lista de tabelas negadas é inválida.",
  invalid_allowed_intents: "A lista de intenções permitidas é inválida.",
  invalid_denied_intents: "A lista de intenções negadas é inválida.",
  invalid_max_rows: "O limite máximo de linhas é inválido.",
  invalid_max_execution_time_ms: "O tempo máximo de execução é inválido.",
  invalid_payload: "Os dados enviados são inválidos.",
  policy_not_found: "Política não encontrada."
};

function boolLabel(value: boolean) {
  return value ? "Sim" : "Não";
}

function statusClass(active: boolean) {
  return active
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-slate-200 bg-slate-100 text-slate-700";
}

function linesToArray(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}

function arrayToLines(value: string[]) {
  return value.join("\n");
}

function jsonToText(value: JsonObject) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonObject(text: string, label: string): JsonObject {
  const trimmed = text.trim();
  const parsed = trimmed ? JSON.parse(trimmed) : {};

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} deve ser um objeto JSON.`);
  }

  return parsed as JsonObject;
}

function toForm(policy: ProfilePolicy): PolicyForm {
  return {
    display_name: policy.display_name,
    description: policy.description ?? "",
    is_active: policy.is_active,
    can_generate_sql: policy.can_generate_sql,
    can_execute_sql: policy.can_execute_sql,
    can_view_sql: policy.can_view_sql,
    can_view_own_runs: policy.can_view_own_runs,
    can_view_all_runs: policy.can_view_all_runs,
    can_manage_users: policy.can_manage_users,
    can_view_admin_area: policy.can_view_admin_area,
    max_rows: policy.max_rows === null ? "" : String(policy.max_rows),
    max_execution_time_ms:
      policy.max_execution_time_ms === null ? "" : String(policy.max_execution_time_ms),
    allowed_intents: arrayToLines(policy.allowed_intents),
    denied_intents: arrayToLines(policy.denied_intents),
    allowed_tables: arrayToLines(policy.allowed_tables),
    denied_tables: arrayToLines(policy.denied_tables),
    allowed_columns: jsonToText(policy.allowed_columns),
    denied_columns: jsonToText(policy.denied_columns),
    required_filters: jsonToText(policy.required_filters),
    metadata: jsonToText(policy.metadata)
  };
}

function readApiError(response: Response, fallback: string) {
  return response
    .json()
    .then((data: { error?: unknown }) =>
      typeof data.error === "string" && data.error ? data.error : fallback
    )
    .catch(() => fallback);
}

export default function AdminProfilePoliciesPage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [loggedUser, setLoggedUser] = useState<AuthenticatedUser | null>(null);
  const [accountPolicy, setAccountPolicy] = useState<AccountPolicy | null>(null);
  const [policies, setPolicies] = useState<ProfilePolicy[]>([]);
  const [editingPolicy, setEditingPolicy] = useState<ProfilePolicy | null>(null);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sortedPolicies = useMemo(
    () => [...policies].sort((a, b) => a.profile.localeCompare(b.profile, "pt-BR")),
    [policies]
  );

  const showError = useCallback((text: string) => {
    setError(text);
    setMessage("");
  }, []);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    setError("");
  }, []);

  const loadPolicies = useCallback(async () => {
    const response = await fetch("/api/admin/profile-policies", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(await readApiError(response, "profile_policies_load_failed"));
    }

    const data = (await response.json()) as { policies?: ProfilePolicy[] };
    setPolicies(data.policies ?? []);
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

      const policyResponse = await fetch("/api/account/policy", { cache: "no-store" });
      const policyData = (await policyResponse.json()) as {
        success?: boolean;
        policy?: AccountPolicy;
      };

      if (!policyResponse.ok || !policyData.success || !policyData.policy) {
        throw new Error("policy_load_failed");
      }

      setAccountPolicy(policyData.policy);

      if (!policyData.policy.can_manage_users) {
        setAccessState("forbidden");
        return;
      }

      setAccessState("allowed");
      await loadPolicies();
    } catch {
      showError("Não foi possível carregar as políticas de perfil.");
    } finally {
      setLoading(false);
    }
  }, [loadPolicies, showError]);

  useEffect(() => {
    checkAccessAndLoad();
  }, [checkAccessAndLoad]);

  function openEdit(policy: ProfilePolicy) {
    setEditingPolicy(policy);
    setForm(toForm(policy));
    setError("");
    setMessage("");
  }

  function closeEdit() {
    setEditingPolicy(null);
    setForm(null);
    setSaving(false);
  }

  function updateForm<K extends keyof PolicyForm>(field: K, value: PolicyForm[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingPolicy || !form || saving) return;

    if (
      editingPolicy.profile === "admin" &&
      !window.confirm(
        "Alterações na política admin podem afetar o acesso administrativo. Deseja continuar?"
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        display_name: form.display_name.trim(),
        description: form.description.trim() || null,
        is_active: form.is_active,
        can_generate_sql: form.can_generate_sql,
        can_execute_sql: form.can_execute_sql,
        can_view_sql: form.can_view_sql,
        can_view_own_runs: form.can_view_own_runs,
        can_view_all_runs: form.can_view_all_runs,
        can_manage_users: form.can_manage_users,
        can_view_admin_area: form.can_view_admin_area,
        max_rows: form.max_rows.trim() ? Number(form.max_rows) : null,
        max_execution_time_ms: form.max_execution_time_ms.trim()
          ? Number(form.max_execution_time_ms)
          : null,
        allowed_intents: linesToArray(form.allowed_intents),
        denied_intents: linesToArray(form.denied_intents),
        allowed_tables: linesToArray(form.allowed_tables),
        denied_tables: linesToArray(form.denied_tables),
        allowed_columns: parseJsonObject(form.allowed_columns, "allowed_columns"),
        denied_columns: parseJsonObject(form.denied_columns, "denied_columns"),
        required_filters: parseJsonObject(form.required_filters, "required_filters"),
        metadata: parseJsonObject(form.metadata, "metadata")
      };

      const response = await fetch(
        `/api/admin/profile-policies/${encodeURIComponent(editingPolicy.profile)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const reason = await readApiError(response, "policy_update_failed");
        throw new Error(ERROR_MESSAGES[reason] ?? `Não foi possível salvar: ${reason}`);
      }

      const data = (await response.json()) as { policy?: ProfilePolicy };

      if (data.policy) {
        setPolicies((current) =>
          current.map((policy) => (policy.profile === data.policy?.profile ? data.policy : policy))
        );
      } else {
        await loadPolicies();
      }

      closeEdit();
      showMessage("Política atualizada com sucesso.");
    } catch (caughtError) {
      const reason = caughtError instanceof Error ? caughtError.message : "erro_desconhecido";
      showError(reason);
    } finally {
      setSaving(false);
    }
  }

  if (accessState === "checking" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-steel shadow-soft">
          Carregando políticas...
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
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
              Políticas de perfil
            </h1>
            <p className="mt-2 text-sm text-steel">
              Gerencie permissões, intenções e tabelas permitidas por perfil.
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
              <Link className="admin-action-button" href="/">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Voltar ao Agente
              </Link>
              <Link className="admin-action-button" href="/admin/users">
                <Users className="h-4 w-4" aria-hidden="true" />
                Usuários
              </Link>
              {accountPolicy?.can_view_all_runs ? (
                <Link className="admin-action-button" href="/admin/runs">
                  <BarChart3 className="h-4 w-4" aria-hidden="true" />
                  Histórico
                </Link>
              ) : null}
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
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Nome de exibição</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Gera SQL</th>
                  <th className="px-4 py-3">Executa SQL</th>
                  <th className="px-4 py-3">Vê SQL</th>
                  <th className="px-4 py-3">Histórico global</th>
                  <th className="px-4 py-3">Gerencia usuários</th>
                  <th className="px-4 py-3">Max linhas</th>
                  <th className="px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedPolicies.map((policy) => (
                  <tr key={policy.profile} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-ink">{policy.profile}</td>
                    <td className="px-4 py-3 text-steel">{policy.display_name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(policy.is_active)}`}>
                        {policy.is_active ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-steel">{boolLabel(policy.can_generate_sql)}</td>
                    <td className="px-4 py-3 text-steel">{boolLabel(policy.can_execute_sql)}</td>
                    <td className="px-4 py-3 text-steel">{boolLabel(policy.can_view_sql)}</td>
                    <td className="px-4 py-3 text-steel">{boolLabel(policy.can_view_all_runs)}</td>
                    <td className="px-4 py-3 text-steel">{boolLabel(policy.can_manage_users)}</td>
                    <td className="px-4 py-3 text-steel">{policy.max_rows ?? "-"}</td>
                    <td className="px-4 py-3">
                      <button type="button" className="admin-action-button" onClick={() => openEdit(policy)}>
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {editingPolicy && form ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-8">
            <section className="w-full max-w-5xl rounded-md border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Editar política: {editingPolicy.profile}
                  </h2>
                  <p className="mt-1 text-xs font-medium text-steel">
                    Ajustes entram em vigor nas próximas chamadas do agente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEdit}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-steel hover:bg-slate-50"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <form onSubmit={savePolicy} className="max-h-[80vh] overflow-y-auto p-5">
                <div className="grid gap-5">
                  <section className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-2">
                    <TextField
                      label="Nome de exibição"
                      value={form.display_name}
                      onChange={(value) => updateForm("display_name", value)}
                    />
                    <label className="inline-flex items-center gap-2 self-end text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(event) => updateForm("is_active", event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Política ativa
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-sm font-semibold text-ink">Descrição</span>
                      <textarea
                        value={form.description}
                        onChange={(event) => updateForm("description", event.target.value)}
                        className="mt-1 min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
                      />
                    </label>
                  </section>

                  <section className="rounded-md border border-slate-200 p-4">
                    <h3 className="mb-3 text-base font-semibold text-ink">Permissões</h3>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {[
                        ["can_generate_sql", "Pode gerar SQL"],
                        ["can_execute_sql", "Pode executar SQL"],
                        ["can_view_sql", "Pode ver SQL"],
                        ["can_view_own_runs", "Pode ver próprias execuções"],
                        ["can_view_all_runs", "Pode ver todo histórico"],
                        ["can_manage_users", "Pode gerenciar usuários"],
                        ["can_view_admin_area", "Pode ver área administrativa"]
                      ].map(([field, label]) => (
                        <label key={field} className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
                          <input
                            type="checkbox"
                            checked={Boolean(form[field as keyof PolicyForm])}
                            onChange={(event) =>
                              updateForm(field as keyof PolicyForm, event.target.checked as never)
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-2">
                    <h3 className="md:col-span-2 text-base font-semibold text-ink">Limites</h3>
                    <TextField
                      label="Max rows"
                      type="number"
                      value={form.max_rows}
                      onChange={(value) => updateForm("max_rows", value)}
                    />
                    <TextField
                      label="Max execution time ms"
                      type="number"
                      value={form.max_execution_time_ms}
                      onChange={(value) => updateForm("max_execution_time_ms", value)}
                    />
                  </section>

                  <section className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-2">
                    <h3 className="md:col-span-2 text-base font-semibold text-ink">Intenções</h3>
                    <TextAreaField
                      label="allowed_intents"
                      value={form.allowed_intents}
                      onChange={(value) => updateForm("allowed_intents", value)}
                    />
                    <TextAreaField
                      label="denied_intents"
                      value={form.denied_intents}
                      onChange={(value) => updateForm("denied_intents", value)}
                    />
                  </section>

                  <section className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-2">
                    <h3 className="md:col-span-2 text-base font-semibold text-ink">Tabelas</h3>
                    <TextAreaField
                      label="allowed_tables"
                      value={form.allowed_tables}
                      onChange={(value) => updateForm("allowed_tables", value)}
                    />
                    <TextAreaField
                      label="denied_tables"
                      value={form.denied_tables}
                      onChange={(value) => updateForm("denied_tables", value)}
                    />
                  </section>

                  <section className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-2">
                    <h3 className="md:col-span-2 text-base font-semibold text-ink">Avançado</h3>
                    <JsonTextArea
                      label="allowed_columns"
                      value={form.allowed_columns}
                      onChange={(value) => updateForm("allowed_columns", value)}
                    />
                    <JsonTextArea
                      label="denied_columns"
                      value={form.denied_columns}
                      onChange={(value) => updateForm("denied_columns", value)}
                    />
                    <JsonTextArea
                      label="required_filters"
                      value={form.required_filters}
                      onChange={(value) => updateForm("required_filters", value)}
                    />
                    <JsonTextArea
                      label="metadata"
                      value={form.metadata}
                      onChange={(value) => updateForm("metadata", value)}
                    />
                  </section>

                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={closeEdit}
                      className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-ink shadow-sm hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-lake px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <Settings className="h-4 w-4" aria-hidden="true" />
                      {saving ? "Salvando..." : "Salvar alterações"}
                    </button>
                  </div>
                </div>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function TextField({
  label,
  value,
  type = "text",
  onChange
}: {
  label: string;
  value: string;
  type?: "text" | "number";
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="mt-1 min-h-36 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs leading-5 text-ink shadow-sm focus:border-blue-400 focus:outline-none"
      />
    </label>
  );
}

function JsonTextArea({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return <TextAreaField label={`${label} (JSON)`} value={value} onChange={onChange} />;
}
