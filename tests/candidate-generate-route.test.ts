import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(), policy: vi.fn(), tenant: vi.fn(),
  official: vi.fn(), shadow: vi.fn(), fetch: vi.fn(), persist: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: {
  json: (value: unknown, init?: {status?: number}) => ({
    status: init?.status ?? 200, json: async () => value
  })
}}));
vi.mock("@/lib/server-auth", () => ({requireAgentSession: mocks.session}));
vi.mock("@/lib/profile-policy", () => ({enforceCanGenerateSql: mocks.policy}));
vi.mock("@/lib/tenant-identity", () => ({getSessionTenantIdentity: mocks.tenant}));
vi.mock("@/lib/llm-provider-registry", () => ({
  getLlmRegistryEnvironment: () => "test",
  resolveLlmSelection: (input: {target:string}) => input.target === "official"
    ? mocks.official() : mocks.shadow()
}));
vi.mock("@/lib/candidate-sql-review", () => ({ persistCandidateReview: mocks.persist }));
vi.mock("@/lib/shadow-phase-gate", () => ({
  isShadowPhaseOneProviderMatch: (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b) && Boolean(a)
}));
const model = {provider_key:"provider",model_key:"model",config_version:"v1"};
const endpoint="https://orchestration.example.com/webhook/langgraph-candidate-generate-v1";
const org="00000000-0000-4000-8000-000000000001";
const uid="00000000-0000-4000-8000-000000000002";
function request(question="A new question") {
  return new Request("http://localhost/api/admin/candidate-generate", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({pergunta:question})
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AGENT_CANDIDATE_GENERATE_ENABLED", "true");
  vi.stubEnv("LANGGRAPH_OFFICIAL_VIA_N8N", "false");
  vi.stubEnv("N8N_CANDIDATE_GENERATE_WEBHOOK_URL", endpoint);
  vi.stubEnv("N8N_CANDIDATE_GENERATE_TOKEN", "synthetic-token");
  vi.stubEnv("AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID", org);
  mocks.session.mockResolvedValue({session:{
    userProfile:"admin",userId:uid
  },response:null});
  mocks.policy.mockResolvedValue({allowed:true});
  mocks.tenant.mockReturnValue({status:"ready",organizationId:org});
  mocks.persist.mockResolvedValue({id:"review-1",sql_sha256:"c".repeat(64),binding_sha256:"b".repeat(64)});
  mocks.official.mockReturnValue({selection:model});
  mocks.shadow.mockReturnValue({selection:model});
  mocks.fetch.mockImplementation(async (_url:string, init:RequestInit) => {
    const sent=JSON.parse(String(init.body));
    return {status:200,json:async()=>({
      contract_version:"1",agent_run_id:sent.agent_run_id,run_id:"lg-1",
      status:"success",sql:"SELECT 1",preflight:{status:"approved",executed:false},
      metadata:{context_version:"sem-v1"},
      response_fingerprint:"a".repeat(64),
      requires_human_approval:true,real_sql_executed:false
    })};
  });
  vi.stubGlobal("fetch", mocks.fetch);
});
describe("generate-only candidate route",()=>{
  it("sends an authenticated versioned generate request without executing or persisting SQL",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-generate/route");
    const res=await POST(request());
    const body=await res.json();
    expect(res.status).toBe(200);
    expect(body.sql).toBe("SELECT 1");
    expect(body.requires_human_approval).toBe(true);
    expect(body.real_sql_executed).toBe(false);
    expect(body.review_id).toBe("review-1");
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({organizationId:org,requesterId:uid,sql:"SELECT 1",contextVersion:"sem-v1"}));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const call=mocks.fetch.mock.calls[0];
    expect(call[0]).toBe(endpoint);
    const sent=JSON.parse(call[1].body);
    expect(sent.question).toBe("A new question");
    expect(sent.llm_selection).toEqual(model);
    expect(sent.correlation_metadata.event).toBe("generate");
    expect(sent.approved_sql).toBeUndefined();
  });
  it("rejects non-admin and disabled candidate before any network call",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-generate/route");
    mocks.session.mockResolvedValueOnce({session:{userProfile:"comercial",userId:"u"},response:null});
    expect((await POST(request())).status).toBe(403);
    vi.stubEnv("AGENT_CANDIDATE_GENERATE_ENABLED","false");
    expect((await POST(request())).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("requires tenant authorization and exact registered provider identity",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-generate/route");
    vi.stubEnv("AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID", "00000000-0000-4000-8000-000000000099");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID",org);
    mocks.shadow.mockReturnValue({selection:{...model,model_key:"other"}});
    expect((await POST(request())).status).toBe(503);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("fails closed when persisted review is unavailable",async()=>{
    mocks.persist.mockRejectedValueOnce(new Error("SQL/secret should never leak"));
    const {POST}=await import("@/app/api/admin/candidate-generate/route");
    const res=await POST(request());
    expect(res.status).toBe(503);
    const body=await res.json();
    expect(body.error).toBe("candidate_review_persistence_unavailable");
    expect(JSON.stringify(body)).not.toContain("SQL/secret");
  });
  it("fails closed for invalid or executed upstream evidence",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-generate/route");
    mocks.fetch.mockImplementationOnce(async(_url:string,init:RequestInit)=>{
      const sent=JSON.parse(String(init.body));
      return {status:200,json:async()=>({
        contract_version:"1",agent_run_id:sent.agent_run_id,run_id:"lg-1",
        status:"success",sql:"SELECT 1",metadata:{context_version:"sem-v1"},
        preflight:{status:"approved",executed:true},
        response_fingerprint:"a".repeat(64),
        requires_human_approval:true,real_sql_executed:false
      })};
    });
    expect((await POST(request())).status).toBe(502);
  });
});
