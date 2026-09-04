import { describe, expect, it } from "vitest";
import {
  createNewSqlGenerationResetState,
  isLatestInterfaceRequest
} from "@/lib/agent-interface-state";

describe("agent interface state helpers", () => {
  it("clears previous execution-derived state when a new SQL generation starts", () => {
    const resetState = createNewSqlGenerationResetState();

    expect(resetState.sql).toBe("");
    expect(resetState.generation).toEqual({
      response: null,
      isLoading: true,
      error: ""
    });
    expect(resetState.execution).toEqual({
      response: null,
      isLoading: false,
      error: "",
      message: "",
      source: null
    });
    expect(resetState.executiveSummaryState).toBeNull();
  });

  it("identifies stale async generation responses", () => {
    expect(isLatestInterfaceRequest(2, 2)).toBe(true);
    expect(isLatestInterfaceRequest(1, 2)).toBe(false);
  });
});
