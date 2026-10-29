import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), auth: vi.fn(), policy: vi.fn(), tenant: vi.fn(), progress: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { query: mocks.query } }));
vi.mock("@/lib/candidate-shadow-witness", () => ({ getCandidateReviewProgress: mocks.progress }));
vi.mock("@/lib/server-auth", () => ({ requireAgentSession: mocks.auth }));
vi.mock("@/lib/profile-policy", () => ({ getProfilePolicy: mocks.policy }));
vi.mock("@/lib/tenant-identity", () => ({ getSessionTenantIdentity: mocks.tenant }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: {status?:number}) => ({
    status: init?.status ?? 200, json:async()=>body
  }) }
}));

const org="00000000-0000-4000-8000-000000000001";
const requester="00000000-0000-4000-8000-000000000002";
const reviewer="00000000-0000-4000-8000-000000000003";
const run="00000000-0000-4000-8000-000000000004";
const reviewId="00000000-0000-4000-8000-000000000005";
const model={provider_key:"provider",model_key:"model",config_version:"v1"};
const proposal={
  agentRunId:run,requestId:"req-1",organizationId:org,requesterId:requester,
  question:"A novel question",sql:"SELECT value FROM approved_catalog",
  langgraphRunId:"langgraph-1",contextVersion:"context-v3",
  responseFingerprint:"a".repeat(64),model
};
const { persistCandidateReview, decideCandidateReview, getCandidateReview } =
  await import("@/lib/candidate-sql-review");

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AGENT_CANDIDATE_REVIEW_ENABLED","true");
  vi.stubEnv("AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED","true");
  mocks.progress.mockResolvedValue(null);
  mocks.auth.mockResolvedValue({session:{userId:reviewer,userProfile:"admin"},response:null});
  mocks.policy.mockResolvedValue({is_active:true,can_view_sql:true,can_execute_sql:true});
  mocks.tenant.mockReturnValue({status:"ready",organizationId:org});
});

