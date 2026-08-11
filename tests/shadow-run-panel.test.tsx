import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShadowRunPanel } from "@/components/ShadowRunPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const agentRunId = "11111111-1111-4111-8111-111111111111";

const generateShadow = {
  shadow_record_id: "shadow-generate",
  agent_run_id: agentRunId,
  event_type: "generate",
  status: "completed",
  created_at: "2026-01-01T00:00:00.000Z",
  completed_at: "2026-01-01T00:00:01.000Z",
  requires_reapproval: false,
  has_repair: true,
  has_error: false
};

const executeShadow = {
  shadow_record_id: "shadow-execute",
  agent_run_id: agentRunId,
  event_type: "execute_approved",
  status: "completed",
  created_at: "2026-01-01T00:01:00.000Z",
  completed_at: "2026-01-01T00:01:01.000Z",
  requires_reapproval: true,
  has_repair: true,
  has_error: true
};

const generateVisualization = {
  contract_version: "1",
  run: generateShadow,
  steps: [
    {
      id: "step-1",
      order: 1,
      label: "engine_preflight",
      status: "success",
      metadata: {
        phase: "preflight",
        duration_ms: 12
      }
    },
    {
      id: "step-2",
      order: 2,
      label: "repair_sql",
      status: "success",
      metadata: {
        repair_attempt: 1,
        attempt: 1,
        approved_sql: "SELECT sensitive",
        question: "real question"
      }
    },
    {
      id: "step-3",
      order: 3,
      label: "repair_sql",
      status: "success",
      metadata: {
        repair_attempt: 2,
        attempt: 2
      }
    }
  ],
  edges: [],
  flags: {
    has_repair: true,
    warnings: ["repair_required"]
  }
};

const executeVisualization = {
  contract_version: "1",
  run: executeShadow,
  steps: [
    {
      id: "step-1",
      order: 1,
      label: "approved_sql_received",
      status: "success",
      metadata: {
        phase: "received"
      }
    },
    {
      id: "step-2",
      order: 2,
      label: "requires_reapproval",
      status: "repair_required",
      errors: ["shadow_step_failed"],
      metadata: {
        reason_code: "modified_after_approval"
      }
    }
  ],
  edges: [],
  flags: {
    requires_reapproval: true,
    has_repair: true,
    has_error: true,
    errors: ["safe_error_code"]
  }
};

function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  act(() => {
    root?.render(element);
  });

  return container;
}

function mockFetch(handler: (url: string) => Promise<Response>) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  });
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    mockFetch(async (url) => {
      if (url.includes("/shadow-runs?")) {
        return jsonResponse(200, { shadow_runs: [generateShadow, executeShadow] });
      }
      if (url.includes("shadow-generate")) {
        return jsonResponse(200, { visualization: generateVisualization });
      }
      if (url.includes("shadow-execute")) {
        return jsonResponse(200, { visualization: executeVisualization });
      }
      return jsonResponse(404, { error: "not_found" });
    })
  );
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
  vi.unstubAllGlobals();
});

describe("ShadowRunPanel", () => {
  it("renders loading state while the list request is pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>(() => {
            return undefined;
          })
      )
    );

    const view = render(<ShadowRunPanel agentRunId={agentRunId} />);

    expect(view.textContent).toContain("Carregando Shadow LangGraph");
  });

  it("renders empty state", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(async () => jsonResponse(200, { shadow_runs: [] }))
    );

    const view = render(<ShadowRunPanel agentRunId={agentRunId} />);

    await vi.waitFor(() => {
      expect(view.textContent).toContain("Nenhum Shadow Run encontrado");
    });
  });

  it("renders unavailable state without breaking the panel", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(async () => jsonResponse(503, { error: "shadow_unavailable" }))
    );

    const view = render(<ShadowRunPanel agentRunId={agentRunId} />);

    await vi.waitFor(() => {
      expect(view.textContent).toContain("Shadow indisponivel no momento");
    });
  });

  it("renders multiple runs and loads the selected visualization", async () => {
    const view = render(<ShadowRunPanel agentRunId={agentRunId} />);

    await vi.waitFor(() => {
      expect(view.textContent).toContain("Generate Shadow");
      expect(view.textContent).toContain("Execute Approved Shadow");
      expect(view.textContent).toContain("engine_preflight");
    });

    const executeButton = Array.from(view.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Execute Approved Shadow")
    );

    expect(executeButton).toBeTruthy();

    act(() => {
      executeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(view.textContent).toContain("approved_sql_received");
      expect(view.textContent).toContain("requires_reapproval");
    });
  });

  it("renders timeline, repairs, N repair attempts and reapproval", async () => {
    const view = render(<ShadowRunPanel agentRunId={agentRunId} />);

    await vi.waitFor(() => {
      expect(view.textContent).toContain("Timeline");
      expect(view.textContent).toContain("Repair observado");
      expect(view.textContent).toContain("Repair: 1");
      expect(view.textContent).toContain("Repair: 2");
    });

    const executeButton = Array.from(view.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Execute Approved Shadow")
    );

    act(() => {
      executeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(view.textContent).toContain("Reaprovacao necessaria");
      expect(view.textContent).toContain("safe_error_code");
      expect(view.textContent).toContain("shadow_step_failed");
    });
  });

  it("does not render blocked fields or sensitive values from metadata", async () => {
    const view = render(<ShadowRunPanel agentRunId={agentRunId} />);

    await vi.waitFor(() => {
      expect(view.textContent).toContain("repair_sql");
    });

    expect(view.textContent).not.toContain("approved_sql");
    expect(view.textContent).not.toContain("question");
    expect(view.textContent).not.toContain("SELECT sensitive");
    expect(view.textContent).not.toContain("real question");
  });
});
