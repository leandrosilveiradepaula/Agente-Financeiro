"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

type Review = {
  id: string;
  agent_run_id: string;
  organization_id: string;
  requested_by: string;
  sql_text: string;
  sql_sha256: string;
  binding_sha256: string;
  context_version: string;
  provider_key: string;
  model_key: string;
  config_version: string;
  review_status: "pending" | "approved" | "rejected";
  decided_at: string | null;
  created_at: string;
};
type ReviewResponse = { success?: boolean; review?: Review; error?: string };
export default function CandidateReviewPage({
  params
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [executionIntent, setExecutionIntent] = useState("");
  const [shadowWitnessStatus, setShadowWitnessStatus] = useState("");
  const [witnessBusy, setWitnessBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/candidate-reviews/" + encodeURIComponent(id), {
      cache: "no-store"
    }).then(async (r) => {
      if (!r.ok) throw Error("Revisão indisponível ou não autorizada.");
      return r.json() as Promise<ReviewResponse>;
    }).then((data) => {
      if (active) {
        if (!data.success || !data.review) setError("Proposta não encontrada.");
        else setReview(data.review);
      }
    }).catch(() => {
      if (active) setError("Falha ao carregar a revisão.");
    });
    return () => { active = false; };
  }, [id]);

  async function decide(decision: "approved" | "rejected") {
    if (!review || review.review_status !== "pending") return;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await fetch(
        "/api/admin/candidate-reviews/" + encodeURIComponent(id),
        {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision, binding_sha256: review.binding_sha256
          })
        }
      );
      if (!response.ok) throw Error(
        "A revisão foi alterada, já decidida ou exige outro aprovador autorizado."
      );
      setReview({ ...review, review_status: decision });
      setResult(decision === "approved"
        ? "Aprovação registrada. A SQL continua sem autorização de execução."
        : "Rejeição registrada. Uma SQL corrigida exige nova geração."
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Revisão indisponível.");
    } finally {
      setBusy(false);
    }
  }


  async function requestAuthorization() {
    if(!review || review.review_status!=="approved" || busy || executionIntent) return;
    setBusy(true);
    setError("");
    try {
      const response=await fetch(
        "/api/admin/candidate-reviews/"+encodeURIComponent(id)+"/execute-request",
        {
          method:"POST",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({binding_sha256:review.binding_sha256})
        }
      );
      const data=await response.json() as {
        success?:boolean;request_id?:string;state?:string;error?:string;
      };
      if(!response.ok||!data.success||!data.request_id||
        data.state!=="pending_authorization") {
        throw Error(data.error??"Solicitação não autorizada ou já registrada.");
      }
      setExecutionIntent(data.request_id);
      setResult("Solicitação de autorização registrada. Nenhuma SQL foi executada.");
    } catch(e) {
      setError(e instanceof Error?e.message:"Solicitação indisponível.");
    } finally {setBusy(false);}
  }

  async function validateShadowWitness(){
    if(!executionIntent||witnessBusy||shadowWitnessStatus)return;
    setError("");setWitnessBusy(true);
    try{
      const response=await fetch(
        "/api/admin/candidate-execution-requests/"+
        encodeURIComponent(executionIntent)+"/shadow-validate",
        {method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:"{}"}
      );
      const data=await response.json() as {
        success?:boolean;witness_status?:string;
        requires_reapproval?:boolean;error?:string;
      };
      if(!response.ok||!data.success){
        throw Error(data.error??"Validação Shadow indisponível.");
      }
      const status=data.requires_reapproval
        ?"Reparo proposto: precisa de nova geração e aprovação humana."
        :data.witness_status==="success"
          ?"SQL aprovada validada pelo Shadow. A execução financeira continua bloqueada."
          :"Validação Shadow rejeitada. A SQL não foi executada.";
      setShadowWitnessStatus(status);
    }catch(e){
      setError(e instanceof Error?e.message:"Validação indisponível.");
    }finally{setWitnessBusy(false);}
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-5 py-8 text-ink">
      <Link className="text-sm font-semibold text-lake underline"
        href="/admin/candidate-generate">Voltar à geração candidata</Link>
      <h1 className="text-3xl font-semibold">Revisar SQL candidata</h1>
      <p className="text-sm text-steel">
        Aprovação por outro administrador autorizado, no mesmo tenant.
        A decisão é vinculada à SQL exata, contexto e versão do modelo.
      </p>
      {error && <p role="alert" className="rounded-md border border-rose-200 p-3">{error}</p>}
      {result && <p role="status" className="rounded-md border p-3">{result}</p>}
      {review && (
        <section className="space-y-3 rounded-lg border p-5">
          <p className="font-semibold">Estado: {review.review_status}</p>
          <p className="text-sm text-steel">
            Contexto: {review.context_version} · Modelo: {review.provider_key} / {review.model_key}
            {" "}· Configuração: {review.config_version}
          </p>
          <p className="break-all font-mono text-xs">SHA-256 da SQL: {review.sql_sha256}</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-sm text-white">
            {review.sql_text}
          </pre>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy || review.review_status !== "pending"}
              onClick={() => decide("approved")}
              className="rounded-md bg-lake px-4 py-2 font-semibold text-white disabled:opacity-50">
              Registrar aprovação
            </button>
            <button type="button" disabled={busy || review.review_status !== "pending"}
              onClick={() => decide("rejected")}
              className="rounded-md border px-4 py-2 font-semibold disabled:opacity-50">
              Rejeitar
            </button>
          </div>
          {review.review_status==="approved" && (
            <button type="button" disabled={busy || Boolean(executionIntent)}
              onClick={()=>void requestAuthorization()}
              className="rounded-md border border-blue-300 px-4 py-2 font-semibold disabled:opacity-50">
              Solicitar autorização de execução (não executa SQL)
            </button>
          )}
          {executionIntent&&(
            <p className="font-mono text-xs">Solicitação pendente: {executionIntent}</p>
          )}
          {executionIntent && !shadowWitnessStatus && (
            <button type="button" disabled={witnessBusy}
              onClick={()=>void validateShadowWitness()}
              className="rounded-md border border-blue-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {witnessBusy?"Validando no Shadow...":"Validar SQL no Shadow (não executa)"}
            </button>
          )}
          {shadowWitnessStatus&&<p role="status" className="rounded-md border p-3 text-sm">
            {shadowWitnessStatus}
          </p>}
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
            Aprovação e solicitação são etapas distintas. Nenhuma delas
            autoriza nem executa SQL financeira. A execução somente leitura
            exigirá uma autorização operacional separada. SQL reparada
            exige nova geração e nova aprovação.
          </p>
        </section>
      )}
    </main>
  );
}
