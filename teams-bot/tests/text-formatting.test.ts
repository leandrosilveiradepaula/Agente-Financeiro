import { describe, expect, it } from "vitest";
import { formatTeamsTableValue, normalizeTeamsMessage } from "../src/text-formatting.js";

describe("text formatting", () => {
  it("removes Teams mentions from messages", () => {
    expect(normalizeTeamsMessage("<at>DuckLake</at> Quais os estouros?")).toBe(
      "Quais os estouros?"
    );
  });

  it("formats money, percent and ranking while preserving account codes", () => {
    expect(formatTeamsTableValue("variancia_rs", -851264.6)).toBe("-R$ 851.264,60");
    expect(formatTeamsTableValue("variancia_perc", -14.47)).toBe("-14,47%");
    expect(formatTeamsTableValue("ranking_geral", 1)).toBe("1");
    expect(formatTeamsTableValue("conta_contabil", "5.03.01.01.01")).toBe("5.03.01.01.01");
  });
});
