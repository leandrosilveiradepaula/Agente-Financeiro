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

    expect(csv).toContain("entidade;ranking_geral");
    expect(csv).toContain("A;1");
    expect(csv).toContain("B;2");
    expect(csv).toContain("C;3");
  });
});
