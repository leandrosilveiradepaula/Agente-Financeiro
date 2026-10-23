import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  requireAgentSession:vi.fn(),
  getProfilePolicy:vi.fn(),
  inspectTenantSchemaReadiness:vi.fn()
}));
vi.mock("@/lib/server-auth",()=>({requireAgentSession:mocks.requireAgentSession}));
vi.mock("@/lib/profile-policy",()=>({getProfilePolicy:mocks.getProfilePolicy}));
vi.mock("@/lib/tenant-schema-readiness",()=>({
  inspectTenantSchemaReadiness:mocks.inspectTenantSchemaReadiness
}));

describe("operator-only tenant schema readiness route",()=>{
  beforeEach(()=>{
    vi.resetModules();
    mocks.requireAgentSession.mockReset();
    mocks.getProfilePolicy.mockReset();
    mocks.inspectTenantSchemaReadiness.mockReset();
    mocks.requireAgentSession.mockResolvedValue({
      session:{userId:"operator",userProfile:"admin"},response:null
    });
    mocks.getProfilePolicy.mockResolvedValue({can_manage_users:true});
    mocks.inspectTenantSchemaReadiness.mockResolvedValue({
      status:"migration_pending",blockers:["tenant_migration_not_applied"],
      records_read:false,activation_authorized:false
    });
  });

  it("allows only authorized operators and forbids caching",async()=>{
    const {GET}=await import("@/app/api/admin/tenant-schema-readiness/route");
    const response=await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      success:true,tenant_schema:{status:"migration_pending",activation_authorized:false}
    });
    expect(mocks.inspectTenantSchemaReadiness).toHaveBeenCalledTimes(1);
  });
  it("does not inspect schema for an unauthenticated caller",async()=>{
    mocks.requireAgentSession.mockResolvedValue({
      session:null,response:new Response(null,{status:401})
    });
    const {GET}=await import("@/app/api/admin/tenant-schema-readiness/route");
    expect((await GET()).status).toBe(401);
    expect(mocks.getProfilePolicy).not.toHaveBeenCalled();
    expect(mocks.inspectTenantSchemaReadiness).not.toHaveBeenCalled();
  });
  it("does not inspect schema for unauthorized audit-only profiles",async()=>{
    mocks.getProfilePolicy.mockResolvedValue({can_manage_users:false,can_view_all_runs:true});
    const {GET}=await import("@/app/api/admin/tenant-schema-readiness/route");
    expect((await GET()).status).toBe(403);
    expect(mocks.inspectTenantSchemaReadiness).not.toHaveBeenCalled();
  });
  it("fails closed if the profile policy is not found",async()=>{
    mocks.getProfilePolicy.mockResolvedValue(null);
    const {GET}=await import("@/app/api/admin/tenant-schema-readiness/route");
    expect((await GET()).status).toBe(403);
    expect(mocks.inspectTenantSchemaReadiness).not.toHaveBeenCalled();
  });
});
