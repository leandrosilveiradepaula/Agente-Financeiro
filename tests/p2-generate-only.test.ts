import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@/lib/auth/auth-types";

const mocks = vi.hoisted(() => ({
  createAgentRun: vi.fn(),
  recordShadowDispatchReceipt: vi.fn(),
  buildPrincipal: vi.fn(),
  isCanaryEligible: vi.fn(),
  dispatchGenerateOnly: vi.fn(),
  enforceCanGenerateSql: vi.fn(),
  getRequestMetadata: vi.fn(),
  getSessionTenantIdentity: vi.fn()
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body
    })
  }
}));
vi.mock("@/lib/agent-runs", () => ({
  createAgentRun: mocks.createAgentRun,
  recordShadowDispatchReceipt: mocks.recordShadowDispatchReceipt
}));
vi.mock("@/lib/langgraph-shadow-client", () => ({
  buildLangGraphShadowPrincipal: mocks.buildPrincipal,
  isLangGraphShadowCanaryEligible: mocks.isCanaryEligible,
  dispatchLangGraphP2GenerateOnly: mocks.dispatchGenerateOnly
}));
vi.mock("@/lib/profile-policy", () => ({
  enforceCanGenerateSql: mocks.enforceCanGenerateSql
}));
vi.mock("@/lib/server-auth", () => ({
  getRequestMetadata: mocks.getRequestMetadata
}));
vi.mock("@/lib/tenant-identity", () => ({
  getSessionTenantIdentity: mocks.getSessionTenantIdentity
}));

import { handleP2GenerateOnly } from "@/lib/p2-generate-only";

const session: AgentSession = {
  sessionId: "session-id",
  userId: "11111111-1111-4111-8111-111111111111",
  name: "Authorized Operator",
  email: "operator@example.test",
  userProfile: "admin"
};
const runId = "22222222-2222-4222-8222-222222222222";
const question = "Qual foi o montante financeiro realizado no período informado?";

function request(payload: unknown) {
  return new Request("http://localhost/api/generate-sql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-P2-Generate-Only": "true"
    },
    body: JSON.stringify(payload)
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("LANGGRAPH_P2_GENERATE_ONLY_ENABLED", "true");
  vi.stubEnv("LANGGRAPH_SHADOW_TRANSPORT", "n8n");
  vi.stubEnv("LANGGRAPH_OFFICIAL_VIA_N8N", "false");
  vi.stubEnv("AGENT_INTERFACE_MODE", "demo");
  mocks.getSessionTenantIdentity.mockReturnValue({ status: "disabled" });
  mocks.buildPrincipal.mockReturnValue({
    id: session.userId,
    email: session.email,
    profile: session.userProfile
  });
  mocks.isCanaryEligible.mockReturnValue({ status: "ready", allowed: true });
  mocks.enforceCanGenerateSql.mockResolvedValue({ allowed: true, policy: {}, reason: null });
  mocks.getRequestMetadata.mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "vitest" });
  mocks.createAgentRun.mockResolvedValue({ id: runId });
  mocks.recordShadowDispatchReceipt.mockResolvedValue(undefined);
  mocks.dispatchGenerateOnly.mockResolvedValue({ status: "sent", httpStatus: 202 });
});

