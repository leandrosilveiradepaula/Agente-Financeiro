import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  status: vi.fn(),
  item: vi.fn(),
  submit: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
      json: async () => body
    })
  }
}));
vi.mock("@/lib/server-auth", () => ({
  requireAdminSession: mocks.requireAdminSession
}));
vi.mock("@/lib/g5-owner-review-client", () => ({
  isG5ReviewEnabled: () => process.env.G5_OWNER_REVIEW_ENABLED === "true",
  getG5ReviewStatus: mocks.status,
  getG5ReviewItem: mocks.item,
  submitG5ReviewDecision: mocks.submit
}));

const actor = { userId: "operator-1", userProfile: "admin" };
const progress = {
  status: "unapproved", revision: "a".repeat(64), accounting_approved: false,
  counts: { financial_total: 77, financial_classified: 0,
    physical_total: 48, physical_selected: 0 }
};
const validDecision = {
  kind: "financial", index: 0, expected_revision: "a".repeat(64),
  decision: { classification: "STRUCTURAL", destinations: [] }
};

function requestPost(body: unknown, headers?: Record<string, string>): Request {
  return new Request("https://app.test.local/api/admin/g5-review", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://app.test.local",
      "Sec-Fetch-Site": "same-origin",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.resetModules();
  mocks.requireAdminSession.mockReset();
  mocks.status.mockReset();
  mocks.item.mockReset();
  mocks.submit.mockReset();
  mocks.requireAdminSession.mockResolvedValue({ session: actor, response: null });
  mocks.status.mockResolvedValue({ status: "ok", data: progress });
  mocks.item.mockResolvedValue({ status: "ok", data: {
    status: "unapproved", kind: "financial", index: 0,
    source: { rule_content: "synthetic only" },
    decision: { classification: "UNRESOLVED", destinations: [] },
    revision: "a".repeat(64), accounting_approved: false
  }});
  mocks.submit.mockResolvedValue({ status: "ok", data: {
    status: "draft_saved", revision: "b".repeat(64),
    accounting_approved: false, context_activated: false, sql_executed: false
  }});
  vi.stubEnv("G5_OWNER_REVIEW_ENABLED", "true");
  vi.stubEnv("G5_OWNER_REVIEW_WEB_ORIGIN", "https://app.test.local");
});

describe("admin G5 owner review Next.js route", () => {
  it("requires a real admin session before any private source lookup", async () => {
    mocks.requireAdminSession.mockResolvedValue({
      session: null,
      response: { status: 401, json: async () => ({ success: false }) }
    });
    const { GET, POST } = await import("@/app/api/admin/g5-review/route");
    expect((await GET(new Request("https://app.test.local/api/admin/g5-review"))).status)
      .toBe(401);
    expect((await POST(requestPost(validDecision))).status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("stays unavailable by default, even for logged-in admin", async () => {
    vi.stubEnv("G5_OWNER_REVIEW_ENABLED", "false");
    const { GET } = await import("@/app/api/admin/g5-review/route");
    const response = await GET(new Request("https://app.test.local/api/admin/g5-review"));
    expect(response.status).toBe(503);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("reads sanitized status and protected item for the session actor", async () => {
    const { GET } = await import("@/app/api/admin/g5-review/route");
    const status = await GET(new Request("https://app.test.local/api/admin/g5-review"));
    expect(status.status).toBe(200);
    expect(mocks.status).toHaveBeenCalledWith("operator-1");
    expect(status.headers["Cache-Control"]).toContain("no-store");
    const item = await GET(new Request(
      "https://app.test.local/api/admin/g5-review?kind=financial&index=0"
    ));
    expect(item.status).toBe(200);
    expect(mocks.item).toHaveBeenCalledWith("operator-1", {
      kind: "financial", index: 0
    });
  });

  it("rejects duplicate and arbitrary query parameters without backend call", async () => {
    const { GET } = await import("@/app/api/admin/g5-review/route");
    for (const query of [
      "?kind=financial&kind=physical&index=0",
      "?kind=physical&index=0&file=/root",
      "?kind=physical&index=-1",
      "?kind=financial&index=0&index=1"
    ]) {
      const resp = await GET(new Request(
        "https://app.test.local/api/admin/g5-review" + query
      ));
      expect(resp.status).toBe(400);
    }
    expect(mocks.item).not.toHaveBeenCalled();
  });

  it("requires exact Origin and rejects cross-site writes", async () => {
    const { POST } = await import("@/app/api/admin/g5-review/route");
    for (const headers of [
      { Origin: "https://evil.example" },
      { "Sec-Fetch-Site": "cross-site" },
      { Origin: "" }
    ]) {
      const resp = await POST(requestPost(validDecision, headers));
      expect(resp.status).toBe(403);
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("only submits explicit draft decisions and never flags approval", async () => {
    const { POST } = await import("@/app/api/admin/g5-review/route");
    const resp = await POST(requestPost(validDecision));
    expect(resp.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith("operator-1", validDecision);
    expect(resp.headers["Cache-Control"]).toContain("no-store");
    expect(await resp.json()).toEqual({
      success: true,
      review: expect.objectContaining({ status: "draft_saved", accounting_approved: false })
    });
  });

  it("blocks missing revision, forged approval, or unknown fields", async () => {
    const { POST } = await import("@/app/api/admin/g5-review/route");
    for (const value of [
      { ...validDecision, expected_revision: "bad" },
      { ...validDecision, accounting_approved: true },
      { ...validDecision, decision: { classification: "APPROVED", destinations: [] } },
      { ...validDecision, decision: { classification: "STRUCTURAL", destinations: [],
        sql_executed: true } }
    ]) {
      const resp = await POST(requestPost(value));
      expect(resp.status).toBe(400);
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("reports a stale revision as conflict without leaking source", async () => {
    mocks.submit.mockResolvedValue({ status: "rejected" });
    const { POST } = await import("@/app/api/admin/g5-review/route");
    const resp = await POST(requestPost(validDecision));
    expect(resp.status).toBe(409);
    expect(await resp.json()).toEqual({
      success: false, error: "review_conflict"
    });
  });
});
