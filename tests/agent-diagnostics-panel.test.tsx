import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDiagnosticsPanel } from "@/components/AgentDiagnosticsPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderDiagnostics(onClearLocalErrors = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      <AgentDiagnosticsPanel
        interfaceVersion="interface-v2.0.12"
        baseline="v2.0.12 — Painel de diagnóstico e saúde do agente"
        agentVersion="v2.0.6.2-benchmark-30-30-stable"
        generation={{
          response: {
            success: true,
            agent_version: "v2.0.6.2-benchmark-30-30-stable",
            detected_intent: "estouro_orcamento",
            validation_status: "aprovado",
            sql: "SELECT 1",
            raw: null
          },
          isLoading: false,
          error: "Erro local"
        }}
        execution={{
          response: {
            success: true,
            query_id: "abc123",
            execution_time_ms: 646.21,
            row_count: 30,
            columns: ["conta_contabil"],
            data: [{ conta_contabil: "5.03.01.01.01" }],
            raw: null,
            relatorio_executivo: {
              title: "Resumo executivo",
              paragraphs: ["A análise identifica os maiores estouros de orçamento."],
              highlights: ["Ranking utilizado: ranking_geral."],
              intent: "estouro_orcamento"
            },
            relatorio_executivo_markdown: "# Diagnóstico"
          },
          isLoading: false,
          error: "",
          message: "",
          source: "automatico"
        }}
        metadata={{
          query_id: "abc123",
          detected_intent: "estouro_orcamento",
          validation_status: "aprovado",
          row_count: 30,
          execution_time_ms: 646.21,
          success: true
        }}
        queryHistoryCount={2}
        executiveReportHistoryCount={1}
        lastExecutiveReport={null}
        executiveSummary={null}
        onClearLocalErrors={onClearLocalErrors}
      />
    );
  });

  return { view: container, onClearLocalErrors };
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
  window.localStorage.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
  });
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

describe("AgentDiagnosticsPanel", () => {
  it("renders current health and copies diagnostics", async () => {
    const { view } = renderDiagnostics();

    expect(view.textContent).toContain("Diagnóstico do agente");
    expect(view.textContent).toContain("abc123");
    expect(view.textContent).toContain("estouro_orcamento");
    expect(view.textContent).toContain("relatorio_executivo presente");
    expect(view.textContent).toContain("relatorio_executivo_markdown presente");

    clickButton("Copiar diagnóstico");

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("Query ID: abc123")
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("Relatório executivo: presente")
      );
    });
  });

  it("calls clear local errors without clearing data", () => {
    const { onClearLocalErrors } = renderDiagnostics();

    clickButton("Limpar erros locais");

    expect(onClearLocalErrors).toHaveBeenCalledTimes(1);
  });
});
