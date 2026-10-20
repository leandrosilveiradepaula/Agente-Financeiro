import { describe, expect, it } from "vitest";
import { assessRecordedProviderIdentity, type ShadowProviderEvidence } from
  "@/lib/shadow-provider-parity";

const official = {provider:"provider-neutral",model:"model-v3"};
const shadow: ShadowProviderEvidence = {
  shadow_generator_provider:"provider-neutral",
  shadow_generator_model:"model-v3",
  shadow_repair_provider:null, shadow_repair_model:null,
  generator_identity_attested:true, repair_identity_attested:true,
  requires_reapproval:false
};

describe("signed, post-generation provider/model attestation", () => {
  it("identifies exact recorded generator model labels", () => {
    expect(assessRecordedProviderIdentity(official, shadow))
      .toBe("identifiers_matched");
  });

  it("does not equate provider aliases, casing or different model versions", () => {
    expect(assessRecordedProviderIdentity(
      {provider:"Provider-Neutral",model:"model-v3"},shadow))
      .toBe("identifier_mismatch");
    expect(assessRecordedProviderIdentity(
      {provider:"provider-neutral",model:"model-v4"},shadow))
      .toBe("identifier_mismatch");
  });

  it("does not invent missing identities from runtime default values", () => {
    expect(assessRecordedProviderIdentity({provider:null,model:"model-v3"},shadow))
      .toBe("unattested");
    expect(assessRecordedProviderIdentity(official,{
      ...shadow, shadow_generator_model:null, generator_identity_attested:false
    })).toBe("unattested");
    expect(assessRecordedProviderIdentity(official,{
      ...shadow, generator_identity_attested:false
    })).toBe("unattested");
  });

  it("requires recorded repair identity for repaired output", () => {
    expect(assessRecordedProviderIdentity(official,{
      ...shadow, requires_reapproval:true, repair_identity_attested:false
    })).toBe("unattested");
    expect(assessRecordedProviderIdentity(official,{
      ...shadow, requires_reapproval:true, repair_identity_attested:true,
      shadow_repair_provider:"provider-neutral",shadow_repair_model:"model-v4"
    })).toBe("identifier_mismatch");
    expect(assessRecordedProviderIdentity(official,{
      ...shadow, requires_reapproval:true, repair_identity_attested:true,
      shadow_repair_provider:"provider-neutral",shadow_repair_model:"model-v3"
    })).toBe("identifiers_matched");
  });
});
