import "server-only";

// Read-only post-generation comparison. Official SQL stays between authenticated
// backends and is never returned by this client to the browser.
const COMPARE_PATH = "/v1/internal/sql-agent/compare-shadow-sql";
const VERDICTS = new Set(["normalized_sql_match", "structural_differences", "inconclusive"]);
const FACETS = new Set([
  "physical_tables", "joined_relations", "predicates", "projections",
  "groupings", "orderings", "functions", "query_shape"
]);

type Env = Record<string, string | undefined>;

export type ShadowSqlComparison = {
  verdict: "normalized_sql_match" | "structural_differences" | "inconclusive";
  intent_label_status: "identifiers_matched" | "identifier_mismatch" | "unattested";
  different_facets: string[];
  normalized_sql_match: boolean;
  unsupported_predicates_present: boolean;
  tenant_identity_attested: boolean;
  same_data_snapshot_attested: false;
  financial_parity_proven: false;
  real_sql_executed: false;
  requires_reapproval: boolean;
  shadow_record_id: string;
  comparison_version: string;
  shadow_context_version: string;
  shadow_generator_provider: string | null;
  shadow_generator_model: string | null;
  shadow_repair_provider: string | null;
  shadow_repair_model: string | null;
  generator_identity_attested: boolean;
  repair_identity_attested: boolean;
};

export type CompareShadowResult =
  | { status: "ok"; data: ShadowSqlComparison }
  | { status: "disabled" | "configuration_error" | "unavailable" | "invalid_response" | "timeout" | "network_error" | "rejected" };

export type CompareShadowRequest = {
  agentRunId: string;
  shadowRecordId: string;
  question: string;
  officialSql: string;
  officialIntent?: string | null;
  originalUserId: string;
  organizationId?: string;
};

type Options = { env?: Env; fetchImpl?: typeof fetch };

export function isShadowSqlComparisonEnabled(env: Env = process.env): boolean {
  return env.LANGGRAPH_SHADOW_COMPARISON_ENABLED?.trim().toLowerCase() === "true";
}

