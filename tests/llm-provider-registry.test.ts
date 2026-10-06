import { describe, expect, it } from "vitest";
import {
  getDefaultLlmSelection,
  getLlmRegistryEnvironment,
  getLlmRegistryVersion,
  listAvailableLlmModels,
  parseLlmSelection,
  resolveLlmSelection
} from "@/lib/llm-provider-registry";

describe("LLM provider registry", () => {
  it("exposes only models authorized for the requested target", () => {
    const models = listAvailableLlmModels({
      environment: getLlmRegistryEnvironment(),
      target: "official",
      profile: "admin"
    });

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.capabilities.includes("sql_generation"))).toBe(true);
    expect(models.some((model) => model.available_for_target)).toBe(true);
    const localModel = models.find((model) => model.model_key === "sql-infodive");
    expect(localModel).toBeDefined();
    expect(localModel?.available_for_target).toBe(false);
  });

  it("keeps runtime connection references out of the public model shape", () => {
    const models = listAvailableLlmModels({
      environment: getLlmRegistryEnvironment(),
      target: "official",
      profile: "admin"
    });

    expect(JSON.stringify(models)).not.toContain("credential_ref_env");
    expect(JSON.stringify(models)).not.toContain("base_url_ref_env");
  });

  it("uses a versioned configured default when the caller does not request a model", () => {
    const selection = getDefaultLlmSelection({
      environment: getLlmRegistryEnvironment(),
      target: "official",
      profile: "admin"
    });

    expect(selection).not.toBeNull();

    const resolved = resolveLlmSelection({
      environment: getLlmRegistryEnvironment(),
      target: "official",
      profile: "admin"
    });

    expect(resolved.source).toBe("default");
    expect(resolved.selection).toEqual(selection);
    expect(getLlmRegistryVersion()).toMatch(/^llm-registry-/);
  });

  it("rejects the local model on the official path", () => {
    expect(() =>
      resolveLlmSelection({
        environment: getLlmRegistryEnvironment(),
        target: "official",
        profile: "admin",
        requested: {
          provider_key: "infodive_local",
          model_key: "sql-infodive",
          config_version: "sql-infodive-demo-v1"
        }
      })
    ).toThrow("llm_model_not_available");
  });

  it("requires provider, model and config version in explicit selections", () => {
    expect(() =>
      parseLlmSelection({
        provider_key: "google_gemini",
        model_key: "gemini-2.5-flash"
      })
    ).toThrow("invalid_llm_selection");
  });
});
