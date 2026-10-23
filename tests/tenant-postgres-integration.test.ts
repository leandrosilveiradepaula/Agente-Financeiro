import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// This suite is skipped under regular npm test / Next build.
// It executes ONLY when the separately provisioned, single-use PostgreSQL CI
// service sets TENANT_DB_REHEARSAL=true. No network requests to real services.
const rehearsal = process.env.TENANT_DB_REHEARSAL === "true"
  ? describe.sequential
  : describe.skip;

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const RUN_A = "55555555-5555-4555-8555-555555555555";
const RUN_B = "66666666-6666-4666-8666-666666666666";
const LEGACY_RUN = "77777777-7777-4777-8777-777777777777";
const SESSION_A = "tenant-ci-session-alpha-synthetic";
const SESSION_B = "tenant-ci-session-beta-synthetic";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

rehearsal("real PostgreSQL tenant migration and application isolation", () => {
  let db: typeof import("@/lib/db")["db"];
  let sessionService: typeof import("@/lib/auth/session-service");
  let runsService: typeof import("@/lib/agent-runs");

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (
      process.env.CI !== "true" ||
      url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/tenant_ci_fixture" ||
      url.username !== "tenant_ci"
    ) {
      throw new Error("Tenant database rehearsal must use the isolated CI PostgreSQL service.");
    }

    ({ db } = await import("@/lib/db"));
    sessionService = await import("@/lib/auth/session-service");
    runsService = await import("@/lib/agent-runs");

    // The legacy run was inserted BEFORE the migration. No implicit tenant
    // attribution, default membership, or backfill is acceptable.
    const before = await db.query(
      "SELECT organization_id FROM public.ai_agent_runs WHERE id = $1::uuid",
      [LEGACY_RUN]
    );
    expect(before.rows).toEqual([{ organization_id: null }]);

    const orgCount = await db.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM public.ai_agent_organizations"
    );
    const memberships = await db.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM public.ai_agent_user_organizations"
    );
    expect(orgCount.rows[0].total).toBe("0");
    expect(memberships.rows[0].total).toBe("0");

    await db.query(
      `INSERT INTO public.ai_agent_organizations (id)
       VALUES ($1::uuid), ($2::uuid)`,
      [ORG_A, ORG_B]
    );
    await db.query(
      `INSERT INTO public.ai_agent_users (id, name, email, user_profile, password_hash)
       VALUES ($1::uuid, 'Synthetic Tenant B User', 'tenant-b@invalid.example',
              'auditoria', 'synthetic-fixture-not-a-password-hash')`,
      [USER_B]
    );
    await db.query(
      `INSERT INTO public.ai_agent_user_organizations
         (user_id, organization_id, is_active)
       VALUES ($1::uuid, $3::uuid, true),
              ($1::uuid, $4::uuid, true),
              ($2::uuid, $3::uuid, false),
              ($2::uuid, $4::uuid, true)`,
      [USER_A, USER_B, ORG_A, ORG_B]
    );
    await db.query(
      `INSERT INTO public.ai_agent_sessions
        (user_id, session_token_hash, expires_at)
       VALUES ($1::uuid, $3, now() + interval '1 day'),
              ($2::uuid, $4, now() + interval '1 day')`,
      [USER_A, USER_B, sha256(SESSION_A), sha256(SESSION_B)]
    );
    await db.query(
      `INSERT INTO public.ai_agent_runs
         (id, user_id, organization_id, pergunta, execution_status)
       VALUES ($1::uuid, $3::uuid, $5::uuid, 'Synthetic run A', 'generated'),
              ($2::uuid, $4::uuid, $6::uuid, 'Synthetic run B', 'generated')`,
      [RUN_A, RUN_B, USER_A, USER_B, ORG_A, ORG_B]
    );
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (db) await db.end();
  });

  it("requires explicit selection for a multi-membership session", async () => {
    const a = await sessionService.getSessionByToken(SESSION_A);
    const b = await sessionService.getSessionByToken(SESSION_B);
    expect(a?.userId).toBe(USER_A);
    expect(a?.organizationId).toBeUndefined();
    expect(b?.organizationId).toBe(ORG_B);
  });

  it("validates real membership before allowing session selection", async () => {
    expect(await sessionService.selectSessionOrganizationByToken(SESSION_A, ORG_A)).toBe(true);
    expect((await sessionService.getSessionByToken(SESSION_A))?.organizationId).toBe(ORG_A);

    // B is not an active member of A, despite a persisted inactive row.
    expect(await sessionService.selectSessionOrganizationByToken(SESSION_B, ORG_A)).toBe(false);
    expect((await sessionService.getSessionByToken(SESSION_B))?.organizationId).toBe(ORG_B);

    expect(await sessionService.selectSessionOrganizationByToken(SESSION_A, ORG_B)).toBe(true);
    expect((await sessionService.getSessionByToken(SESSION_A))?.organizationId).toBe(ORG_B);
  });

  it("never exposes a foreign tenant or historical unassigned run via scoped lookup", async () => {
    const runA = await runsService.getAgentRunById(RUN_A, ORG_A);
    const runB = await runsService.getAgentRunById(RUN_B, ORG_B);
    expect(runA?.id).toBe(RUN_A);
    expect(runB?.id).toBe(RUN_B);
    expect(await runsService.getAgentRunById(RUN_A, ORG_B)).toBeNull();
    expect(await runsService.getAgentRunById(RUN_B, ORG_A)).toBeNull();
    expect(await runsService.getAgentRunById(LEGACY_RUN, ORG_A)).toBeNull();
    expect(await runsService.getAgentRunById(LEGACY_RUN, ORG_B)).toBeNull();
    expect((await runsService.getAgentRunById(LEGACY_RUN))?.organization_id).toBeNull();
  });

  it("partitions actual run-list and count queries by organization", async () => {
    const a = await runsService.listAgentRuns({ organizationId: ORG_A, limit: 20, offset: 0 });
    const b = await runsService.listAgentRuns({ organizationId: ORG_B, limit: 20, offset: 0 });

    expect(a.total).toBe(1);
    expect(b.total).toBe(1);
    expect(a.runs.map((run) => run.id)).toEqual([RUN_A]);
    expect(b.runs.map((run) => run.id)).toEqual([RUN_B]);
    expect(a.runs.every((run) => run.organization_id === ORG_A)).toBe(true);
    expect(b.runs.every((run) => run.organization_id === ORG_B)).toBe(true);
  });

  it("rejects unregistered organizations and duplicate memberships at the DB boundary", async () => {
    await expect(
      db.query(
        "INSERT INTO public.ai_agent_user_organizations (user_id, organization_id) VALUES ($1::uuid, $2::uuid)",
        [USER_A, "88888888-8888-4888-8888-888888888888"]
      )
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.query(
        "INSERT INTO public.ai_agent_user_organizations (user_id, organization_id) VALUES ($1::uuid, $2::uuid)",
        [USER_A, ORG_A]
      )
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("persists separate Shadow delivery receipts atomically under the trusted tenant", async () => {
    // These receipts prove delivery only, not LangGraph generation, evidence
    // persistence, valid SQL or financial equivalence.
    await runsService.recordShadowDispatchReceipt({
      id: RUN_A, event: "generate", requestId: "synthetic-g1-request",
      status: "sent", httpStatus: 202, organizationId: ORG_A
    });
    await runsService.recordShadowDispatchReceipt({
      id: RUN_A, event: "execute_approved", requestId: "synthetic-g1-exec",
      status: "timeout", organizationId: ORG_A
    });
    const persisted = await db.query<{
      metadata: { shadow_dispatch: {
        generate: {status:string;http_status:number;request_id:string},
        execute_approved: {status:string;http_status:number|null}
      } }
    }>(
      "SELECT metadata FROM public.ai_agent_runs WHERE id = $1::uuid", [RUN_A]
    );
    const receipts = persisted.rows[0].metadata.shadow_dispatch;
    expect(receipts.generate).toMatchObject({
      status: "sent",http_status:202,request_id:"synthetic-g1-request"
    });
    expect(receipts.execute_approved).toMatchObject({
      status: "timeout",http_status:null
    });
    expect(receipts.generate).toHaveProperty("recorded_at");
    expect(JSON.stringify(receipts)).not.toContain("sql_generated");
    await expect(runsService.recordShadowDispatchReceipt({
      id: RUN_B,event: "generate", requestId: "synthetic-foreign",
      status: "sent",organizationId: ORG_A
    })).rejects.toThrow("shadow_dispatch_receipt_not_persisted");
    const foreign = await db.query<{metadata:Record<string,unknown>}>(
      "SELECT metadata FROM public.ai_agent_runs WHERE id = $1::uuid", [RUN_B]
    );
    expect(foreign.rows[0].metadata).not.toHaveProperty("shadow_dispatch");
  });

  it("preserves legacy session behavior when the feature is disabled", async () => {
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "false");
    const session = await sessionService.getSessionByToken(SESSION_A);
    expect(session?.userId).toBe(USER_A);
    expect(session?.organizationId).toBeUndefined();
  });
});
