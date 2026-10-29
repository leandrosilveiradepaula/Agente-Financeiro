import "server-only";

import type { SanitizedAgentRun } from "@/lib/agent-runs";
import {
  compareLangGraphShadowSql,
  type CompareShadowRequest,
  type CompareShadowResult,
  type ShadowSqlComparison
} from "@/lib/langgraph-shadow-comparison-client";
import {
  listLangGraphShadowRuns,
  type LangGraphShadowReadResult
} from "@/lib/langgraph-shadow-read-client";
import { assessRecordedProviderIdentity } from "@/lib/shadow-provider-parity";
import type { ShadowRunSummary } from "@/lib/types";

// Uses previously persisted official SQL and persisted Shadow evidence.
// Absolutely no generation, repair, approval, execution or benchmark intake.
export type ParityOutcome =
  | "structural_match"
  | "structural_difference"
  | "provenance_missing"
  | "provider_mismatch"
  | "inconclusive"
  | "reapproval_required"
  | "official_sql_missing"
  | "official_identity_missing"
  | "cache_ineligible"
  | "shadow_missing"
  | "shadow_not_successful"
  | "shadow_ambiguous"
  | "shadow_read_unavailable"
  | "comparison_unavailable";

export type ParityStage = "not_recorded" | "match" | "difference" | "inconclusive" | "unavailable";
export type ParityRow = {
  agent_run_id: string;
  shadow_record_id: string | null;
  outcome: ParityOutcome;
  generated: ParityStage;
  executed: ParityStage;
  provider_identity: "identifiers_matched" | "identifier_mismatch" | "unattested";
  tenant_identity_attested: boolean;
  intent_label_attested: boolean;
  financial_parity_proven: false;
};

export type ParityBatchReport = {
  contract_version: "1";
  comparison_scope: "historical_persisted_sql_only";
  benchmark_frozen: false;
  snapshot_parity_attested: false;
  financial_parity_proven: false;
  real_sql_executed: false;
  sample_count: number;
  counts: Record<ParityOutcome, number>;
  cases: ParityRow[];
};

type Deps = {
  list: (id: string) => Promise<LangGraphShadowReadResult<ShadowRunSummary[]>>;
  compare: (request: CompareShadowRequest) => Promise<CompareShadowResult>;
};

const OUTCOMES: ParityOutcome[] = [
  "structural_match", "structural_difference", "provenance_missing",
  "provider_mismatch",
  "inconclusive", "reapproval_required", "official_sql_missing",
  "official_identity_missing", "cache_ineligible", "shadow_missing",
  "shadow_not_successful", "shadow_ambiguous", "shadow_read_unavailable",
  "comparison_unavailable"
];
const SHADOW_LIMIT = 50;
const MAX_BATCH = 20;
const MAX_IN_FLIGHT = 3;
const SHADOW_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function emptyRow(run: Pick<SanitizedAgentRun, "id">, outcome: ParityOutcome): ParityRow {
  return {
    agent_run_id: run.id,
    shadow_record_id: null,
    outcome,
    generated: "not_recorded",
    executed: "not_recorded",
    provider_identity: "unattested",
    tenant_identity_attested: false,
    intent_label_attested: false,
    financial_parity_proven: false
  };
}

function stageFor(result: CompareShadowResult | null): ParityStage {
  if (!result) return "not_recorded";
  if (result.status !== "ok") return "unavailable";
  if (result.data.verdict === "normalized_sql_match" &&
      result.data.unsupported_predicates_present === false) return "match";
  if (result.data.verdict === "structural_differences") return "difference";
  return "inconclusive";
}

function isAttested(result: ShadowSqlComparison): boolean {
  return result.tenant_identity_attested === true &&
    result.intent_label_status === "identifiers_matched" &&
    result.generator_identity_attested === true;
}

