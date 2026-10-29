import { describe, expect, it } from "vitest";
import { assessRecordedOfficialSqlRunOrigin } from "@/lib/official-sql-run-origin";

const official = {
  source: "interface",
  metadata: { operation: "generate_sql" },
  execution_status: "executed"
};

describe("official SQL provenance gate", () => {
  it("recognizes only a server-recorded official generation path", () => {
    expect(assessRecordedOfficialSqlRunOrigin(official as never)).toBe("recorded_official_path");
    expect(assessRecordedOfficialSqlRunOrigin({
      ...official, execution_status: "generated"
    } as never)).toBe("recorded_official_path");
  });

  it("rejects candidate generations, P2-only runs, unknown origin and unknown operation", () => {
    for (const record of [
      { ...official, source: "candidate_langgraph_generate_only" },
      { ...official, source: "shadow_p2_generate_only" },
      { ...official, source: null },
      { ...official, metadata: { operation: "shadow_generate_only" } },
      { ...official, metadata: {} },
      { ...official, metadata: null },
      { ...official, execution_status: "failed" },
      { ...official, execution_status: "pending" }
    ]) {
      expect(assessRecordedOfficialSqlRunOrigin(record as never))
        .not.toBe("recorded_official_path");
    }
  });
});
