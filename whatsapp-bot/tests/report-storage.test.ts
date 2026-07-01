import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listReportsByUser, readSavedReports, saveReport } from "../src/report-storage.js";
import type { SavedWhatsAppReport } from "../src/types.js";

let dir = "";

function makeReport(overrides: Partial<SavedWhatsAppReport> = {}): SavedWhatsAppReport {
  return {
    id: crypto.randomUUID(),
    whatsappUserId: "5511999999999",
    whatsappName: "Leandro",
    phoneNumber: "5511999999999",
    queryId: "query-1",
    question: "Pergunta",
    markdown: "# Relatorio",
    summary: {
      title: "Resumo executivo",
      paragraphs: ["Resumo"],
      highlights: ["Destaque"]
    },
    columns: ["col"],
    dataPreview: [{ col: "valor" }],
    rowCount: 1,
    executionTimeMs: 100,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ducklake-whatsapp-"));
  process.env.SAVED_REPORTS_FILE = join(dir, "saved-reports.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.SAVED_REPORTS_FILE;
});

describe("report storage", () => {
  it("saves, lists and deduplicates reports by WhatsApp user and query id", async () => {
    await saveReport(makeReport({ id: "first" }));
    await saveReport(makeReport({ id: "second", rowCount: 2 }));

    const reports = await listReportsByUser("5511999999999", 5);

    expect(reports).toHaveLength(1);
    expect(reports[0].id).toBe("second");
    expect(reports[0].rowCount).toBe(2);
  });

  it("keeps at most 100 reports", async () => {
    for (let index = 0; index < 105; index += 1) {
      await saveReport(
        makeReport({
          id: `report-${index}`,
          queryId: `query-${index}`,
          createdAt: new Date(2026, 0, index + 1).toISOString()
        })
      );
    }

    expect(await readSavedReports()).toHaveLength(100);
  });
});