describe("immutable SQL review ledger", () => {
  it("inserts run and review in one atomic tenant-membership-gated statement", async () => {
    mocks.query.mockResolvedValue({rowCount:1,rows:[{id:reviewId}]});
    const result = await persistCandidateReview(proposal);
    expect(result.id).toBe(reviewId);
    expect(result.sql_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [statement,params] = mocks.query.mock.calls[0];
    expect(statement).toContain("WITH membership AS");
    expect(statement).toContain("INSERT INTO public.ai_agent_runs");
    expect(statement).toContain("INSERT INTO public.ai_agent_candidate_sql_reviews");
    expect(statement).toContain("m.is_active IS TRUE AND o.is_active IS TRUE");
    expect(params).toContain(org);
    expect(params).toContain(requester);
    expect(params).toContain(proposal.sql);
  });
  it("does not return SQL if membership is not active or persistence fails",async()=>{
    mocks.query.mockResolvedValue({rowCount:0,rows:[]});
    await expect(persistCandidateReview(proposal)).rejects.toThrow("candidate_review_membership_unavailable");
  });
  it("uses CAS and separate reviewer with an exact original SQL/metadata binding",async()=>{
    mocks.query.mockResolvedValue({rowCount:1,rows:[{
      id:reviewId,review_status:"approved",binding_sha256:"b".repeat(64)
    }]});
    const result=await decideCandidateReview({
      id:reviewId,organizationId:org,actorId:reviewer,
      decision:"approved",expectedBindingSha256:"b".repeat(64)
    });
    expect(result?.status).toBe("approved");
    const [statement,params]=mocks.query.mock.calls[0];
    expect(statement).toContain("r.requested_by <> $3::uuid");
    expect(statement).toContain("r.review_status='pending'");
    expect(statement).toContain("q.sql_generated=r.sql_text");
    expect(statement).toContain("q.organization_id=r.organization_id");
    expect(statement).toContain("encode(digest(r.sql_text");
    expect(params).toEqual([reviewId,org,reviewer,"approved","b".repeat(64)]);
  });
  it("does not treat rejected, stale, or concurrently decided SQL as approved",async()=>{
    mocks.query.mockResolvedValue({rowCount:0,rows:[]});
    expect(await decideCandidateReview({
      id:reviewId,organizationId:org,actorId:reviewer,
      decision:"approved",expectedBindingSha256:"b".repeat(64)
    })).toBeNull();
  });
  it("reads only tenant-scoped persisted records",async()=>{
    mocks.query.mockResolvedValue({rowCount:1,rows:[{id:reviewId}]});
    await getCandidateReview({id:reviewId,organizationId:org,actorId:reviewer});
    expect(mocks.query.mock.calls[0][0]).toContain("r.organization_id=$2::uuid");
  });
});

function routeRequest(method:"GET"|"POST",body?:unknown) {
  return new Request("http://localhost/api/admin/candidate-reviews/"+reviewId,{
    method,headers:body?{"Content-Type":"application/json"}:{},
    ...(body?{body:JSON.stringify(body)}:{})
  });
}
const context={params:Promise.resolve({id:reviewId})};
describe("review route authorization and independent decision", () => {
  it("blocks non-admin and inactive policies before the database",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-reviews/[id]/route");
    mocks.auth.mockResolvedValueOnce({session:{userId:requester,userProfile:"comercial"},response:null});
    expect((await POST(routeRequest("POST",{decision:"approved",binding_sha256:"b".repeat(64)}),context)).status).toBe(403);
    mocks.policy.mockResolvedValueOnce({is_active:false,can_view_sql:true,can_execute_sql:true});
    expect((await POST(routeRequest("POST",{decision:"approved",binding_sha256:"b".repeat(64)}),context)).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("requires tenant selection and opt-in review gate",async()=>{
    const {GET}=await import("@/app/api/admin/candidate-reviews/[id]/route");
    mocks.tenant.mockReturnValueOnce({status:"required"});
    expect((await GET(routeRequest("GET"),context)).status).toBe(403);
    vi.stubEnv("AGENT_CANDIDATE_REVIEW_ENABLED","false");
    expect((await GET(routeRequest("GET"),context)).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("does not accept SQL, principal or tenant from reviewer request",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-reviews/[id]/route");
    expect((await POST(routeRequest("POST",{
      decision:"approved",binding_sha256:"b".repeat(64),sql:"SELECT 1"
    }),context)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("recovers only tenant-scoped persistent review progress",async()=>{
    const {GET}=await import("@/app/api/admin/candidate-reviews/[id]/route");
    mocks.query.mockResolvedValue({rowCount:1,rows:[{
      id:reviewId,agent_run_id:run,organization_id:org,requested_by:requester,
      sql_text:"synthetic sql",sql_sha256:"a".repeat(64),
      binding_sha256:"b".repeat(64),review_status:"approved"
    }]});
    mocks.progress.mockResolvedValue({
      request_id:"00000000-0000-4000-8000-000000000010",
      state:"pending_authorization",witness_status:"unavailable",
      requires_reapproval:false,preflight_status:null,langgraph_run_id:null
    });
    const res=await GET(routeRequest("GET"),context);
    expect(res.status).toBe(200);
    const data=await res.json();
    expect(data.progress.witness_status).toBe("unavailable");
    expect(mocks.progress).toHaveBeenCalledWith({
      reviewId,organizationId:org,actorId:reviewer
    });
    expect(JSON.stringify(data.progress)).not.toContain("synthetic sql");
    expect(mocks.query.mock.calls[0][1]).toContain(reviewer);
  });

  it("persists exact digest transition and returns no SQL/execution authorization",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-reviews/[id]/route");
    mocks.query.mockResolvedValue({rowCount:1,rows:[{
      id:reviewId,review_status:"approved",binding_sha256:"b".repeat(64)
    }]});
    const response=await POST(routeRequest("POST",{
      decision:"approved",binding_sha256:"b".repeat(64)
    }),context);
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body.execution_authorized).toBe(false);
    expect(body.real_sql_executed).toBe(false);
    expect(JSON.stringify(body)).not.toContain("sql_text");
  });
});
