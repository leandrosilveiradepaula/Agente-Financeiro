import { describe, expect, it } from "vitest";
import { isShadowPhaseOneProviderMatch } from "@/lib/shadow-phase-gate";

const official = {
  provider_key: "provider-a",
  model_key: "model-1",
  config_version: "v1"
};

describe("Shadow Phase 1 provider identity gate", () => {
  it("requires exact provider, model and version", () => {
    expect(isShadowPhaseOneProviderMatch(official, { ...official })).toBe(true);
    expect(isShadowPhaseOneProviderMatch(official, { ...official, provider_key: "provider-b" })).toBe(false);
    expect(isShadowPhaseOneProviderMatch(official, { ...official, model_key: "model-2" })).toBe(false);
    expect(isShadowPhaseOneProviderMatch(official, { ...official, config_version: "v2" })).toBe(false);
  });
  it("fails closed for empty and unknown identities", () => {
    expect(isShadowPhaseOneProviderMatch(null, official)).toBe(false);
    expect(isShadowPhaseOneProviderMatch(official, null)).toBe(false);
    expect(isShadowPhaseOneProviderMatch(official, { ...official, model_key: "" })).toBe(false);
  });
  it("supports unrelated provider naming without hardcoded aliases", () => {
    const other = { provider_key: "unrelated-provider", model_key: "model-q", config_version: "rev-x" };
    expect(isShadowPhaseOneProviderMatch(other, { ...other })).toBe(true);
  });
});
