import type { SanitizedAgentRun } from "@/lib/agent-runs";

/**
 * Structural provenance of the Product's legacy official n8n SQL path.
 *
 * The same ai_agent_runs table also stores isolated LangGraph candidates
 * (and P2 generate-only attempts). A candidate must never be promoted to
 * an "official" baseline simply because sql_generated is populated.
 *
 * This is not an LLM/provider attestation and does not prove financial
 * parity. Those are separate post-generation evidence checks.
 */
export type OfficialSqlRunOrigin =
  | "recorded_official_path"
  | "official_origin_unverified"
  | "official_operation_unverified"
  | "official_status_unverified";

type OfficialRunFields = Pick<
  SanitizedAgentRun, "source" | "metadata" | "execution_status"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Conservative classification of a persisted Product run.
 *
 * The source and operation markers are set by server-controlled BFF code;
 * no SQL source, tenant, metrics, or business intent is inferred from text.
 * In particular, candidate_langgraph_generate_only is never an official
 * n8n baseline. Missing/unknown origins must stay unverified.
 */
export function assessRecordedOfficialSqlRunOrigin(
  run: OfficialRunFields
): OfficialSqlRunOrigin {
  if (run.source !== "interface") return "official_origin_unverified";
  if (!isRecord(run.metadata) || run.metadata.operation !== "generate_sql") {
    return "official_operation_unverified";
  }
  if (run.execution_status !== "generated" &&
      run.execution_status !== "executed") {
    return "official_status_unverified";
  }
  return "recorded_official_path";
}
