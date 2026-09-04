import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LlmUsageSummary } from "@/components/LlmUsageSummary";

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
});

describe("LlmUsageSummary", () => {
  it("renders normal AI generation usage", () => {
    const view = render(
      <LlmUsageSummary
        llmModel="gemini-2.5-flash"
        llmPromptTokens={1000}
        llmCompletionTokens={250}
        llmTotalTokens={1250}
        sqlCacheHit={false}
      />
    );

    expect(view.textContent).toContain("Consulta gerada pela IA");
    expect(view.textContent).toContain("1.250");
    expect(view.textContent).toContain("Cache não utilizado");
  });

  it("renders cache hit with used tokens as zero and saved tokens", () => {
    const view = render(
      <LlmUsageSummary
        llmModel="gemini-2.5-flash"
        llmTotalTokens={0}
        sqlCacheHit
        sqlCacheSavedTotalTokens={1250}
      />
    );

    expect(view.textContent).toContain("Consulta recuperada do cache");
    expect(view.textContent).toContain("Tokens usados agora");
    expect(view.textContent).toContain("1.250");
  });

  it("does not break when usage is unavailable", () => {
    const view = render(<LlmUsageSummary />);

    expect(view.textContent).toContain("Consumo de IA não disponível");
  });

  it("does not render monetary values when estimate is null", () => {
    const view = render(
      <LlmUsageSummary
        llmModel="gemini-2.5-flash"
        llmPromptTokens={1000}
        llmCompletionTokens={250}
        llmTotalTokens={1250}
        estimatedCostUsd={null}
        sqlCacheHit={false}
      />
    );

    expect(view.textContent).not.toContain("Custo estimado");
  });
});
