import type { LlmSelection } from "@/lib/llm-provider-types";

// Phase 1 platform safety gate. Compare already-resolved versioned identities
// without selecting a provider or encoding any customer/business rules.
// Cross-provider evaluation requires the separately authorized later phase.
const IDENTITY_FIELDS = ["provider_key", "model_key", "config_version"] as const;

export function isShadowPhaseOneProviderMatch(
  official: LlmSelection | null | undefined,
  shadow: LlmSelection | null | undefined
): boolean {
  if (!official || !shadow) return false;
  return IDENTITY_FIELDS.every((field) =>
    typeof official[field] === "string" &&
    official[field].length > 0 &&
    official[field] === shadow[field]
  );
}
