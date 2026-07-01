import { beforeEach, describe, expect, it } from "vitest";
import {
  getDefaultInterfaceSettings,
  readInterfaceSettings,
  resetInterfaceSettings,
  writeInterfaceSettings
} from "@/lib/interface-settings";

describe("interface settings helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns defaults when storage is empty", () => {
    expect(readInterfaceSettings()).toEqual(getDefaultInterfaceSettings());
  });

  it("writes and reads normalized settings", () => {
    const saved = writeInterfaceSettings({
      ...getDefaultInterfaceSettings(),
      pdfMaxRows: 5,
      pdfMaxColumns: 6,
      pdfIncludeSql: false,
      pdfMaxSqlLines: 30,
      markdownIncludeSql: false,
      showDiagnosticsPanel: false,
      showExecutiveReportHistory: false,
      defaultResultMode: "manual"
    });

    expect(readInterfaceSettings()).toEqual(saved);
    expect(saved.defaultResultMode).toBe("manual");
    expect(saved.pdfIncludeSql).toBe(false);
  });

  it("clamps invalid numeric values and falls back from invalid shapes", () => {
    window.localStorage.setItem(
      "ducklake-sql-agent-interface-settings",
      JSON.stringify({
        pdfMaxRows: 500,
        pdfMaxColumns: 1,
        pdfMaxSqlLines: "bad",
        defaultResultMode: "invalid"
      })
    );

    expect(readInterfaceSettings()).toMatchObject({
      pdfMaxRows: 50,
      pdfMaxColumns: 4,
      pdfMaxSqlLines: 120,
      defaultResultMode: "auto"
    });
  });

  it("resets settings to defaults", () => {
    writeInterfaceSettings({
      ...getDefaultInterfaceSettings(),
      defaultResultMode: "manual",
      pdfIncludeSql: false
    });

    expect(resetInterfaceSettings()).toEqual(getDefaultInterfaceSettings());
    expect(readInterfaceSettings()).toEqual(getDefaultInterfaceSettings());
  });
});