async function inspectOne(run: SanitizedAgentRun, deps: Deps): Promise<ParityRow> {
  const officialSql = run.sql_generated?.trim() || null;
  const executedSql = run.sql_executed?.trim() || null;
  if (!officialSql && !executedSql) return emptyRow(run, "official_sql_missing");
  if (!run.user_id || !run.pergunta?.trim()) {
    return emptyRow(run, "official_identity_missing");
  }
  // A cache hit is not a newly attested official Gemini invocation.
  if (run.sql_cache_hit === true) return emptyRow(run, "cache_ineligible");

  let found: Awaited<ReturnType<Deps["list"]>>;
  try {
    found = await deps.list(run.id);
  } catch {
    return emptyRow(run, "shadow_read_unavailable");
  }
  if (found.status !== "ok") return emptyRow(run, "shadow_read_unavailable");

  // The list endpoint is bounded. Saturation means there may be more
  // Generate attempts. Never choose the apparently best one.
  if (found.data.length >= SHADOW_LIMIT) return emptyRow(run, "shadow_ambiguous");
  if (found.data.some((item) => item.agent_run_id !== run.id)) {
    return emptyRow(run, "shadow_ambiguous");
  }
  const generated = found.data.filter((item) => item.event_type === "generate");
  if (!generated.length) return emptyRow(run, "shadow_missing");
  if (generated.length !== 1 ||
      !SHADOW_ID_PATTERN.test(generated[0].shadow_record_id)) {
    return emptyRow(run, "shadow_ambiguous");
  }
  const record = generated[0];
  if (record.status !== "success") {
    return emptyRow(run, "shadow_not_successful");
  }
  if (record.requires_reapproval) {
    return { ...emptyRow(run, "reapproval_required"),
      shadow_record_id: record.shadow_record_id };
  }

  const requestBase = {
    agentRunId: run.id,
    shadowRecordId: record.shadow_record_id,
    question: run.pergunta,
    officialIntent: run.detected_intent,
    originalUserId: run.user_id,
    ...(run.organization_id
      ? { organizationId: run.organization_id }
      : {})
  };
  // The caller has already selected only tenant-authorized official runs.
  // The backend comparator rechecks tenant, run ID, principal, question and
  // the signed Shadow record. Neither stage feeds official SQL to Generate.
  const attempt = async (sql: string | null) => {
    if (!sql) return null;
    try {
      return await deps.compare({ ...requestBase, officialSql: sql });
    } catch {
      return { status: "unavailable" } as CompareShadowResult;
    }
  };
  const [generatedResult, executedResult] = await Promise.all([
    attempt(officialSql), attempt(executedSql)
  ]);
  const stages = [stageFor(generatedResult), stageFor(executedResult)];
  const checks = [generatedResult, executedResult].filter(
    (item): item is Extract<CompareShadowResult, { status: "ok" }> =>
      item !== null && item.status === "ok"
  );
  const first = checks[0]?.data;
  const providerIdentity = first
    ? assessRecordedProviderIdentity(
        { provider: run.llm_provider, model: run.llm_model }, first
      )
    : "unattested";
  const attested = checks.length > 0 && checks.every((item) => isAttested(item.data));
  let outcome: ParityOutcome;
  if (stages.includes("difference")) outcome = "structural_difference";
  else if (checks.some((item) => item.data.requires_reapproval)) outcome = "reapproval_required";
  else if (stages.includes("unavailable")) outcome = "comparison_unavailable";
  else if (stages.includes("inconclusive")) outcome = "inconclusive";
  else if (checks.length === 0) outcome = "comparison_unavailable";
  else if (providerIdentity === "identifier_mismatch") {
    outcome = "provider_mismatch";
  } else if (providerIdentity !== "identifiers_matched" || !attested) {
    outcome = "provenance_missing";
  } else {
    outcome = "structural_match";
  }

  return {
    agent_run_id: run.id,
    shadow_record_id: record.shadow_record_id,
    outcome,
    generated: stages[0],
    executed: stages[1],
    provider_identity: providerIdentity,
    tenant_identity_attested: checks.length > 0 &&
      checks.every((item) => item.data.tenant_identity_attested === true),
    intent_label_attested: checks.length > 0 &&
      checks.every((item) => item.data.intent_label_status === "identifiers_matched"),
    financial_parity_proven: false
  };
}

export async function inspectParityBatch(
  runs: SanitizedAgentRun[],
  services: Deps = {
    list: (id) => listLangGraphShadowRuns(id, { limit: SHADOW_LIMIT }),
    compare: (request) => compareLangGraphShadowSql(request)
  }
): Promise<ParityBatchReport> {
  if (!Array.isArray(runs) || runs.length > MAX_BATCH) {
    throw new Error("parity_batch_limit_invalid");
  }
  const cases: ParityRow[] = [];
  // Bounded fan-out protects both the product server and LangGraph from an
  // accidental workload spike. The order is stable for operator review.
  for (let index = 0; index < runs.length; index += MAX_IN_FLIGHT) {
    const window = runs.slice(index, index + MAX_IN_FLIGHT);
    const batch = await Promise.all(window.map((run) => inspectOne(run, services)));
    cases.push(...batch);
  }
  const counts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<ParityOutcome, number>;
  for (const row of cases) counts[row.outcome]++;

  return {
    contract_version: "1",
    comparison_scope: "historical_persisted_sql_only",
    benchmark_frozen: false,
    snapshot_parity_attested: false,
    financial_parity_proven: false,
    real_sql_executed: false,
    sample_count: cases.length,
    counts,
    cases
  };
}
