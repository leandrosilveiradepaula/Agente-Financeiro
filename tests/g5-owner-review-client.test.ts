import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getG5ReviewStatus, getG5ReviewItem, submitG5ReviewDecision,
  isG5ReviewEnabled
} from "@/lib/g5-owner-review-client";

const TOKEN = "a".repeat(48);
const REV = "b".repeat(64);
const env: Record<string, string> = {
  G5_OWNER_REVIEW_ENABLED: "true",
  G5_OWNER_REVIEW_INTERNAL_TOKEN: TOKEN,
  G5_OWNER_REVIEW_TENANT_ID: "synthetic-tenant-a",
  G5_OWNER_REVIEW_ALLOWED_HOST: "review.test.internal",
  G5_OWNER_REVIEW_INTERNAL_URL: "https://review.test.internal/"
};
const admin = "operator-id-1";
const progress = {
  status: "unapproved", revision: REV,
  source_version_sha256: "1".repeat(64),
  p3_snapshot_sha256: "2".repeat(64),
  accounting_approved: false, context_activated: false, sql_executed: false,
  counts: { financial_total: 77, financial_classified: 0, physical_total: 48, physical_selected: 0 }
};
function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" }
  });
}

describe("G5 owner review BFF service client", () => {
  it("never contacts server with feature flag off or incomplete private config", async () => {
    const fetchImpl = vi.fn();
    expect(isG5ReviewEnabled({})).toBe(false);
    expect((await getG5ReviewStatus(admin, {
      env: { ...env, G5_OWNER_REVIEW_ENABLED: "false" }, fetchImpl
    })).status).toBe("disabled");
    expect((await getG5ReviewStatus(admin, {
      env: { ...env, G5_OWNER_REVIEW_INTERNAL_TOKEN: "short" }, fetchImpl
    })).status).toBe("disabled");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pins TLS, fixed host, admin role, tenant and actor from Product", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, progress));
    const result = await getG5ReviewStatus(admin, { env, fetchImpl });
    expect(result.status).toBe("ok");
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://review.test.internal/v1/internal/g5-owner-review/status");
    expect(options.method).toBe("GET");
    expect(options.cache).toBe("no-store");
    expect(options.redirect).toBe("error");
    expect(options.headers.Authorization).toBe("Bearer " + TOKEN);
    expect(options.headers["x-g5-product-role"]).toBe("admin");
    expect(options.headers["x-g5-product-tenant"]).toBe("synthetic-tenant-a");
    expect(options.headers["x-g5-product-actor"]).toBe(admin);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("rejects destination injection or non TLS endpoints", async () => {
    const fetchImpl = vi.fn();
    for (const url of [
      "http://review.test.internal/",
      "https://review.test.internal.evil.example/",
      "https://review.test.internal/private/",
      "https://user:pass@review.test.internal/"
    ]) {
      const r = await getG5ReviewStatus(admin, {
        env: { ...env, G5_OWNER_REVIEW_INTERNAL_URL: url }, fetchImpl
      });
      expect(r.status).toBe("disabled");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads one permitted item without exposing the private bearer in result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {
      status: "unapproved", kind: "financial", index: 0,
      source: { rule_content: "synthetic-only-review-text" },
      decision: { classification: "UNRESOLVED", destinations: [] },
      revision: REV, accounting_approved: false
    }));
    const result = await getG5ReviewItem(admin, { kind: "financial", index: 0 }, {
      env, fetchImpl
    });
    expect(result.status).toBe("ok");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://review.test.internal/v1/internal/g5-owner-review/item?kind=financial&index=0"
    );
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("sends explicit decisions only and keeps approval false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {
      status: "draft_saved", revision: "c".repeat(64),
      counts: { session_actions: 1 },
      accounting_approved: false, context_activated: false, sql_executed: false
    }));
    const payload = {
      kind: "physical" as const, index: 3, expected_revision: REV,
      decision: {
        qualified_table: "schema_new.table_new",
        target_column: "value",
        review_rationale: "The owner independently attested the change."
      }
    };
    const result = await submitG5ReviewDecision(admin, payload, { env, fetchImpl });
    expect(result.status).toBe("ok");
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("/v1/internal/g5-owner-review/decision");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body).decision).toEqual(payload.decision);
    expect(JSON.parse(options.body)).not.toHaveProperty("accounting_approved");
  });

  it("fails closed on unapproved or malformed provider responses", async () => {
    const failApproved = vi.fn().mockResolvedValue(response(200, {
      ...progress, accounting_approved: true
    }));
    expect((await getG5ReviewStatus(admin, { env, fetchImpl: failApproved })).status)
      .toBe("invalid_response");
    const badJson = vi.fn().mockResolvedValue(new Response("{broken", { status: 200 }));
    expect((await getG5ReviewStatus(admin, { env, fetchImpl: badJson })).status)
      .toBe("unavailable");
    const forbidden = vi.fn().mockResolvedValue(response(403, { secret: "private" }));
    expect((await getG5ReviewStatus(admin, { env, fetchImpl: forbidden })).status)
      .toBe("rejected");
  });

  it("rejects out-of-range selectors without contacting the backend", async () => {
    const fetchImpl = vi.fn();
    expect((await getG5ReviewItem(admin, {
      kind: "physical", index: Number.MAX_SAFE_INTEGER
    }, { env, fetchImpl })).status).toBe("rejected");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