describe("P2 isolated authenticated generation-only canary", () => {
  it("does not touch the database or n8n when explicitly disabled", async () => {
    vi.stubEnv("LANGGRAPH_P2_GENERATE_ONLY_ENABLED", "false");
    const r = await handleP2GenerateOnly(request({ pergunta: question }), session, "request-id");
    expect(r.status).toBe(404);
    expect(mocks.enforceCanGenerateSql).not.toHaveBeenCalled();
    expect(mocks.createAgentRun).not.toHaveBeenCalled();
    expect(mocks.dispatchGenerateOnly).not.toHaveBeenCalled();
  });

  it("requires an administrator, n8n transport and a valid subject canary", async () => {
    const nonAdmin = { ...session, userProfile: "comercial" };
    expect((await handleP2GenerateOnly(request({ pergunta: question }), nonAdmin, "req")).status).toBe(403);
    vi.stubEnv("LANGGRAPH_SHADOW_TRANSPORT", "direct");
    expect((await handleP2GenerateOnly(request({ pergunta: question }), session, "req")).status).toBe(503);
    vi.stubEnv("LANGGRAPH_SHADOW_TRANSPORT", "n8n");
    mocks.isCanaryEligible.mockReturnValue({ status: "expired", allowed: false });
    expect((await handleP2GenerateOnly(request({ pergunta: question }), session, "req")).status).toBe(403);
    expect(mocks.createAgentRun).not.toHaveBeenCalled();
    expect(mocks.dispatchGenerateOnly).not.toHaveBeenCalled();
  });

  it("requires explicit tenant binding for an organization-scoped session", async () => {
    mocks.getSessionTenantIdentity.mockReturnValue({
      status: "ready",
      organizationId: "33333333-3333-4333-8333-333333333333"
    });
    expect((await handleP2GenerateOnly(request({ pergunta: question }), session, "req")).status).toBe(503);
    vi.stubEnv("LANGGRAPH_P2_AUTHORIZED_ORGANIZATION_ID", "44444444-4444-4444-8444-444444444444");
    expect((await handleP2GenerateOnly(request({ pergunta: question }), session, "req")).status).toBe(503);
    expect(mocks.dispatchGenerateOnly).not.toHaveBeenCalled();
  });

  it("blocks unscoped non-Demo environments and denied generate policies", async () => {
    vi.stubEnv("AGENT_INTERFACE_MODE", "production");
    expect((await handleP2GenerateOnly(request({ pergunta: question }), session, "req")).status).toBe(503);
    vi.stubEnv("AGENT_INTERFACE_MODE", "demo");
    mocks.enforceCanGenerateSql.mockResolvedValue({ allowed: false, reason: "denied" });
    expect((await handleP2GenerateOnly(request({ pergunta: question }), session, "req")).status).toBe(403);
    expect(mocks.createAgentRun).not.toHaveBeenCalled();
  });

  it("rejects approved SQL or caller-selected options in a generation-only payload", async () => {
    const response = await handleP2GenerateOnly(
      request({ pergunta: question, approved_sql: "SELECT 1" }),
      session, "req"
    );
    expect(response.status).toBe(400);
    expect(mocks.createAgentRun).not.toHaveBeenCalled();
    expect(mocks.dispatchGenerateOnly).not.toHaveBeenCalled();
  });

  it("persists the Product run, dispatches only generate, and returns an async receipt", async () => {
    const r = await handleP2GenerateOnly(request({ pergunta: question }), session, "request-id");
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({
      success: true,
      accepted: true,
      agent_run_id: runId,
      request_id: "request-id",
      shadow_status: "sent",
      sql_generation_status: "pending",
      real_sql_execution: false
    });
    expect(mocks.createAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      pergunta: question,
      source: "shadow_p2_generate_only",
      requestId: "request-id",
      session
    }));
    expect(mocks.dispatchGenerateOnly).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchGenerateOnly).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: runId,
      question,
      requestId: "request-id"
    }));
    expect(mocks.recordShadowDispatchReceipt).toHaveBeenCalledWith(expect.objectContaining({
      id: runId,
      event: "generate",
      status: "sent",
      httpStatus: 202
    }));
    expect(JSON.stringify(await r.json())).not.toContain(question);
  });

  it("reports an uncertain dispatch receipt with the persisted ID, without retries", async () => {
    mocks.recordShadowDispatchReceipt.mockRejectedValue(new Error("database unavailable"));
    const r = await handleP2GenerateOnly(request({ pergunta: question }), session, "req");
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({
      error: "p2_receipt_persistence_unavailable",
      agent_run_id: runId
    });
    expect(mocks.dispatchGenerateOnly).toHaveBeenCalledTimes(1);
  });

  it("does not report P2 as complete merely because n8n acknowledged a request", async () => {
    const r = await handleP2GenerateOnly(request({ pergunta: question }), session, "req");
    expect((await r.json()).sql_generation_status).toBe("pending");
  });

  it("intercepts generate-only BEFORE reading official n8n credentials or triggering financial SQL", () => {
    const code = readFileSync(join(process.cwd(), "app/api/generate-sql/route.ts"), "utf8");
    const branch = code.indexOf('request.headers.get("x-agent-p2-generate-only")');
    const official = code.indexOf("const internalWebhookToken = process.env.N8N_INTERNAL_WEBHOOK_TOKEN");
    expect(branch).toBeGreaterThan(0);
    expect(official).toBeGreaterThan(branch);
    expect(code).toContain("return handleP2GenerateOnly(request, session, requestId)");
  });
});
