type UnknownRecord = Record<string, unknown>;

type LlmUsageInput = {
  promptTokens?: number | null;
  completionTokens?: number | null;
  inputCostPer1M?: string | number | null;
  outputCostPer1M?: string | number | null;
};

export type NormalizedLlmUsage = {
  provider: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  source: string | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(root: unknown, path: string[]) {
  let current = root;

  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function firstString(root: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = readPath(root, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

export function normalizePositiveInteger(value: unknown): number | null {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numericValue) || numericValue < 0) return null;

  return Math.round(numericValue);
}

function firstInteger(root: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = normalizePositiveInteger(readPath(root, path));
    if (value !== null) return value;
  }

  return null;
}

export function extractLlmUsageFromResponse(raw: unknown): NormalizedLlmUsage {
  const promptTokens = firstInteger(raw, [
    ["llm_usage", "prompt_tokens"],
    ["llm_usage", "promptTokens"],
    ["usage", "prompt_tokens"],
    ["usage", "promptTokens"],
    ["usageMetadata", "promptTokenCount"],
    ["raw", "usageMetadata", "promptTokenCount"],
    ["data", "usageMetadata", "promptTokenCount"],
    ["response", "usageMetadata", "promptTokenCount"],
    ["prompt_tokens"],
    ["promptTokens"]
  ]);

  const completionTokens = firstInteger(raw, [
    ["llm_usage", "completion_tokens"],
    ["llm_usage", "completionTokens"],
    ["usage", "completion_tokens"],
    ["usage", "completionTokens"],
    ["usageMetadata", "candidatesTokenCount"],
    ["raw", "usageMetadata", "candidatesTokenCount"],
    ["data", "usageMetadata", "candidatesTokenCount"],
    ["response", "usageMetadata", "candidatesTokenCount"],
    ["completion_tokens"],
    ["completionTokens"]
  ]);

  const directTotalTokens = firstInteger(raw, [
    ["llm_usage", "total_tokens"],
    ["llm_usage", "totalTokens"],
    ["usage", "total_tokens"],
    ["usage", "totalTokens"],
    ["usageMetadata", "totalTokenCount"],
    ["raw", "usageMetadata", "totalTokenCount"],
    ["data", "usageMetadata", "totalTokenCount"],
    ["response", "usageMetadata", "totalTokenCount"],
    ["total_tokens"],
    ["totalTokens"]
  ]);

  const totalTokens =
    directTotalTokens ??
    (promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null);

  const hasUsage = promptTokens !== null || completionTokens !== null || totalTokens !== null;

  return {
    provider: firstString(raw, [
      ["llm_usage", "provider"],
      ["provider"],
      ["llm_provider"]
    ]),
    model: firstString(raw, [
      ["llm_usage", "model"],
      ["model"],
      ["llm_model"],
      ["agent_model"],
      ["agent_version"]
    ]),
    promptTokens,
    completionTokens,
    totalTokens,
    source: hasUsage
      ? firstString(raw, [["llm_usage", "source"], ["usage_source"], ["llm_usage_source"]]) ??
        "response"
      : null
  };
}

function normalizeCostPer1M(value: string | number | null | undefined) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

export function calculateEstimatedLlmCostUsd(input: LlmUsageInput) {
  const inputCost = normalizeCostPer1M(input.inputCostPer1M);
  const outputCost = normalizeCostPer1M(input.outputCostPer1M);

  if (inputCost === null || outputCost === null) return null;
  if (input.promptTokens === null || input.promptTokens === undefined) return null;
  if (input.completionTokens === null || input.completionTokens === undefined) return null;

  return (input.promptTokens / 1_000_000) * inputCost +
    (input.completionTokens / 1_000_000) * outputCost;
}

export function calculateEstimatedSavingsUsd(input: {
  savedPromptTokens?: number | null;
  savedCompletionTokens?: number | null;
  inputCostPer1M?: string | number | null;
  outputCostPer1M?: string | number | null;
}) {
  return calculateEstimatedLlmCostUsd({
    promptTokens: input.savedPromptTokens,
    completionTokens: input.savedCompletionTokens,
    inputCostPer1M: input.inputCostPer1M,
    outputCostPer1M: input.outputCostPer1M
  });
}
