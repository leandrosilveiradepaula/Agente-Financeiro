import { describe, expect, it } from "vitest";
import {
  calculateEstimatedLlmCostUsd,
  calculateEstimatedSavingsUsd,
  extractLlmUsageFromResponse
} from "@/lib/llm-usage";

describe("llm usage normalization", () => {
  it("extracts Gemini usageMetadata", () => {
    const usage = extractLlmUsageFromResponse({
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 45,
        totalTokenCount: 165
      },
      model: "gemini-2.0-flash"
    });

    expect(usage).toMatchObject({
      model: "gemini-2.0-flash",
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
      source: "response"
    });
  });

  it("extracts OpenAI-like usage", () => {
    const usage = extractLlmUsageFromResponse({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 250,
        total_tokens: 1250
      },
      provider: "openai",
      model: "gpt-test"
    });

    expect(usage).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      promptTokens: 1000,
      completionTokens: 250,
      totalTokens: 1250
    });
  });

  it("calculates total tokens when total is absent", () => {
    const usage = extractLlmUsageFromResponse({
      llm_usage: {
        prompt_tokens: 10,
        completion_tokens: 15
      }
    });

    expect(usage.totalTokens).toBe(25);
  });

  it("returns null fields when usage is absent", () => {
    const usage = extractLlmUsageFromResponse({ success: true });

    expect(usage).toEqual({
      provider: null,
      model: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      source: null
    });
  });

  it("calculates estimated cost when costs are provided", () => {
    const cost = calculateEstimatedLlmCostUsd({
      promptTokens: 1_000_000,
      completionTokens: 500_000,
      inputCostPer1M: "2",
      outputCostPer1M: "8"
    });

    expect(cost).toBe(6);
  });

  it("returns null when costs are absent", () => {
    const cost = calculateEstimatedLlmCostUsd({
      promptTokens: 1_000,
      completionTokens: 500
    });

    expect(cost).toBeNull();
  });

  it("calculates estimated savings from saved cache tokens", () => {
    const savings = calculateEstimatedSavingsUsd({
      savedPromptTokens: 2_000_000,
      savedCompletionTokens: 1_000_000,
      inputCostPer1M: "1.5",
      outputCostPer1M: "6"
    });

    expect(savings).toBe(9);
  });
});
