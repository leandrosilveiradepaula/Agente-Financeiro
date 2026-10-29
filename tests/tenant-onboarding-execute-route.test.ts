import { beforeEach,describe,expect,it,vi } from "vitest";

const mocks=vi.hoisted(()=>({
  requireAdmin:vi.fn(),policy:vi.fn(),tenant:vi.fn(),
  isTenantEnabled:vi.fn(),bootstrap:vi.fn(),list:vi.fn(),add:vi.fn(),
  requestIntent:vi.fn()
}));
vi.mock("server-only",()=>({}));
vi.mock("next/server",()=>({
  NextResponse:{json:(body:unknown,init?:{status?:number})=>({
    status:init?.status??200,json:async()=>body
  })}
}));
vi.mock("@/lib/server-auth",()=>({requireAdminSession:mocks.requireAdmin}));
vi.mock("@/lib/profile-policy",()=>({getProfilePolicy:mocks.policy}));
vi.mock("@/lib/tenant-identity",()=>({
  getSessionTenantIdentity:mocks.tenant,
  isTenantIdentityEnabled:mocks.isTenantEnabled
}));
vi.mock("@/lib/tenant-operator",()=>({
  validTenantDisplayName:(s:unknown)=>typeof s==="string"&&s.length>=3,
  bootstrapInitialTenant:mocks.bootstrap,
  listTenantMembers:mocks.list,
  addTenantMember:mocks.add
}));
vi.mock("@/lib/candidate-execution-intent",()=>({
  requestExecuteApprovedIntent:mocks.requestIntent
}));
const ACTOR="11111111-1111-4111-8111-111111111111";
const ORG="22222222-2222-4222-8222-222222222222";
const MEMBER="33333333-3333-4333-8333-333333333333";
const REVIEW="44444444-4444-4444-8444-444444444444";
const session={userId:ACTOR,sessionId:"55555555-5555-4555-8555-555555555555",userProfile:"admin"};
const post=(path:string,body:unknown)=>new Request("http://localhost"+path,{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify(body)
});

beforeEach(()=>{
  vi.resetAllMocks();
  vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED","true");
  vi.stubEnv("AGENT_TENANT_INITIAL_BOOTSTRAP_ENABLED","true");
  vi.stubEnv("AGENT_TENANT_BOOTSTRAP_ACTOR_ID",ACTOR);
  vi.stubEnv("AGENT_TENANT_MEMBERSHIP_ADMIN_ENABLED","true");
  vi.stubEnv("AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED","true");
  vi.stubEnv("AGENT_CANDIDATE_REVIEW_ENABLED","true");
  vi.stubEnv("AGENT_CANDIDATE_AUTHORIZED_ORGANIZATION_ID",ORG);
  vi.stubEnv("LANGGRAPH_OFFICIAL_VIA_N8N","false");
  mocks.requireAdmin.mockResolvedValue({session,response:null});
  mocks.policy.mockResolvedValue({
    is_active:true,can_manage_users:true,can_view_sql:true,can_execute_sql:true
  });
  mocks.isTenantEnabled.mockReturnValue(true);
  mocks.tenant.mockReturnValue({status:"ready",organizationId:ORG});
  mocks.bootstrap.mockResolvedValue({organization_id:ORG});
  mocks.list.mockResolvedValue([{user_id:ACTOR,name:"Admin",user_profile:"admin",is_active:true}]);
  mocks.add.mockResolvedValue({user_id:MEMBER});
  mocks.requestIntent.mockResolvedValue({
    request_id:"66666666-6666-4666-8666-666666666666",
    review_id:REVIEW,state:"pending_authorization",
    real_sql_executed:false,execution_authorized:false
  });
});

describe("explicit tenant onboarding and Execute Approved API controls",()=>{
  it("bootstraps only with an operator-pinned identity and explicit name/confirmation",async()=>{
    const {POST}=await import("@/app/api/admin/tenant/bootstrap/route");
    const body={display_name:"Operator-created organization",confirm:"CREATE-INITIAL-ORGANIZATION"};
    vi.stubEnv("AGENT_TENANT_BOOTSTRAP_ACTOR_ID",MEMBER);
    expect((await POST(post("/api/admin/tenant/bootstrap",body))).status).toBe(403);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    vi.stubEnv("AGENT_TENANT_BOOTSTRAP_ACTOR_ID",ACTOR);
    expect((await POST(post("/api/admin/tenant/bootstrap",{...body,organization_id:ORG}))).status).toBe(400);
    const reply=await POST(post("/api/admin/tenant/bootstrap",body));
    expect(reply.status).toBe(201);
    expect(await reply.json()).toMatchObject({
      success:true,organization_id:ORG,financial_datasource_configured:false
    });
    expect(mocks.bootstrap).toHaveBeenCalledWith({
      actorId:ACTOR,sessionId:session.sessionId,
      displayName:"Operator-created organization"
    });
  });

  it("does not assign a member to a client-supplied tenant",async()=>{
    const {POST,GET}=await import("@/app/api/admin/tenant/members/route");
    expect((await POST(post("/api/admin/tenant/members",{
      user_id:MEMBER,organization_id:"attacker"
    }))).status).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
    const res=await POST(post("/api/admin/tenant/members",{user_id:MEMBER}));
    expect(res.status).toBe(201);
    expect(mocks.add).toHaveBeenCalledWith({
      organizationId:ORG,actorId:ACTOR,memberId:MEMBER
    });
    const listed=await GET();
    expect(listed.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({organizationId:ORG,actorId:ACTOR});
  });

  it("denies unselected tenants and profiles without manage-users",async()=>{
    const {GET}=await import("@/app/api/admin/tenant/members/route");
    mocks.policy.mockResolvedValueOnce({is_active:true,can_manage_users:false});
    expect((await GET()).status).toBe(403);
    mocks.tenant.mockReturnValueOnce({status:"required"});
    expect((await GET()).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("creates a separate non-executable request only for scoped approved review",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-reviews/[id]/execute-request/route");
    const ctx={params:Promise.resolve({id:REVIEW})};
    const binding="b".repeat(64);
    const res=await POST(post("/api/admin/candidate-reviews/"+REVIEW+"/execute-request",{
      binding_sha256:binding
    }),ctx);
    expect(res.status).toBe(202);
    const json=await res.json();
    expect(json).toMatchObject({
      state:"pending_authorization",real_sql_executed:false,
      execution_authorized:false
    });
    expect(JSON.stringify(json)).not.toContain("SELECT");
    expect(mocks.requestIntent).toHaveBeenCalledWith({
      reviewId:REVIEW,actorId:ACTOR,organizationId:ORG,
      expectedBindingSha256:binding
    });
  });

  it("rejects wrong tenant, disabled gate and request-supplied SQL",async()=>{
    const {POST}=await import("@/app/api/admin/candidate-reviews/[id]/execute-request/route");
    const ctx={params:Promise.resolve({id:REVIEW})};
    mocks.tenant.mockReturnValueOnce({status:"ready",organizationId:MEMBER});
    expect((await POST(post("/api/request",{binding_sha256:"b".repeat(64)}),ctx)).status).toBe(403);
    vi.stubEnv("AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED","false");
    expect((await POST(post("/api/request",{binding_sha256:"b".repeat(64)}),ctx)).status).toBe(404);
    vi.stubEnv("AGENT_CANDIDATE_EXECUTION_REQUEST_ENABLED","true");
    expect((await POST(post("/api/request",{
      binding_sha256:"b".repeat(64),sql:"SELECT *"
    }),ctx)).status).toBe(400);
    expect(mocks.requestIntent).not.toHaveBeenCalled();
  });
});