export async function compareLangGraphShadowSql(
  input: CompareShadowRequest,
  options: Options = {}
): Promise<CompareShadowResult> {
  const env = options.env ?? process.env;
  if (!isShadowSqlComparisonEnabled(env)) return { status: "disabled" };
  if (
    !validString(input.agentRunId, 128) || !validString(input.shadowRecordId, 128) ||
    !validString(input.question, 16000) || !validString(input.officialSql, 262144) ||
    !validString(input.originalUserId, 256) ||
    (input.officialIntent != null && !validString(input.officialIntent, 128)) ||
    (input.organizationId !== undefined && !validString(input.organizationId, 256))
  ) return { status: "configuration_error" };

  let endpoint: string;
  let token: string;
  try {
    token = env.LANGGRAPH_S2S_TOKEN?.trim() || "";
    if (!token) throw Error("S2S token unavailable");
    const base = env.LANGGRAPH_INTERNAL_BASE_URL?.trim() || "";
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || url.search || url.hash) throw Error("Invalid internal URL");
    endpoint = url.toString().replace(/\/+$/, "") + COMPARE_PATH;
  } catch {
    return { status: "configuration_error" };
  }

  const body = {
    contract_version: "1",
    agent_run_id: input.agentRunId,
    shadow_record_id: input.shadowRecordId,
    question: input.question,
    official_sql: input.officialSql,
    ...(input.officialIntent?.trim()
      ? { official_detected_intent: input.officialIntent.trim() }
      : {}),
    principal: {
      id: input.originalUserId,
      ...(input.organizationId ? { organization_id: input.organizationId } : {})
    }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST", cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      signal: controller.signal, body: JSON.stringify(body)
    });
    if (response.status === 422) return { status: "rejected" };
    if (!response.ok) return { status: "unavailable" };
    const data: unknown = await response.json();
    const parsed = parseComparison(data, input);
    return parsed ? { status: "ok", data: parsed } : { status: "invalid_response" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "timeout" };
    return { status: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseComparison(value: unknown, request: CompareShadowRequest): ShadowSqlComparison | null {
  if (!isRecord(value) || value.contract_version !== "1" ||
      value.status !== "success" || value.agent_run_id !== request.agentRunId) {
    return null;
  }
  const metadata = isRecord(value.metadata) ? value.metadata : null;
  const comparison = metadata && isRecord(metadata.comparison) ? metadata.comparison : null;
  if (!comparison || !VERDICTS.has(String(comparison.verdict)) ||
      comparison.shadow_record_id !== request.shadowRecordId ||
      comparison.financial_parity_proven !== false ||
      comparison.real_sql_executed !== false ||
      comparison.same_data_snapshot_attested !== false ||
      !Array.isArray(comparison.different_facets) ||
      !comparison.different_facets.every((field) => typeof field === "string" && FACETS.has(field))) {
    return null;
  }
  const required = [
    "normalized_sql_match", "unsupported_predicates_present",
    "tenant_identity_attested", "requires_reapproval"
  ] as const;
  if (required.some((key) => typeof comparison[key] !== "boolean") ||
      !validString(comparison.comparison_version, 128) ||
      typeof comparison.shadow_context_version !== "string") {
    return null;
  }
  const validIntentStatuses = new Set([
    "identifiers_matched", "identifier_mismatch", "unattested"
  ]);
  const intentStatus = Object.prototype.hasOwnProperty.call(
    comparison, "intent_label_status"
  ) ? comparison.intent_label_status : "unattested";
  if (typeof intentStatus !== "string" || !validIntentStatuses.has(intentStatus)) {
    return null;
  }
  const identityFields = [
    "shadow_generator_provider", "shadow_generator_model",
    "shadow_repair_provider", "shadow_repair_model",
    "generator_identity_attested", "repair_identity_attested"
  ] as const;
  const present = identityFields.filter((key) =>
    Object.prototype.hasOwnProperty.call(comparison, key)
  );
  // The previous API has no witness fields; report unattested instead of
  // blocking structural comparisons. Partial/malformed witness records fail.
  const hasWitness = present.length === identityFields.length;
  if (present.length > 0 && !hasWitness) return null;
  const safeProviderId = new RegExp("^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$");
  const identities = identityFields.slice(0, 4).map((key) => {
    const value = hasWitness ? comparison[key] : null;
    return value === null ? null :
      typeof value === "string" && safeProviderId.test(value)
        && !/(bearer|apikey|api_key|secret|token)/i.test(value)
        ? value : false;
  });
  if (identities.some((value) => value === false)) return null;
  const generationAttested = hasWitness &&
    comparison.generator_identity_attested === true;
  const repairAttested = hasWitness &&
    comparison.repair_identity_attested === true;
  if (hasWitness &&
      (typeof comparison.generator_identity_attested !== "boolean" ||
       typeof comparison.repair_identity_attested !== "boolean" ||
       generationAttested !== Boolean(identities[0] && identities[1]))) return null;

  return {
    verdict: comparison.verdict as ShadowSqlComparison["verdict"],
    intent_label_status: intentStatus as ShadowSqlComparison["intent_label_status"],
    different_facets: [...new Set(comparison.different_facets as string[])],
    normalized_sql_match: comparison.normalized_sql_match as boolean,
    unsupported_predicates_present: comparison.unsupported_predicates_present as boolean,
    tenant_identity_attested: comparison.tenant_identity_attested as boolean,
    same_data_snapshot_attested: false, financial_parity_proven: false,
    real_sql_executed: false,
    requires_reapproval: comparison.requires_reapproval as boolean,
    shadow_record_id: request.shadowRecordId,
    comparison_version: (comparison.comparison_version as string).slice(0, 128),
    shadow_context_version: comparison.shadow_context_version.slice(0, 128),
    shadow_generator_provider: identities[0] as string | null,
    shadow_generator_model: identities[1] as string | null,
    shadow_repair_provider: identities[2] as string | null,
    shadow_repair_model: identities[3] as string | null,
    generator_identity_attested: generationAttested,
    repair_identity_attested: repairAttested
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function validString(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}
