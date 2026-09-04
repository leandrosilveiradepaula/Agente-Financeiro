import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutiveReportActions } from "@/components/ExecutiveReportActions";
import { buildExecutiveReportMarkdown } from "@/lib/executive-report-markdown";
import { exportExecutivePdf } from "@/lib/exportExecutivePdf";
import { exportExecutiveCsv, exportExecutiveXlsx } from "@/lib/exportExecutiveFiles";
import type { ExecutiveSummaryResult } from "@/lib/types";

vi.mock("@/lib/exportExecutivePdf", () => ({
  exportExecutivePdf: vi.fn()
}));

vi.mock("@/lib/exportExecutiveFiles", () => ({
  exportExecutiveCsv: vi.fn(),
  exportExecutiveXlsx: vi.fn()
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const summary: ExecutiveSummaryResult = {
  title: "Resumo executivo",
  paragraphs: [
    "A análise identifica os maiores estouros de orçamento do mês, excluindo Receita de Vendas e priorizando as maiores variações negativas em ranking global."
  ],
  highlights: ["Ranking utilizado: ranking_geral."],
  warnings: [
    "Receita de Vendas não deve entrar nesta leitura de estouro de orçamento; receita abaixo do orçamento pertence à análise de variação geral do resultado."
  ],
  intent: "estouro_orcamento"
};

function renderActions({
  backendMarkdown,
  canViewSql = true,
  reportSummary = summary
}: {
  backendMarkdown?: string | null;
  canViewSql?: boolean;
  reportSummary?: ExecutiveSummaryResult | null;
} = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <ExecutiveReportActions
        question="Quais as contas que tiveram maiores estouros de orçamento no mês?"
        sql="SELECT * FROM dev_lakehouse.main_gold.resultado LIMIT 100"
        columns={["conta_contabil", "variancia_rs"]}
        data={[{ conta_contabil: "5.03.01.01.01", variancia_rs: -851264.6 }]}
        metadata={{
          agent_version: "v2.0.7.1",
          detected_intent: "estouro_orcamento",
          validation_status: "aprovado",
          query_id: "d12eaaf4",
          row_count: 30,
          execution_time_ms: 100,
          success: true
        }}
        executiveSummary={reportSummary}
        backendMarkdown={backendMarkdown}
        canViewSql={canViewSql}
      />
    );
  });

  return container;
}

function clickButton(label: string) {
  const buttons = Array.from(document.querySelectorAll("button"));
  const button = buttons.find((item) => item.textContent?.includes(label));

  expect(button).toBeTruthy();

  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.mocked(exportExecutivePdf).mockClear();
  vi.mocked(exportExecutiveCsv).mockClear();
  vi.mocked(exportExecutiveXlsx).mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:markdown");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }

  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("ExecutiveReportActions", () => {
  it("copies backendMarkdown when provided", async () => {
    const backendMarkdown = "# Agente SQL Financeiro DuckLake — Relatório Executivo\n\nbackend";
    renderActions({ backendMarkdown });

    clickButton("Copiar relatório");
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(backendMarkdown);
    });
  });

  it("downloads backendMarkdown as a markdown file", () => {
    const backendMarkdown = "# Agente SQL Financeiro DuckLake — Relatório Executivo\n\nbackend";
    const createElementSpy = vi.spyOn(document, "createElement");
    renderActions({ backendMarkdown });

    clickButton("Baixar Markdown");

    const blobArg = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe("text/markdown;charset=utf-8");
    expect(createElementSpy).toHaveBeenCalledWith("a");
    const anchor = createElementSpy.mock.results
      .map((result) => result.value)
      .find((value): value is HTMLAnchorElement => value instanceof HTMLAnchorElement);
    expect(anchor?.download).toMatch(/^agente-sql-ducklake-relatorio-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-d12eaaf4\.md$/);
  });

  it("downloads fallback markdown when backendMarkdown is absent", () => {
    renderActions({ backendMarkdown: null });

    clickButton("Baixar Markdown");

    const blobArg = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe("text/markdown;charset=utf-8");
    expect(blobArg.size).toBeGreaterThan(0);
  });

  it("can omit SQL from fallback markdown without changing backendMarkdown behavior", () => {
    const fallback = buildExecutiveReportMarkdown({
      question: "Pergunta",
      sql: "SELECT 1",
      metadata: { query_id: "abc" },
      executiveSummary: summary,
      includeSql: false
    });

    expect(fallback).not.toContain("```sql");
    expect(fallback).not.toContain("SELECT 1");
    expect(fallback).toContain("## Observações e alertas");
  });

  it("does not use backendMarkdown or SQL when SQL visibility is disabled", async () => {
    const backendMarkdown =
      "# Relatório\n\n```sql\nSELECT * FROM dev_lakehouse.main_gold.resultado\n```";
    renderActions({ backendMarkdown, canViewSql: false });

    clickButton("Copiar relatório");
    await vi.waitFor(() => {
      const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string;
      expect(copied).not.toContain("dev_lakehouse");
      expect(copied).not.toContain("```sql");
    });
  });

  it("does not show SQL in the preview when SQL visibility is disabled", () => {
    const view = renderActions({ canViewSql: false });

    clickButton("Visualizar relatório");

    expect(view.textContent).not.toContain("SQL");
    expect(view.textContent).not.toContain("dev_lakehouse");
    expect(view.textContent).not.toContain("SQL não informada");
  });

  it("does not pass SQL to PDF, Markdown, XLSX, or CSV exports when SQL visibility is disabled", async () => {
    const backendMarkdown =
      "# Relatório\n\n```sql\nSELECT * FROM dev_lakehouse.main_gold.resultado\n```";
    renderActions({ backendMarkdown, canViewSql: false });

    clickButton("Exportar PDF");
    clickButton("Excel");
    clickButton("CSV");
    clickButton("Baixar Markdown");

    expect(exportExecutivePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: ""
      })
    );
    expect(exportExecutiveXlsx).toHaveBeenCalledWith(
      expect.not.objectContaining({
        sql: expect.anything()
      })
    );
    expect(exportExecutiveCsv).toHaveBeenCalledWith(
      ["conta_contabil", "variancia_rs"],
      [{ conta_contabil: "5.03.01.01.01", variancia_rs: -851264.6 }]
    );

    const blobArg = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const markdown = await blobArg.text();
    expect(markdown).not.toContain("dev_lakehouse");
    expect(markdown).not.toContain("```sql");
  });

  it("can render export actions without an executive summary", () => {
    const view = renderActions({ reportSummary: null, backendMarkdown: null });

    expect(view.textContent).toContain("Exportar PDF");
    expect(view.textContent).toContain("Excel");
    expect(view.textContent).toContain("CSV");
    expect(view.textContent).not.toContain("Resumo executivo");
  });

  it("uses presentation labels and formatted values in the preview only", () => {
    const view = renderActions();

    clickButton("Visualizar relatório");

    expect(view.textContent).toContain("Conta Contábil");
    expect(view.textContent).toContain("Variação");
    expect(view.textContent).toContain("-R$ 851.264,60");
    expect(view.textContent).not.toContain("variancia_rs");
  });
});
