export type LlmExecutionTarget = "official" | "shadow";
export type LlmLocation = "local" | "cloud";
export type LlmModelStatus = "online" | "offline" | "degraded" | "configured" | "disabled";

export type LlmSelection = {
  provider_key: string;
  model_key: string;
  config_version: string;
};

export type PublicLlmModel = LlmSelection & {
  id: string;
  display_name: string;
  provider_display_name: string;
  description?: string;
  location: LlmLocation;
  status: LlmModelStatus;
  is_default: boolean;
  capabilities: string[];
};

export type LlmModelsResponse = {
  success: boolean;
  registry_version: string;
  target: LlmExecutionTarget;
  models: PublicLlmModel[];
  default_selection: LlmSelection | null;
  error?: string;
};
