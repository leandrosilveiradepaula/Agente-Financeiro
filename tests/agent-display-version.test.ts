import { afterEach, describe, expect, it } from "vitest";
import { getAgentDisplayVersion } from "@/lib/agent-display-version";

const originalDisplayVersion = process.env.NEXT_PUBLIC_AGENT_DISPLAY_VERSION;

afterEach(() => {
  if (originalDisplayVersion === undefined) {
    delete process.env.NEXT_PUBLIC_AGENT_DISPLAY_VERSION;
  } else {
    process.env.NEXT_PUBLIC_AGENT_DISPLAY_VERSION = originalDisplayVersion;
  }
});

describe("getAgentDisplayVersion", () => {
  it("uses the operational display version from environment", () => {
    process.env.NEXT_PUBLIC_AGENT_DISPLAY_VERSION = "v2.2.31-stable-preflight-retry";

    expect(getAgentDisplayVersion()).toBe("v2.2.31-stable-preflight-retry");
  });

  it("does not fall back to technical API versions", () => {
    process.env.NEXT_PUBLIC_AGENT_DISPLAY_VERSION = "v2.2.31-stable-preflight-retry";

    expect(
      getAgentDisplayVersion({
        agent_version: ["v2.0.2", "query-model-catalog"].join("-")
      })
    ).toBe("v2.2.31-stable-preflight-retry");
  });

  it("returns an empty value when no display version is configured", () => {
    delete process.env.NEXT_PUBLIC_AGENT_DISPLAY_VERSION;

    expect(getAgentDisplayVersion()).toBe("");
  });
});
