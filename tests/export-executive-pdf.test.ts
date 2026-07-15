import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportExecutivePdf } from "@/lib/exportExecutivePdf";

const mocks = vi.hoisted(() => ({
  autoTable: vi.fn(),
  save: vi.fn()
}));

vi.mock("jspdf-autotable", () => ({
  default: mocks.autoTable
}));

vi.mock("jspdf", () => ({
  default: class MockJsPdf {
    internal = {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297
      }
    };

    setFillColor = vi.fn();
    rect = vi.fn();
    setTextColor = vi.fn();
    setFont = vi.fn();
    setFontSize = vi.fn();
    text = vi.fn();
    setDrawColor = vi.fn();
    setLineWidth = vi.fn();
    line = vi.fn();
    splitTextToSize = (text: string) => [text];
    roundedRect = vi.fn();
    addPage = vi.fn();
    getNumberOfPages = () => 1;
    setPage = vi.fn();
    save = mocks.save;
  }
}));

describe("exportExecutivePdf", () => {
  beforeEach(() => {
    mocks.autoTable.mockClear();
    mocks.save.mockClear();
  });

  it("uses the real loaded row count in the header while visually limiting the table", () => {
    exportExecutivePdf({
      question: "Pergunta",
      sql: "SELECT 1",
      columns: ["entidade", "ranking_geral"],
      data: Array.from({ length: 25 }, (_, index) => ({
        entidade: `Item ${index + 1}`,
        ranking_geral: index + 1
      })),
      metadata: {
        row_count: 25
      },
      executiveSummary: {
        title: "Resumo executivo",
        paragraphs: ["Resumo"],
        highlights: []
      },
      settings: {
        pdfMaxRows: 5,
        pdfMaxColumns: 2,
        pdfIncludeSql: false,
        pdfMaxSqlLines: 20
      }
    });

    expect(mocks.autoTable.mock.calls[0][1].body).toContainEqual(["Linhas", "25"]);
    expect(mocks.autoTable.mock.calls[1][1].body).toHaveLength(5);
  });
});
