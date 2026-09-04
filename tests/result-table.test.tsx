import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultTable } from "@/components/ResultTable";

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

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:csv");
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

describe("ResultTable", () => {
  it("renders all result rows and exports the complete dataset to CSV", async () => {
    const view = render(
      <ResultTable
        columns={["entidade", "ranking_geral"]}
        data={[
          { entidade: "A", ranking_geral: 1 },
          { entidade: "B", ranking_geral: 2 },
          { entidade: "C", ranking_geral: 3 }
        ]}
      />
    );

    expect(view.textContent).toContain("3 de 3 linhas");
    expect(view.textContent).toContain("Ranking Geral");
    expect(view.textContent).toContain("A");
    expect(view.textContent).toContain("B");
    expect(view.textContent).toContain("C");

    const input = view.querySelector("input");
    expect(input).toBeTruthy();

    act(() => {
      input!.value = "A";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const exportButton = Array.from(view.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Exportar CSV")
    );
    expect(exportButton).toBeTruthy();

    act(() => {
      exportButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const csv = await blob.text();

    expect(csv).toContain("entidade,ranking_geral");
    expect(csv).toContain("A,1");
    expect(csv).toContain("B,2");
    expect(csv).toContain("C,3");
  });

  it("uses presentation labels and formatting without mutating raw data", () => {
    const row = {
      centro_custo: "Financeiro",
      opex_realizado_rs: "-759015.00",
      opex_orcado_rs: "-681400.00",
      variancia_rs: "-77615.00",
      perc_orcado_consumido: "111.3905195186381000",
      ranking_desempenho: "1"
    };

    const view = render(
      <ResultTable
        columns={[
          "centro_custo",
          "opex_realizado_rs",
          "opex_orcado_rs",
          "variancia_rs",
          "perc_orcado_consumido",
          "ranking_desempenho"
        ]}
        data={[row]}
      />
    );

    expect(view.textContent).toContain("Centro de Custo");
    expect(view.textContent).toContain("Financeiro");
    expect(view.textContent).toContain("OPEX Realizado");
    expect(view.textContent).toContain("-R$ 759.015,00");
    expect(view.textContent).toContain("OPEX Orçado");
    expect(view.textContent).toContain("-R$ 681.400,00");
    expect(view.textContent).toContain("Variação");
    expect(view.textContent).toContain("-R$ 77.615,00");
    expect(view.textContent).toContain("Orçamento Consumido");
    expect(view.textContent).toContain("111,4%");
    expect(view.textContent).toContain("Posição");
    expect(view.textContent).toContain("1º");
    expect(row).toEqual({
      centro_custo: "Financeiro",
      opex_realizado_rs: "-759015.00",
      opex_orcado_rs: "-681400.00",
      variancia_rs: "-77615.00",
      perc_orcado_consumido: "111.3905195186381000",
      ranking_desempenho: "1"
    });
  });

  it("formats common commercial result shapes", () => {
    const view = render(
      <ResultTable
        columns={["marca", "receita_rs", "receita", "opex", "resultado_liquido_rs", "resultado_perc_rol", "campo_nulo", "alguma_nova_metrica"]}
        data={[
          {
            marca: "Horizonte",
            receita_rs: "899875.39",
            receita: "1014335.91",
            opex: "-3063405.00",
            resultado_liquido_rs: "-125000.50",
            resultado_perc_rol: "-4.812345",
            campo_nulo: null,
            alguma_nova_metrica: "ok"
          }
        ]}
      />
    );

    expect(view.textContent).toContain("Marca");
    expect(view.textContent).toContain("Receita");
    expect(view.textContent).toContain("R$ 899.875,39");
    expect(view.textContent).toContain("R$ 1.014.335,91");
    expect(view.textContent).toContain("OPEX");
    expect(view.textContent).toContain("-R$ 3.063.405,00");
    expect(view.textContent).toContain("Resultado Líquido");
    expect(view.textContent).toContain("-R$ 125.000,50");
    expect(view.textContent).toContain("Resultado / ROL");
    expect(view.textContent).toContain("-4,8%");
    expect(view.textContent).toContain("—");
    expect(view.textContent).toContain("Alguma Nova Métrica");
  });

  it("exports header-only CSV when the execution returns zero rows", async () => {
    const view = render(<ResultTable columns={["entidade", "ranking_geral"]} data={[]} />);
    const exportButton = Array.from(view.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Exportar CSV")
    );

    expect(exportButton).toBeTruthy();
    expect(exportButton!.hasAttribute("disabled")).toBe(false);

    act(() => {
      exportButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });
});
