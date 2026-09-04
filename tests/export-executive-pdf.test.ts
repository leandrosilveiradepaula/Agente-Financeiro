import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportExecutivePdf } from "@/lib/exportExecutivePdf";

const mocks = vi.hoisted(() => ({
  autoTable: vi.fn(),
  save: vi.fn(),
  text: vi.fn()
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
    text = mocks.text;
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
    mocks.text.mockClear();
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
    expect(mocks.autoTable.mock.calls[0][1].body).not.toContainEqual([
      "Query ID",
      expect.any(String)
    ]);
    expect(mocks.autoTable.mock.calls[1][1].body).toHaveLength(5);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.stringMatching(/^grupo-horizonte-analise-financeira-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/)
    );
  });

  it("does not render SQL when SQL inclusion is disabled", () => {
    exportExecutivePdf({
      question: "Pergunta",
      sql: "SELECT 1",
      columns: ["entidade"],
      data: [{ entidade: "A" }],
      metadata: {
        row_count: 1,
        success: true
      },
      executiveSummary: null,
      settings: {
        pdfMaxRows: 5,
        pdfMaxColumns: 2,
        pdfIncludeSql: false,
        pdfMaxSqlLines: 20
      }
    });

    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.text).not.toHaveBeenCalledWith("SQL utilizada", expect.any(Number), expect.any(Number));
    expect(mocks.text).not.toHaveBeenCalledWith("SELECT 1", expect.any(Number), expect.any(Number));
  });

  it("renders commercial branding and zero-row results without technical metadata", () => {
    exportExecutivePdf({
      question: "Pergunta",
      sql: "",
      columns: ["campo"],
      data: [],
      metadata: {
        row_count: 0,
        success: true,
        detected_intent: "consulta_sem_registros",
        query_id: "query-tecnica"
      },
      executiveSummary: null,
      settings: {
        pdfMaxRows: 5,
        pdfMaxColumns: 2,
        pdfIncludeSql: false,
        pdfMaxSqlLines: 20
      }
    });

    const renderedText = JSON.stringify(mocks.text.mock.calls);
    expect(renderedText).toContain("Agente Financeiro");
    expect(renderedText).toContain("Grupo Horizonte");
    expect(renderedText).toContain("Inteligência para conversar com seus dados.");
    expect(renderedText).toContain("Nenhum registro encontrado para os filtros da análise.");
    expect(renderedText).not.toContain("Query ID");
    expect(renderedText).not.toContain("query-tecnica");
  });

  it("renders SQL only when the caller explicitly includes it", () => {
    exportExecutivePdf({
      question: "Pergunta",
      sql: "SELECT 1",
      columns: ["entidade"],
      data: [{ entidade: "A" }],
      metadata: {
        row_count: 1,
        success: true
      },
      executiveSummary: null,
      settings: {
        pdfMaxRows: 5,
        pdfMaxColumns: 2,
        pdfIncludeSql: true,
        pdfMaxSqlLines: 20
      }
    });

    expect(mocks.text).toHaveBeenCalledWith("SQL utilizada", expect.any(Number), expect.any(Number));
    expect(mocks.text).toHaveBeenCalledWith("SELECT 1", expect.any(Number), expect.any(Number));
  });
});
