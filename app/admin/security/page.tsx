"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Users,
  XCircle
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

type SecurityCheck = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
  sensitive: false;
};

type SecuritySummary = {
  ok: number;
  warning: number;
  error: number;
};

type AccessState = "checking" | "unauthenticated" | "forbidden" | "allowed";

const PROFILE_POLICY_MANAGEMENT_ENABLED =
  process.env.NEXT_PUBLIC_PROFILE_POLICY_MANAGEMENT_ENABLED === "true";

const OPERATIONAL_CHECKLIST = [
  "Rotacionar N8N_INTERNAL_WEBHOOK_TOKEN antes do deploy.",
  "Atualizar credential Header Auth no n8n com o mesmo token.",
  "Rotacionar senha do banco se apareceu em prints.",
  "Confirmar que .env.local não está no Git.",
  "Confirmar que cookies*.txt não estão no Git.",
  "Confirmar que usuários de teste foram desativados ou removidos da apresentação.",
  "Confirmar que admin real tem senha forte.",
  "Confirmar que diretoria não vê SQL.",
  "Confirmar que comercial não gera SQL.",
  "Confirmar que auditoria acessa histórico.",
  "Confirmar que logs não armazenam tokens.",
  "Confirmar que ambiente público usa HTTPS."
];

function statusLabel(status: SecurityCheck["status"]) {
  if (status === "ok") return "OK";
  if (status === "warning") return "Aviso";
  return "Erro";
}

function statusClass(status: SecurityCheck["status"]) {
  if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function SummaryCard({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: SecurityCheck["status"];
}) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warning" ? TriangleAlert : XCircle;

  return (
    <article className={`rounded-md border p-4 shadow-soft ${statusClass(tone)}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide opacity-75">{label}</p>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </article>
  );
}

export default function AdminSecurityPage() {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [loggedUser, setLoggedUser] = useState<AuthenticatedUser | null>(null);
  const [accountPolicy, setAccountPolicy] = useState<AccountPolicy | null>(null);
  const [checks, setChecks] = useState<SecurityCheck[]>([]);
  const [summary, setSummary] = useState<SecuritySummary>({ ok: 0, warning: 0, error: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const sortedChecks = useMemo(
    () =>
      [...checks].sort((a, b) => {
        const order = { error: 0, warning: 1, ok: 2 };
        return order[a.status] - order[b.status] || a.label.localeCompare(b.label, "pt-BR");
      }),
    [checks]
  );

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

      const checksResponse = await fetch("/api/admin/security-check", { cache: "no-store" });

      if (!checksResponse.ok) {
        throw new Error("security_checks_failed");
      }

      const checksData = (await checksResponse.json()) as {
        checks?: SecurityCheck[];
        summary?: SecuritySummary;
      };

      setChecks(checksData.checks ?? []);
      setSummary(checksData.summary ?? { ok: 0, warning: 0, error: 0 });
      setAccessState("allowed");
    } catch {
      setError("Não foi possível carregar o diagnóstico de segurança.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAccessAndLoad();
  }, [checkAccessAndLoad]);

  if (accessState === "checking" || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-steel shadow-soft">
          Carregando diagnóstico de segurança...
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
              Segurança
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
              Segurança e deploy
            </h1>
            <p className="mt-2 text-sm text-steel">
              Revise configurações, segredos e checklist operacional da POC.
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
              {PROFILE_POLICY_MANAGEMENT_ENABLED ? (
                <Link className="admin-action-button" href="/admin/profile-policies">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Políticas
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <SummaryCard label="OK" value={summary.ok} tone="ok" />
          <SummaryCard label="Avisos" value={summary.warning} tone="warning" />
          <SummaryCard label="Erros" value={summary.error} tone="error" />
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-lg font-semibold text-ink">Checks administrativos</h2>
            <p className="mt-1 text-sm text-steel">
              Os valores sensíveis são verificados apenas por presença e nunca são exibidos.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-steel">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Mensagem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedChecks.map((check) => (
                  <tr key={check.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(check.status)}`}>
                        {statusLabel(check.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">{check.label}</td>
                    <td className="px-4 py-3 text-steel">{check.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Checklist operacional de deploy</h2>
          <div className="mt-4 grid gap-2">
            {OPERATIONAL_CHECKLIST.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-steel"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-lake" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
