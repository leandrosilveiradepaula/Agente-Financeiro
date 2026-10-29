import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const comparable = {
  verdict: "normalized_sql_match",
  different_facets: [],
  normalized_sql_match: true,
  unsupported_predicates_present: false,
  tenant_identity_attested: true,
  intent_label_status: "identifiers_matched",
  financial_parity_proven: false,
  real_sql_executed: false,
  same_data_snapshot_attested: false,
  requires_reapproval: false,
  generator_identity_attested: true,
  repair_identity_attested: true,
  shadow_generator_provider: "google_gemini",
  shadow_generator_model: "gemini-fixture",
  shadow_repair_provider: null,
  shadow_repair_model: null,
  shadow_record_id: "shadow-a",
  comparison_version: "1",
  shadow_context_version: "version-1"
} as const;

const run = {
  id: "official-a",
  source: "interface",
  metadata: { operation: "generate_sql" },
  execution_status: "executed",
  pergunta: "Question that has never appeared in a prompt",
  user_id: "user-a",
  organization_id: "tenant-a",
  sql_generated: "SELECT id FROM schema_x.data_x",
  sql_executed: "SELECT id FROM schema_x.data_x",
  sql_cache_hit: false,
  detected_intent: "generic_intent",
  llm_provider: "google_gemini",
  llm_model: "gemini-fixture"
};
function services(records: unknown[] = [{
  shadow_record_id: "shadow-a", agent_run_id: "official-a",
  event_type: "generate", status: "success", requires_reapproval: false
}]) {
  return {
    list: vi.fn(async () => ({ status: "ok", data: records })),
    compare: vi.fn(async () => ({ status: "ok", data: comparable }))
  };
}
const { inspectParityBatch } = await import("@/lib/shadow-parity-batch");

describe("historical product Shadow batch evaluation", () => {
  it("compares official persisted SQL only after finding unique correlated Shadow evidence", async () => {
    const deps = services();
    const result = await inspectParityBatch([run] as never, deps as never);
    expect(result.sample_count).toBe(1);
    expect(result.counts.structural_match).toBe(1);
    expect(result.cases[0].outcome).toBe("structural_match");
    expect(result.financial_parity_proven).toBe(false);
    expect(result.benchmark_frozen).toBe(false);
    expect(result.real_sql_executed).toBe(false);
    expect(deps.compare).toHaveBeenCalledTimes(2);
    expect(deps.compare).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "official-a", shadowRecordId: "shadow-a",
      originalUserId: "user-a", organizationId: "tenant-a",
      officialSql: "SELECT id FROM schema_x.data_x"
    }));
    expect(JSON.stringify(result)).not.toContain("schema_x.data_x");
    expect(JSON.stringify(result)).not.toContain("Question that has never appeared");
  });

  it("never treats a LangGraph candidate, P2 trial or unknown legacy origin as the official SQL", async () => {
    for (const alternate of [
      { source: "candidate_langgraph_generate_only" },
      { source: "shadow_p2_generate_only" },
      { source: null },
      { metadata: { operation: "shadow_generate_only" } },
      { metadata: null },
      { execution_status: "pending" }
    ]) {
      const deps = services();
      const report = await inspectParityBatch([{ ...run, ...alternate }] as never, deps as never);
      expect(report.cases[0].outcome).toBe("official_origin_unverified");
      expect(deps.list).not.toHaveBeenCalled();
      expect(deps.compare).not.toHaveBeenCalled();
    }
  });

  it("does not select the best attempt from duplicated or truncated evidence", async () => {
    for (const rows of [
      [
        { shadow_record_id: "shadow-a", agent_run_id: "official-a", event_type: "generate", status: "success" },
        { shadow_record_id: "shadow-b", agent_run_id: "official-a", event_type: "generate", status: "success" }
      ],
      Array.from({ length: 50 }, (_, index) => ({
        shadow_record_id: "shadow-" + index,
        agent_run_id: "official-a",
        event_type: index === 0 ? "generate" : "execute_approved_shadow",
        status: "success"
      }))
    ]) {
      const deps = services(rows);
      const result = await inspectParityBatch([run] as never, deps as never);
      expect(result.cases[0].outcome).toBe("shadow_ambiguous");
      expect(deps.compare).not.toHaveBeenCalled();
    }
  });

  it("treats missing provenance, disagreement, cache and repairs as blocking", async () => {
    const withoutProvider = services();
    withoutProvider.compare.mockResolvedValue({
      status: "ok", data: {
        ...comparable, generator_identity_attested: false,
        shadow_generator_provider: null, shadow_generator_model: null
      }
    } as never);
    expect((await inspectParityBatch([run] as never, withoutProvider as never)).cases[0].outcome)
      .toBe("provenance_missing");
    const mismatched = services();
    expect((await inspectParityBatch([{ ...run, llm_model: "different" }] as never,
      mismatched as never)).cases[0].outcome).toBe("provider_mismatch");
    const cached = services();
    expect((await inspectParityBatch([{ ...run, sql_cache_hit: true }] as never,
      cached as never)).cases[0].outcome).toBe("cache_ineligible");
    expect(cached.list).not.toHaveBeenCalled();
    const repaired = services([{
      shadow_record_id: "shadow-a", agent_run_id: "official-a",
      event_type: "generate", status: "success", requires_reapproval: true
    }]);
    expect((await inspectParityBatch([run] as never, repaired as never)).cases[0].outcome)
      .toBe("reapproval_required");
    expect(repaired.compare).not.toHaveBeenCalled();
  });

  it("does not silently turn network errors or missing evidence into success", async () => {
    const deps = services([]);
    expect((await inspectParityBatch([run] as never, deps as never)).cases[0].outcome)
      .toBe("shadow_missing");
    deps.list.mockRejectedValueOnce(Error("private URL and raw token should not leak"));
    const result = await inspectParityBatch([run] as never, deps as never);
    expect(result.cases[0].outcome).toBe("shadow_read_unavailable");
    expect(JSON.stringify(result)).not.toContain("private URL");
  });

  it("enforces a bounded window", async () => {
    await expect(inspectParityBatch(Array.from({ length: 21 }, () => run) as never))
      .rejects.toThrow("parity_batch_limit_invalid");
  });
});
