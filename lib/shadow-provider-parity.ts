/**
 * Comparison-only attestation of model identifiers actually recorded by
 * both generators. No LLM calls, implicit provider aliasing or business rules.
 *
 * Exact identifier agreement is not model-output, semantic, SQL or financial
 * parity. When a required identity is absent the only safe status is unattested.
 */
export type ProviderIdentityStatus =
  | "identifiers_matched"
  | "identifier_mismatch"
  | "unattested";

export type ShadowProviderEvidence = {
  shadow_generator_provider: string | null;
  shadow_generator_model: string | null;
  shadow_repair_provider: string | null;
  shadow_repair_model: string | null;
  generator_identity_attested: boolean;
  repair_identity_attested: boolean;
  requires_reapproval: boolean;
};

function known(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function assessRecordedProviderIdentity(
  official: { provider: string | null; model: string | null },
  shadow: ShadowProviderEvidence
): ProviderIdentityStatus {
  const provider = known(official.provider);
  const model = known(official.model);
  const generatorProvider = known(shadow.shadow_generator_provider);
  const generatorModel = known(shadow.shadow_generator_model);

  if (
    !provider || !model || !generatorProvider || !generatorModel ||
    !shadow.generator_identity_attested
  ) return "unattested";

  if (shadow.requires_reapproval && (
    !shadow.repair_identity_attested ||
    !known(shadow.shadow_repair_provider) ||
    !known(shadow.shadow_repair_model)
  )) return "unattested";

  if (provider !== generatorProvider || model !== generatorModel) {
    return "identifier_mismatch";
  }

  if (shadow.requires_reapproval && (
    provider !== known(shadow.shadow_repair_provider) ||
    model !== known(shadow.shadow_repair_model)
  )) return "identifier_mismatch";

  return "identifiers_matched";
}
