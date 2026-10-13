import "server-only";
import registrySource from "@/config/llm-models.json";
import type {
  LlmExecutionTarget,
  LlmLocation,
  LlmModelStatus,
  LlmSelection,
  PublicLlmModel
} from "@/lib/llm-provider-types";

type RuntimeConfig = {
  base_url_ref_env?: string;
  credential_ref_env?: string;
  http_host_ref_env?: string;
};

type RegistryEntry = LlmSelection & {
  display_name: string;
  provider_display_name: string;
  description?: string;
  location: LlmLocation;
  status: LlmModelStatus;
  enabled: boolean;
  targets: LlmExecutionTarget[];
  is_default_for: LlmExecutionTarget[];
  allowed_profiles: string[];
  capabilities: string[];
  adapter_type: string;
  runtime?: RuntimeConfig;
  timeout_ms?: number;
  max_tokens?: number;
  temperature?: number;
};

type RegistryDocument = {
  registry_version: string;
  environment: string;
  models: RegistryEntry[];
};

export class LlmSelectionError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "LlmSelectionError";
    this.code = code;
  }
}

function registry(): RegistryDocument {
  return registrySource as RegistryDocument;
}

function hasProfileAccess(entry: RegistryEntry, profile: string) {
  return entry.allowed_profiles.includes("*") || entry.allowed_profiles.includes(profile);
}

function supportsTarget(entry: RegistryEntry, target: LlmExecutionTarget) {
  return entry.enabled && entry.targets.includes(target);
}

function publicModel(entry: RegistryEntry, target: LlmExecutionTarget): PublicLlmModel {
  return {
    id: `${entry.provider_key}:${entry.model_key}:${entry.config_version}`,
    provider_key: entry.provider_key,
    model_key: entry.model_key,
    config_version: entry.config_version,
    display_name: entry.display_name,
    provider_display_name: entry.provider_display_name,
    description: entry.description,
    location: entry.location,
    status: entry.status,
    is_default: entry.is_default_for.includes(target),
    available_for_target: supportsTarget(entry, target),
    capabilities: [...entry.capabilities]
  };
}

export function getLlmRegistryVersion() {
  return registry().registry_version;
}

export function getLlmRegistryEnvironment() {
  return registry().environment;
}

export function listAvailableLlmModels(input: {
  environment: string;
  target: LlmExecutionTarget;
  profile: string;
}) {
  const document = registry();

  if (document.environment !== input.environment) {
    return [];
  }

  return document.models
    .filter(
      (entry) =>
        entry.enabled &&
        hasProfileAccess(entry, input.profile) &&
        entry.capabilities.includes("sql_generation")
    )
    .map((entry) => publicModel(entry, input.target));
}

export function getDefaultLlmSelection(input: {
  environment: string;
  target: LlmExecutionTarget;
  profile: string;
}): LlmSelection | null {
  const models = listAvailableLlmModels(input);
  const selected =
    models.find((model) => model.is_default && model.available_for_target) ?? null;

  return selected
    ? {
        provider_key: selected.provider_key,
        model_key: selected.model_key,
        config_version: selected.config_version
      }
    : null;
}

export function resolveLlmSelection(input: {
  environment: string;
  target: LlmExecutionTarget;
  profile: string;
  requested?: LlmSelection | null;
}) {
  const document = registry();

  if (document.environment !== input.environment) {
    throw new LlmSelectionError("llm_registry_environment_unavailable");
  }

  const candidates = document.models.filter(
    (entry) =>
      supportsTarget(entry, input.target) &&
      hasProfileAccess(entry, input.profile) &&
      entry.capabilities.includes("sql_generation")
  );

  if (input.requested) {
    const requested = candidates.find(
      (entry) =>
        entry.provider_key === input.requested?.provider_key &&
        entry.model_key === input.requested?.model_key &&
        entry.config_version === input.requested?.config_version
    );

    if (!requested) {
      throw new LlmSelectionError("llm_model_not_available");
    }

    return {
      model: requested,
      selection: {
        provider_key: requested.provider_key,
        model_key: requested.model_key,
        config_version: requested.config_version
      } satisfies LlmSelection,
      source: "requested" as const
    };
  }

  const selected = candidates.find((entry) => entry.is_default_for.includes(input.target));

  if (!selected) {
    throw new LlmSelectionError("llm_default_model_not_configured");
  }

  return {
    model: selected,
    selection: {
      provider_key: selected.provider_key,
      model_key: selected.model_key,
      config_version: selected.config_version
    } satisfies LlmSelection,
    source: "default" as const
  };
}

export function parseLlmSelection(value: unknown): LlmSelection | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new LlmSelectionError("invalid_llm_selection");
  }

  const record = value as Record<string, unknown>;
  const providerKey = typeof record.provider_key === "string" ? record.provider_key.trim() : "";
  const modelKey = typeof record.model_key === "string" ? record.model_key.trim() : "";
  const configVersion =
    typeof record.config_version === "string" ? record.config_version.trim() : "";

  if (!providerKey || !modelKey || !configVersion) {
    throw new LlmSelectionError("invalid_llm_selection");
  }

  return {
    provider_key: providerKey,
    model_key: modelKey,
    config_version: configVersion
  };
}
