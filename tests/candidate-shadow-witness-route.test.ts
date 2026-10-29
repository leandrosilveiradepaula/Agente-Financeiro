import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  auth:vi.fn(),policy:vi.fn(),tenant:vi.fn(),
  claim:vi.fn(),complete:vi.fn(),fetch:vi.fn()
}));
vi.mock("server-only",()=>({}));
vi.mock("next/server",()=>({
  NextResponse:{json:(value:unknown,init?:{status?:number})=>({
    status:init?.status??200,json:async()=>value
  })}
}));
vi.mock("@/lib/server-auth",()=>({requireAdminSession:mocks.auth}));
vi.mock("@/lib/profile-policy",()=>({getProfilePolicy:mocks.policy}));
vi.mock("@/lib/tenant-identity",()=>({getSessionTenantIdentity:mocks.tenant}));
vi.mock("@/lib/candidate-shadow-witness",()=>({
  claimShadowWitness:mocks.claim,completeShadowWitness:mocks.complete
}));

const ORG="11111111-1111-4111-8111-111111111111";
const USER="22222222-2222-4222-8222-222222222222";
const REQUEST="33333333-3333-4333-8333-333333333333";
const RUN="44444444-4444-4444-8444-444444444444";
const WITNESS="55555555-5555-4555-8555-555555555555";
const url="https://n8n.example.org/webhook/langgraph-candidate-approved-sql-shadow-v1";
const context={params:Promise.resolve({id:REQUEST})};
const request=(body="{}")=>new Request("http://localhost/api/admin/candidate-execution-requests/"+
  REQUEST+"/shadow-validate",{method:"POST",headers:{"Content-Type":"application/json"},body});
beforeEach(()=>{
  vi.resetAllMocks();
  vi.stubEnv("AGENT_CANDIDATE_SHADOW_WITNESS_ENABLED","true");
  vi.stubEnv("AGENT_CANDIDATE_SHADOW_WITNESS_NO_EXECUTION_ATTESTED","true");
  vi.stubEnv("AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED","true");
  vi.stubEnv("AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID",ORG);
  vi.stubEnv("LANGGRAPH_OFFICIAL_VIA_N8N","false");
  vi.stubEnv("N8N_CANDIDATE_SHADOW_WITNESS_WEBHOOK_URL",url);
  vi.stubEnv("N8N_CANDIDATE_SHADOW_WITNESS_TOKEN","synthetic-credential");
  mocks.auth.mockResolvedValue({
    session:{userId:USER,userProfile:"admin"},response:null
  });
  mocks.policy.mockResolvedValue({
    is_active:true,can_view_sql:true,can_execute_sql:true
  });
  mocks.tenant.mockReturnValue({status:"ready",organizationId:ORG});
  mocks.claim.mockResolvedValue({
    witnessId:WITNESS,executionRequestId:REQUEST,organizationId:ORG,
    agentRunId:RUN,bindingSha256:"b".repeat(64),approvedSql:"SELECT 1"
  });
  mocks.complete.mockResolvedValue(true);
  mocks.fetch.mockImplementation(async (_url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));
    return {status:200,json:async()=>({
      contract_version:"1",execution_request_id:REQUEST,
      agent_run_id:body.agent_run_id,run_id:"langgraph-shadow-1",
      status:"success",response_fingerprint:"a".repeat(64),
      requires_reapproval:false,real_sql_executed:false,
      financial_parity_proven:false,
      validation:{security:"approved",contract:"approved",preflight:"approved"}
    })};
  });
  vi.stubGlobal("fetch",mocks.fetch);
});

describe("Approved SQL Shadow witness is evidence, never execution",()=>{
  it("sends only immutable server-derived SQL and stores a no-execution receipt",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-execution-requests/[id]/shadow-validate/route");
    const res=await POST(request(),context);
    const result=await res.json();
    expect(res.status).toBe(200);
    expect(result).toMatchObject({
      success:true,execution_request_id:REQUEST,witness_status:"success",
      real_sql_executed:false,financial_parity_proven:false,execution_authorized:false
    });
    expect(JSON.stringify(result)).not.toContain("SELECT");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [endpoint,opts]=mocks.fetch.mock.calls[0];
    expect(endpoint).toBe(url);
    const envelope=JSON.parse(opts.body);
    expect(envelope.approved_sql).toBe("SELECT 1");
    expect(envelope.agent_run_id).toBe(RUN);
    expect(envelope.principal.organization_id).toBe(ORG);
    expect(envelope.correlation_metadata.execution_request_id).toBe(REQUEST);
    expect(envelope.correlation_metadata.approval_binding_sha256).toBe("b".repeat(64));
    expect(envelope.principal.id).toBe(USER);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      witnessId:WITNESS,status:"success",requiresReapproval:false
    }));
  });
  it("does not accept request-controlled SQL or organization",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-execution-requests/[id]/shadow-validate/route");
    const res=await POST(request(JSON.stringify({approved_sql:"SELECT confidential",organization_id:ORG})),context);
    expect(res.status).toBe(400);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("enforces admin policy, tenant pin and runtime non-execution attestation",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-execution-requests/[id]/shadow-validate/route");
    mocks.policy.mockResolvedValueOnce({
      is_active:true,can_view_sql:false,can_execute_sql:true
    });
    expect((await POST(request(),context)).status).toBe(403);
    vi.stubEnv("AGENT_CANDIDATE_SHADOW_WITNESS_NO_EXECUTION_ATTESTED","false");
    expect((await POST(request(),context)).status).toBe(404);
    vi.stubEnv("AGENT_CANDIDATE_SHADOW_WITNESS_NO_EXECUTION_ATTESTED","true");
    mocks.tenant.mockReturnValueOnce({status:"ready",organizationId:USER});
    expect((await POST(request(),context)).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("on a repaired/rejected SQL only records reapproval requirement",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-execution-requests/[id]/shadow-validate/route");
    mocks.fetch.mockImplementationOnce(async(_url:string,init:RequestInit)=>{
      const q=JSON.parse(String(init.body));
      return{status:200,json:async()=>({
        contract_version:"1",execution_request_id:REQUEST,
        agent_run_id:q.agent_run_id,run_id:"langgraph-repair-1",
        status:"rejected",response_fingerprint:"a".repeat(64),
        requires_reapproval:true,real_sql_executed:false,
        financial_parity_proven:false,
        validation:{security:"rejected",contract:"not_run",preflight:"rejected"}
      })};
    });
    const res=await POST(request(),context);
    expect(res.status).toBe(200);
    const body=await res.json();
    expect(body.requires_reapproval).toBe(true);
    expect(body.execution_authorized).toBe(false);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      status:"rejected",requiresReapproval:true
    }));
  });
  it("fails closed and does not leak SQL or upstream errors on forged execution claim",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-execution-requests/[id]/shadow-validate/route");
    mocks.fetch.mockImplementationOnce(async()=>({
      status:200,json:async()=>({
        contract_version:"1",execution_request_id:REQUEST,
        agent_run_id:RUN,run_id:"x",
        status:"success",response_fingerprint:"a".repeat(64),
        requires_reapproval:false,real_sql_executed:true,
        financial_parity_proven:false,
        validation:{security:"approved",contract:"approved",preflight:"approved"}
      })
    }));
    const res=await POST(request(),context);
    expect(res.status).toBe(503);
    const body=await res.json();
    expect(body.error).toBe("witness_unavailable_requires_reconciliation");
    expect(mocks.complete).toHaveBeenCalledWith({
      witnessId:WITNESS,organizationId:ORG,status:"unavailable"
    });
    expect(JSON.stringify(body)).not.toContain("SELECT");
  });
});
