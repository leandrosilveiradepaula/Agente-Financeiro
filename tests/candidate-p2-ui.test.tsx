import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CandidateGeneratePage from "@/app/admin/candidate-generate/page";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<CandidateGeneratePage />));
  return container;
}

function response(status: number, data: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => data
  } as Response;
}

function writeQuestion(view: HTMLElement, value: string) {
  const textarea = view.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, "value"
  )?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(view: HTMLElement, title: string) {
  const found = Array.from(view.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(title)
  );
  expect(found).toBeTruthy();
  return found!;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/shadow-runs?")) {
      return response(200, {
        success: true, shadow_runs: [], shadow_enabled: false,
        comparison_enabled: false
      });
    }
    if (url === "/api/generate-sql") {
      return response(202, {
        success: true, accepted: true,
        agent_run_id: "11111111-1111-4111-8111-111111111111",
        real_sql_execution: false
      });
    }
    return response(404, { error: "not_found" });
  }));
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Existing candidate page — isolated P2 option", () => {
  it("sends exactly one explicit generate-only request and reads Shadow evidence", async () => {
    const view = renderPage();
    writeQuestion(view, "Compare o realizado e o orçado em 2025");
    act(() => {
      button(view, "Testar Shadow P2").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(view.textContent).toContain("Teste P2 enviado");
    });
    const calls = vi.mocked(fetch).mock.calls;
    const requests = calls.filter(([url]) => String(url) === "/api/generate-sql");
    expect(requests).toHaveLength(1);
    const options = requests[0][1] as RequestInit;
    expect(options.headers).toMatchObject({
      "X-Agent-P2-Generate-Only": "true",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(options.body as string)).toEqual({
      pergunta: "Compare o realizado e o orçado em 2025"
    });
    await vi.waitFor(() => {
      expect(calls.some(([url]) => String(url).includes("/shadow-runs?"))).toBe(true);
    });
    expect(calls.some(([url]) => String(url).includes("/execute"))).toBe(false);
    expect(calls.some(([url]) => String(url).includes("/candidate-generate"))).toBe(false);
    expect(view.textContent).not.toContain("SQL aprovada");
  });

  it("does not silently retry when a correlated dispatch is uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(503, {
      success: false,
      error: "p2_receipt_persistence_unavailable",
      agent_run_id: "22222222-2222-4222-8222-222222222222"
    })));
    const view = renderPage();
    writeQuestion(view, "Pergunta inédita de teste");
    act(() => {
      button(view, "Testar Shadow P2").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(view.textContent).toContain("Execução P2 com confirmação pendente");
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(view.textContent).toContain("Verificar no histórico antes de reenviar");
  });

  it("keeps candidate generation separate from the P2 opt-in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(404, { error: "candidate_disabled" })));
    const view = renderPage();
    writeQuestion(view, "Qual foi o total financeiro?");
    await act(async () => {
      view.querySelector("form")?.dispatchEvent(new Event("submit", {
        bubbles: true, cancelable: true
      }));
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/admin/candidate-generate");
    expect((options as RequestInit).headers).toEqual({
      "Content-Type": "application/json"
    });
  });
});
