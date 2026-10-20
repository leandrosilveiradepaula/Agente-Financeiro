import { describe, expect, it, vi } from "vitest";
import {
  compareLangGraphShadowSql
} from "@/lib/langgraph-shadow-comparison-client";

const env = {
  LANGGRAPH_SHADOW_COMPARISON_ENABLED: "true",
  LANGGRAPH_INTERNAL_BASE_URL: "http://127.0.0.1:8000",
  LANGGRAPH_S2S_TOKEN: "test-s2s-token"
};

const input = {
  agentRunId: "agent-run-1",
  shadowRecordId: "shadow-record-1",
  question: "Generic novel analysis",
  officialSql: "SELECT SUM(qty) FROM example_records WHERE period_id = 12",
  originalUserId: "user-one"
};

const safeComparison = {
  comparison_version: "v1.0.0-post-generation-structural",
  shadow_record_id: input.shadowRecordId,
  verdict: "structural_differences",
  different_facets: ["predicates"],
  normalized_sql_match: false,
  unsupported_predicates_present: false,
  tenant_identity_attested: false,
  same_data_snapshot_attested: false,
  financial_parity_proven: false,
  real_sql_executed: false,
  requires_reapproval: false,
  shadow_context_version: "tenant-version"
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

describe("post-generation SQL comparison transport", () => {
  it("defaults disabled and performs zero HTTP calls", async () => {
    const fetchImpl = vi.fn();
    const result = await compareLangGraphShadowSql(input, {
      env: {...env, LANGGRAPH_SHADOW_COMPARISON_ENABLED: "false"},
      fetchImpl
    });
    expect(result.status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends only official historical SQL to authenticated S2S after generation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      contract_version: "1", agent_run_id: input.agentRunId,
      status: "success", metadata: {comparison: safeComparison}
    }));
    const result = await compareLangGraphShadowSql(input,{env,fetchImpl});
    expect(result.status).toBe("ok");
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe("http://127.0.0.1:8000/v1/internal/sql-agent/compare-shadow-sql");
    expect(init.headers.Authorization).toBe("Bearer test-s2s-token");
    expect(init.headers.Cookie).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      contract_version: "1", agent_run_id: input.agentRunId,
      shadow_record_id: input.shadowRecordId,
      question: input.question, official_sql: input.officialSql,
      principal: {id: input.originalUserId}
    });
    expect(JSON.stringify(body)).not.toContain("test-s2s-token");
    expect(JSON.stringify(result)).not.toContain("SELECT");
    expect(JSON.stringify(result)).not.toContain("example_records");
  });

  it("allowlists response fields without exposing SQL or sensitive values", async () => {
    const fetchImpl=vi.fn().mockResolvedValue(response({
      contract_version:"1", agent_run_id:input.agentRunId, status:"success",
      metadata:{comparison:{
        ...safeComparison, unexpected_sql:"SELECT sensitive FROM internal",
        raw_provider_response:"secret", different_facets:["predicates"]
      }}
    }));
    const result=await compareLangGraphShadowSql(input,{env,fetchImpl});
    expect(result.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("SELECT");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.status === "ok" ? result.data.different_facets : []).toEqual(["predicates"]);
  });

  it("rejects mismatched run, shadow id, unrecognized facet and unsupported claims", async () => {
    const malformed = [
      {agent_run_id: "other", comparison: safeComparison},
      {agent_run_id: input.agentRunId, comparison: {...safeComparison,shadow_record_id:"other"}},
      {agent_run_id: input.agentRunId, comparison: {...safeComparison,different_facets:["sensitive_raw_sql"]}},
      {agent_run_id: input.agentRunId, comparison: {...safeComparison,financial_parity_proven:true}},
      {agent_run_id: input.agentRunId, comparison: {...safeComparison,real_sql_executed:true}}
    ];
    for(const item of malformed) {
      const fetchImpl = vi.fn().mockResolvedValue(response({
        contract_version:"1",status:"success",agent_run_id:item.agent_run_id,
        metadata:{comparison:item.comparison}
      }));
      const result=await compareLangGraphShadowSql(input,{env,fetchImpl});
      expect(result.status).toBe("invalid_response");
    }
  });


  it("attests signed provider/model identifiers without returning raw provider payload", async () => {
    const compare = {
      ...safeComparison,
      shadow_generator_provider: "provider-neutral",
      shadow_generator_model: "model-v3",
      shadow_repair_provider: null,
      shadow_repair_model: null,
      generator_identity_attested: true,
      repair_identity_attested: true,
      token_usage: { secret: "never-expose" }
    };
    const fetchImpl = vi.fn().mockResolvedValue(response({
      contract_version:"1",agent_run_id:input.agentRunId,status:"success",
      metadata:{comparison:compare}
    }));
    const result=await compareLangGraphShadowSql(input,{env,fetchImpl});
    expect(result.status).toBe("ok");
    if(result.status!=="ok") throw Error("Expected attestation");
    expect(result.data.shadow_generator_provider).toBe("provider-neutral");
    expect(result.data.shadow_generator_model).toBe("model-v3");
    expect(result.data.generator_identity_attested).toBe(true);
    expect(JSON.stringify(result)).not.toContain("token_usage");
    expect(JSON.stringify(result)).not.toContain("never-expose");
  });

  it("keeps previous comparison payloads explicitly unattested", async () => {
    const fetchImpl=vi.fn().mockResolvedValue(response({
      contract_version:"1",status:"success",agent_run_id:input.agentRunId,
      metadata:{comparison:safeComparison}
    }));
    const result=await compareLangGraphShadowSql(input,{env,fetchImpl});
    expect(result.status).toBe("ok");
    if(result.status!=="ok") throw Error("Expected safe fallback");
    expect(result.data.shadow_generator_provider).toBe(null);
    expect(result.data.generator_identity_attested).toBe(false);
  });

  it("rejects partial, forged or unsafe provider identity evidence", async () => {
    const base={
      ...safeComparison,
      shadow_generator_provider:"provider-neutral",
      shadow_generator_model:"model-v3",
      shadow_repair_provider:null,
      shadow_repair_model:null,
      generator_identity_attested:true,
      repair_identity_attested:true
    };
    for(const bad of [
      {...base,shadow_generator_model:"Bearer secret"},
      {...base,generator_identity_attested:false},
      {...base,shadow_generator_model:123},
      {...base,shadow_repair_provider:undefined}
    ]) {
      const fetchImpl=vi.fn().mockResolvedValue(response({
        contract_version:"1",status:"success",agent_run_id:input.agentRunId,
        metadata:{comparison:bad}
      }));
      const result=await compareLangGraphShadowSql(input,{env,fetchImpl});
      expect(result.status).toBe("invalid_response");
    }
  });

  it("does not send requests with missing token or invalid payloads", async () => {
    const fetchImpl=vi.fn();
    expect((await compareLangGraphShadowSql(input,{
      env:{...env,LANGGRAPH_S2S_TOKEN:""},fetchImpl
    })).status).toBe("configuration_error");
    expect((await compareLangGraphShadowSql({...input,officialSql:""},{
      env,fetchImpl
    })).status).toBe("configuration_error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps rejection and infrastructure errors without leaking response bodies", async () => {
    const invalid=vi.fn().mockResolvedValue(response({secret:"do-not-expose"},422));
    expect((await compareLangGraphShadowSql(input,{env,fetchImpl:invalid})).status).toBe("rejected");
    const failed=vi.fn().mockRejectedValue(new Error("sensitive-internal-detail"));
    const result=await compareLangGraphShadowSql(input,{env,fetchImpl:failed});
    expect(result.status).toBe("network_error");
    expect(JSON.stringify(result)).not.toContain("sensitive-internal-detail");
  });
});
