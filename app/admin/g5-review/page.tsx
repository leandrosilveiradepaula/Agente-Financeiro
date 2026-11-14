"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Kind = "financial" | "physical";
type ReviewData = {
  status: string;
  revision: string;
  counts?: Record<string, number>;
  kind?: Kind;
  index?: number;
  source?: unknown;
  decision?: {
    classification?: string;
    destinations?: { collection: string; index: number }[];
    source_schema?: string | null;
    source_table?: string;
    source_column?: string | null;
    physical_options_unapproved?: {
      qualified_table: string;
      columns: { name: string; type: string }[];
    }[];
  };
  audit_sequence?: number;
  accounting_approved: false;
};
type ApiResult = { success: boolean; review?: ReviewData; error?: string };

function parseDestinations(value: string) {
  if (!value.trim()) return [];
  return value.split(",").map((part) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]{0,62}):([0-9]+)$/.exec(part.trim());
    if (!match) throw new Error("Use collection:index separados por vírgula.");
    return { collection: match[1], index: Number(match[2]) };
  });
}

export default function G5OwnerReviewPage() {
  const [status, setStatus] = useState<ReviewData | null>(null);
  const [item, setItem] = useState<ReviewData | null>(null);
  const [kind, setKind] = useState<Kind>("financial");
  const [indexText, setIndexText] = useState("1");
  const [classification, setClassification] = useState("UNRESOLVED");
  const [destinations, setDestinations] = useState("");
  const [table, setTable] = useState("");
  const [column, setColumn] = useState("");
  const [rationale, setRationale] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("Carregando status...");
  const [blocked, setBlocked] = useState(false);

  const reloadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/g5-review", {
        cache: "no-store", credentials: "same-origin"
      });
      const body = (await response.json()) as ApiResult;
      if (!response.ok || !body.success || !body.review) {
        setBlocked(true);
        setNotice(response.status === 401 || response.status === 403
          ? "Acesso reservado ao administrador autorizado."
          : "Revisão G5 indisponível. Nenhum dado financeiro foi carregado.");
        return;
      }
      setStatus(body.review);
      setBlocked(false);
      setNotice("Rascunho privado. Nenhuma aprovação contábil foi emitida.");
    } catch {
      setBlocked(true);
      setNotice("Não foi possível consultar o serviço privado de revisão.");
    }
  }, []);

  useEffect(() => { void reloadStatus(); }, [reloadStatus]);

  const options = useMemo(
    () => item?.decision?.physical_options_unapproved ?? [],
    [item]
  );
  const selectedColumns = options.find((value) => value.qualified_table === table)?.columns ?? [];

  async function openItem() {
    const n = Number(indexText);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) {
      setNotice("Informe um número de referência válido.");
      return;
    }
    setPending(true);
    setItem(null);
    try {
      const url = "/api/admin/g5-review?kind=" + encodeURIComponent(kind) +
        "&index=" + encodeURIComponent(String(n - 1));
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      const body = (await response.json()) as ApiResult;
      if (!response.ok || !body.success || !body.review) {
        setNotice("Referência indisponível ou acesso não autorizado.");
        return;
      }
      const data = body.review;
      setItem(data);
      setClassification(data.decision?.classification ?? "UNRESOLVED");
      setDestinations((data.decision?.destinations ?? []).map(
        (d) => d.collection + ":" + d.index
      ).join(", "));
      // A new physical selection must always be explicit. No preapproval
      // from matching names, model suggestions, or previous source aliases.
      setTable("");
      setColumn("");
      setRationale("");
      setNotice("Verifique os dados originais antes de registrar qualquer decisão.");
    } catch {
      setNotice("Não foi possível ler a referência privada.");
    } finally {
      setPending(false);
    }
  }

  async function saveDraft() {
    if (!item || item.index === undefined || !item.revision) return;
    setPending(true);
    try {
      let decision: Record<string, unknown>;
      if (kind === "financial") {
        decision = {
          classification,
          destinations: classification === "FORBIDDEN" ? parseDestinations(destinations) : []
        };
      } else {
        if (!table) throw new Error("Selecione explicitamente uma tabela física.");
        if (item.decision?.source_column && !column) {
          throw new Error("Selecione explicitamente uma coluna física.");
        }
        decision = {
          qualified_table: table,
          target_column: item.decision?.source_column ? column : null,
          review_rationale: rationale.trim() || null
        };
      }
      const response = await fetch("/api/admin/g5-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          kind, index: item.index, expected_revision: item.revision, decision
        })
      });
      const body = (await response.json()) as ApiResult;
      if (!response.ok || !body.success) {
        setNotice(body.error === "review_conflict"
          ? "A revisão foi alterada. Reabra a referência antes de salvar."
          : "Decisão recusada. Confira a identidade física e a justificativa.");
        return;
      }
      setNotice("Rascunho gravado em trilha auditável. Sem aprovação ou execução SQL.");
      setItem(null);
      await reloadStatus();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Decisão não aplicada.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6 text-slate-900">
      <Link href="/admin/runs" className="text-sm text-blue-700 underline">
        Voltar à administração
      </Link>
      <h1 className="mt-5 text-2xl font-semibold">Revisão semântica G5 / P3</h1>
      <p className="mt-2 text-sm text-slate-700">
        Acesso administrativo. Cada registro requer uma decisão humana explícita.
        Este painel salva apenas rascunhos: não assina aprovações, não ativa
        contexto e não executa SQL financeira.
      </p>
      <p role="status" aria-live="polite"
         className="mt-4 rounded border border-slate-300 bg-slate-50 p-3 text-sm">
        {notice}
      </p>
      {status?.counts && (
        <section className="mt-4 rounded border p-4" aria-label="Progresso da revisão">
          <h2 className="font-semibold">Progresso do bloco financeiro</h2>
          <p className="mt-2 text-sm">
            Classificações: {status.counts.financial_classified ?? 0}/
            {status.counts.financial_total ?? 0}.
            Vínculos físicos: {status.counts.physical_selected ?? 0}/
            {status.counts.physical_total ?? 0}.
          </p>
          <p className="text-sm">
            Destinos canônicos pendentes: {status.counts.financial_destinations_needed ?? 0}.
            Decisões registradas: {status.counts.session_actions ?? 0}.
          </p>
        </section>
      )}
      {!blocked && status && (
        <section className="mt-6 rounded border p-4">
          <h2 className="font-semibold">Examinar uma referência original</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Tipo
              <select className="mt-1 block rounded border p-2" value={kind}
                disabled={pending} onChange={(e) => { setKind(e.target.value as Kind); setItem(null); }}>
                <option value="financial">Financeira (77)</option>
                <option value="physical">Física (48)</option>
              </select>
            </label>
            <label className="text-sm">
              Referência
              <input className="mt-1 block w-24 rounded border p-2" type="number" min="1"
                value={indexText} disabled={pending}
                onChange={(e) => { setIndexText(e.target.value); setItem(null); }}/>
            </label>
            <button className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
              onClick={() => void openItem()} disabled={pending}>Examinar</button>
          </div>
        </section>
      )}
      {item && (
        <section className="mt-6 space-y-4 rounded border border-amber-300 p-4">
          <h2 className="font-semibold">Fonte original — somente leitura</h2>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-3 text-sm">
            {JSON.stringify(item.source, null, 2)}
          </pre>
          {kind === "financial" ? (
            <>
              <label className="block text-sm">
                Classificação revista
                <select className="mt-1 block w-full rounded border p-2" value={classification}
                  onChange={(e) => setClassification(e.target.value)}>
                  <option value="UNRESOLVED">Não resolvido</option>
                  <option value="STRUCTURAL">Estrutura genérica</option>
                  <option value="FORBIDDEN">Conhecimento de negócio no catálogo versionado</option>
                </select>
              </label>
              <label className="block text-sm">
                Destinos no catálogo já aprovado (collection:index, separados por vírgulas)
                <input className="mt-1 block w-full rounded border p-2"
                  value={destinations} onChange={(e) => setDestinations(e.target.value)}
                  disabled={classification !== "FORBIDDEN"}
                  placeholder="Sem destino: permanece pendente"/>
              </label>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">As opções abaixo NÃO são equivalências aprovadas.</p>
              <label className="block text-sm">
                Tabela de destino (seleção humana)
                <select className="mt-1 block w-full rounded border p-2" value={table}
                  onChange={(e) => { setTable(e.target.value); setColumn(""); }}>
                  <option value="">Selecione após conferir a origem</option>
                  {options.map((option) => (
                    <option key={option.qualified_table} value={option.qualified_table}>
                      {option.qualified_table}
                    </option>
                  ))}
                </select>
              </label>
              {item.decision?.source_column && (
                <label className="block text-sm">
                  Coluna de destino
                  <select className="mt-1 block w-full rounded border p-2"
                    value={column} onChange={(e) => setColumn(e.target.value)}>
                    <option value="">Selecione a coluna física</option>
                    {selectedColumns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.type})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                Fundamentação contábil da mudança de esquema, tabela ou coluna
                <textarea className="mt-1 block w-full rounded border p-2"
                  value={rationale} onChange={(e) => setRationale(e.target.value)}
                  rows={4} maxLength={4096} placeholder="Preencha quando houver remapeamento"/>
              </label>
            </>
          )}
          <button className="rounded bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={() => void saveDraft()} disabled={pending}>
            Salvar decisão no rascunho auditável
          </button>
        </section>
      )}
    </main>
  );
}
