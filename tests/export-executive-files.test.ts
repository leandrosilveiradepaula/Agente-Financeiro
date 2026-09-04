import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExecutiveCsv,
  createExecutiveExportFilename,
  exportExecutiveCsv,
  exportExecutiveXlsx
} from "@/lib/exportExecutiveFiles";

const excelMocks = vi.hoisted(() => {
  const worksheets: { name: string; rows: unknown[][] }[] = [];
  const writeBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));

  return {
    worksheets,
    writeBuffer,
    workbook: vi.fn(function MockWorkbook(this: {
      xlsx: { writeBuffer: typeof writeBuffer };
      addWorksheet: (name: string) => { name: string; rows: unknown[][] };
    }) {
      this.xlsx = {
        writeBuffer
      };
      this.addWorksheet = (name: string) => {
        const sheet = {
          name,
          rows: [] as unknown[][],
          addRow: vi.fn((row: unknown[]) => {
            sheet.rows.push(row);
          }),
          addRows: vi.fn((rows: unknown[][]) => {
            sheet.rows.push(...rows);
          })
        };

        worksheets.push(sheet);
        return sheet;
      };
    })
  };
});

vi.mock("exceljs", () => ({
  Workbook: excelMocks.workbook
}));

beforeEach(() => {
  excelMocks.worksheets.length = 0;
  excelMocks.writeBuffer.mockClear();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("exportExecutiveFiles", () => {
  it("builds CSV with BOM-ready content, comma separator, escaping, and empty nulls", () => {
    const csv = buildExecutiveCsv(
      ["nome", "comentario", "valor"],
      [
        { nome: "Ação", comentario: 'linha "um", com vírgula', valor: null },
        { nome: "B", comentario: "quebra\nlinha", valor: 10 }
      ]
    );

    expect(csv).toBe(
      'nome,comentario,valor\nAção,"linha ""um"", com vírgula",\nB,"quebra\nlinha",10'
    );
  });

  it("exports header-only CSV with UTF-8 BOM", async () => {
    exportExecutiveCsv(["nome", "valor"], [], new Date(2026, 8, 3, 9, 5));

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const csv = await blob.text();

    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toBe("nome,valor");
  });

  it("creates commercial filenames without question text", () => {
    expect(createExecutiveExportFilename("xlsx", new Date(2026, 8, 3, 9, 5))).toBe(
      "grupo-horizonte-analise-financeira-2026-09-03-0905.xlsx"
    );
  });

  it("exports a real XLSX workbook shape with Resumo and Dados sheets and no SQL", async () => {
    await exportExecutiveXlsx({
      question: "Pergunta",
      columns: ["entidade", "valor"],
      data: [{ entidade: "A", valor: 1 }],
      rowCount: 1,
      success: true,
      detectedIntent: "ranking",
      executiveSummary: {
        title: "Resumo",
        paragraphs: ["Resposta do backend"],
        highlights: [],
        warnings: []
      },
      generatedAt: new Date(2026, 8, 3, 9, 5)
    });

    expect(excelMocks.worksheets.map((sheet) => sheet.name)).toEqual(["Resumo", "Dados"]);
    expect(excelMocks.worksheets[0].rows).toContainEqual(["pergunta", "Pergunta"]);
    expect(excelMocks.worksheets[0].rows).toContainEqual([
      "resposta_executiva",
      "Resposta do backend"
    ]);
    expect(excelMocks.worksheets[1].rows).toEqual([
      ["entidade", "valor"],
      ["A", 1]
    ]);
    expect(JSON.stringify(excelMocks.worksheets)).not.toContain("SELECT");
  });

  it("keeps zero-row XLSX exports valid with headers and no data rows", async () => {
    await exportExecutiveXlsx({
      question: "Pergunta sem registros",
      columns: ["campo"],
      data: [],
      rowCount: 0,
      success: true,
      detectedIntent: "consulta_sem_registros",
      executiveSummary: null,
      generatedAt: new Date(2026, 8, 3, 9, 5)
    });

    expect(excelMocks.worksheets.map((sheet) => sheet.name)).toEqual(["Resumo", "Dados"]);
    expect(excelMocks.worksheets[0].rows).toContainEqual(["quantidade_registros", 0]);
    expect(excelMocks.worksheets[0].rows).toContainEqual(["status", "success"]);
    expect(excelMocks.worksheets[1].rows).toEqual([["campo"]]);
  });

  it("keeps ExcelJS as a dynamic client-side dependency", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("lib/exportExecutiveFiles.ts", "utf8")
    );

    expect(source).toContain('await import("exceljs")');
    expect(source).not.toContain('from "exceljs"');
  });
});
