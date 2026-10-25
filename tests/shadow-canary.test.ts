import { describe, expect, it, vi } from "vitest";
import {
  dispatchLangGraphGenerateShadow,
  inspectLangGraphShadowCanaryConfiguration,
  inspectLangGraphShadowDispatchConfiguration,
  isLangGraphShadowCanaryEligible
} from "@/lib/langgraph-shadow-client";

const subjectA = "11111111-1111-4111-8111-111111111111";
const subjectB = "22222222-2222-4222-8222-222222222222";
const organizationA = "33333333-3333-4333-8333-333333333333";
const organizationB = "44444444-4444-4444-8444-444444444444";
const future = "2099-01-01T00:00:00Z";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    LANGGRAPH_SHADOW_ENABLED: "true",
    LANGGRAPH_INTERNAL_BASE_URL: "http://127.0.0.1:8000",
    LANGGRAPH_S2S_TOKEN: "synthetic-secret",
    LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON: JSON.stringify([
      { user_id: subjectA, organization_id: organizationA }
    ]),
    LANGGRAPH_SHADOW_CANARY_EXPIRES_AT: future,
    ...overrides
  };
}

const principalA = { id: subjectA, email: "a@example.test", profile: "audit", organization_id: organizationA };

describe("Shadow canary", () => {
  it("fails closed for absent, malformed, invalid and expired policies without fetching", async () => {
    for (const candidate of [
      env({ LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON: undefined }),
      env({ LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON: "not-json" }),
      env({ LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON: '[{"user_id":"not-an-id"}]' }),
      env({ LANGGRAPH_SHADOW_CANARY_EXPIRES_AT: "not-a-time" }),
      env({ LANGGRAPH_SHADOW_CANARY_EXPIRES_AT: "2000-01-01T00:00:00Z" })
    ]) {
      const fetchImpl = vi.fn();
      const result = await dispatchLangGraphGenerateShadow({
        agentRunId: "55555555-5555-4555-8555-555555555555", question: "ignored",
        principal: principalA, requestId: "request"
      }, { env: candidate, fetchImpl });
      expect(result.status).toBe("configuration_error");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("allows only the exact persisted subject and organization", async () => {
    expect(isLangGraphShadowCanaryEligible(principalA, env()).allowed).toBe(true);
    expect(isLangGraphShadowCanaryEligible({ ...principalA, id: subjectB }, env()).allowed).toBe(false);
    expect(isLangGraphShadowCanaryEligible({ ...principalA, organization_id: organizationB }, env()).allowed).toBe(false);
  });

  it("uses an injected clock to expire a policy and does not expose subjects in diagnostics", () => {
    const now = () => new Date("2100-01-01T00:00:00Z");
    expect(inspectLangGraphShadowCanaryConfiguration(env(), now)).toEqual({ status: "expired" });
    const diagnostics = inspectLangGraphShadowDispatchConfiguration(env({
      LANGGRAPH_SHADOW_CANARY_SUBJECTS_JSON: "not-json"
    }));
    expect(diagnostics).toMatchObject({ canary_status: "invalid", canary_ready: false });
    expect(JSON.stringify(diagnostics)).not.toContain(subjectA);
    expect(JSON.stringify(diagnostics)).not.toContain("synthetic-secret");
  });

  it("still blocks all dispatch when the global feature flag is false", async () => {
    const fetchImpl = vi.fn();
    const result = await dispatchLangGraphGenerateShadow({
      agentRunId: "55555555-5555-4555-8555-555555555555", question: "ignored",
      principal: principalA, requestId: "request"
    }, { env: env({ LANGGRAPH_SHADOW_ENABLED: "false" }), fetchImpl });
    expect(result).toEqual({ status: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
