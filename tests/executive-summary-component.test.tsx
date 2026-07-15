import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutiveSummary } from "@/components/ExecutiveSummary";
import type { ExecutiveSummaryResult, ResultRow } from "@/lib/types";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(element);
  });

  return container;
}

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

describe("ExecutiveSummary", () => {
  it("uses backend summary only as fallback when there are no result rows", () => {
    const backendSummary: ExecutiveSummaryResult = {
      title: "Resumo executivo",
      paragraphs: [
        "A análise identifica os maiores estouros de orçamento do mês, excluindo Receita de Vendas e priorizando as maiores variações negativas em ranking global."
      ],
      highlights: ["Ranking utilizado: ranking_geral."],
      warnings: ["Receita de Vendas não deve entrar nesta leitura de estouro de orçamento."],
      intent: "estouro_orcamento",
      generated_by: "watson_orchestration"
    };
    const onSummaryGenerated = vi.fn();
    const view = render(
      <ExecutiveSummary
        question="Quais as contas que tiveram maiores estouros de orçamento no mês?"
        columns={["conta_contabil", "variancia_rs"]}
        data={[]}
        backendSummary={backendSummary}
        onSummaryGenerated={onSummaryGenerated}
      />
    );

    expect(view.textContent).toContain("A análise identifica os maiores estouros de orçamento");
    expect(view.textContent).toContain("Ranking utilizado: ranking_geral.");
    expect(view.textContent).toContain("Receita de Vendas não deve entrar nesta leitura");
    expect(view.textContent).toContain("Resumo executivo gerado pelo serviço de orquestração.");
    expect(view.textContent).not.toContain("Regerar resumo");
    expect(onSummaryGenerated).toHaveBeenCalledWith(backendSummary);
  });

  it("prefers local normalized summary when result rows exist even with backendSummary", () => {
    const backendSummary: ExecutiveSummaryResult = {
      title: "Resumo executivo",
      paragraphs: ["Resumo antigo da orquestração."],
      highlights: ["Maior variação positiva: B com -R$ 16.759,68."],
      generated_by: "watson_orchestration"
    };
    const view = render(
      <ExecutiveSummary
        columns={[
          "grupo_dre",
          "realizado_rs",
          "orcado_rs",
          "variancia_rs",
          "variancia_perc",
          "tipo_variacao"
        ]}
        data={[
          { grupo_dre: "A", variancia_rs: -562193.32 },
          { grupo_dre: "B", variancia_rs: -16759.68 }
        ]}
        backendSummary={backendSummary}
      />
    );

    expect(view.textContent).toContain("Maior variação negativa");
    expect(view.textContent).not.toContain("Maior variação positiva");
    expect(view.textContent).not.toContain("Resumo executivo gerado pelo serviço de orquestração.");
    expect(view.textContent).toContain(
      "Resumo executivo gerado a partir dos resultados normalizados da interface."
    );
  });

  it("uses local fallback only when backendSummary is absent", () => {
    const data: ResultRow[] = [
      {
        tipo_impacto: "Estouro de despesas/custos",
        grupo_dre: "05 - CMV",
        subgrupo: "CMV",
        conta_contabil: "5.03.01.01.01",
        realizado_rs: -851264.6,
        orcado_rs: 0,
        variancia_rs: -851264.6,
        variancia_perc: -14.47,
        ranking_no_tipo: 1
      }
    ];
    const view = render(
      <ExecutiveSummary
        question="Quais as contas que tiveram maiores estouros de orçamento no mês?"
        columns={[
          "tipo_impacto",
          "grupo_dre",
          "subgrupo",
          "conta_contabil",
          "realizado_rs",
          "orcado_rs",
          "variancia_rs",
          "variancia_perc",
          "ranking_no_tipo"
        ]}
        data={data}
      />
    );

    expect(view.textContent).toContain("Regerar resumo");
    expect(view.textContent).toContain(
      "Resumo executivo gerado a partir dos resultados normalizados da interface."
    );
    expect(view.textContent).toContain("O maior ponto de atenção");
  });
});
