import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentSession: vi.fn(),
  authenticateUser: vi.fn(),
  createSession: vi.fn(),
  getSessionByToken: vi.fn(),
  getRequestMetadata: vi.fn(),
  setSessionCookie: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
      cookies: { set: mocks.setSessionCookie }
    })
  }
}));
vi.mock("@/lib/server-auth", () => ({
  getAgentSession: mocks.getAgentSession,
  getRequestMetadata: mocks.getRequestMetadata,
  AGENT_SESSION_COOKIE: "synthetic-session-cookie",
  getAgentSessionCookieOptions: () => ({ httpOnly: true, path: "/", sameSite: "lax" })
}));
vi.mock("@/lib/auth/auth-service", () => ({
  authenticateUser: mocks.authenticateUser
}));
vi.mock("@/lib/auth/session-service", () => ({
  createSession: mocks.createSession,
  getSessionByToken: mocks.getSessionByToken
}));

const USER = "33333333-3333-4333-8333-333333333333";
const ORGANIZATION = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.createSession.mockResolvedValue({ rawToken: "synthetic-token", sessionId: "s1" });
  mocks.getRequestMetadata.mockResolvedValue({
    ipAddress: "127.0.0.1", userAgent: "offline-test"
  });
  mocks.authenticateUser.mockResolvedValue({
    ok: true, user: { id: USER, name: "Synthetic", email: "u@invalid.test",
      user_profile: "auditoria" }
  });
});

describe("session-to-browser tenant identity boundary", () => {
  it("keeps the old session API response shape when tenant mode is disabled", async () => {
    mocks.getAgentSession.mockResolvedValue({
      userId: USER, name: "Synthetic", email: "u@invalid.test",
      userProfile: "auditoria", organizationId: ORGANIZATION
    });
    const { GET } = await import("@/app/api/auth/session/route");
    const response = await GET();
    const body = await response.json();
    expect(body.user).toEqual({
      id: USER, name: "Synthetic", email: "u@invalid.test", profile: "auditoria"
    });
    expect(mocks.getSessionByToken).not.toHaveBeenCalled();
  });

  it("returns only a trusted active session organization when opt-in is on", async () => {
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    mocks.getAgentSession.mockResolvedValue({
      userId: USER, name: "Synthetic", email: "u@invalid.test",
      userProfile: "auditoria", organizationId: ORGANIZATION
    });
    const { GET } = await import("@/app/api/auth/session/route");
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).user).toMatchObject({
      id: USER, organizationId: ORGANIZATION, tenantIdentityEnabled: true
    });
  });

  it("does not assign a tenant when the persisted membership is unresolved", async () => {
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    mocks.getAgentSession.mockResolvedValue({
      userId: USER, name: "Synthetic", email: "u@invalid.test",
      userProfile: "auditoria"
    });
    const { GET } = await import("@/app/api/auth/session/route");
    const response = await GET();
    expect((await response.json()).user).toMatchObject({
      tenantIdentityEnabled: true, organizationId: null
    });
  });

  it("uses a freshly verified database session, never the login body, as tenant source", async () => {
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    mocks.getSessionByToken.mockResolvedValue({
      userId: USER, organizationId: ORGANIZATION
    });
    const { POST } = await import("@/app/api/auth/access/route");
    const response = await POST(new Request("http://localhost/api/auth/access", {
      method: "POST",
      body: JSON.stringify({
        email: "u@invalid.test", password: "synthetic-password",
        organizationId: "22222222-2222-4222-8222-222222222222"
      })
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({
      organizationId: ORGANIZATION,
      tenantIdentityEnabled: true
    });
    expect(mocks.getSessionByToken).toHaveBeenCalledWith("synthetic-token");
    expect(mocks.setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("fails closed without issuing a cookie when tenant session verification fails", async () => {
    vi.stubEnv("AGENT_TENANT_IDENTITY_ENABLED", "true");
    mocks.getSessionByToken.mockResolvedValue(null);
    const { POST } = await import("@/app/api/auth/access/route");
    const response = await POST(new Request("http://localhost/api/auth/access", {
      method: "POST",
      body: JSON.stringify({
        email: "u@invalid.test", password: "synthetic-password"
      })
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false, error: "tenant_session_unavailable"
    });
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it("does not query the membership source during a legacy login", async () => {
    const { POST } = await import("@/app/api/auth/access/route");
    const response = await POST(new Request("http://localhost/api/auth/access", {
      method: "POST",
      body: JSON.stringify({
        email: "u@invalid.test", password: "synthetic-password"
      })
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).user).not.toHaveProperty("organizationId");
    expect(mocks.getSessionByToken).not.toHaveBeenCalled();
  });
});
