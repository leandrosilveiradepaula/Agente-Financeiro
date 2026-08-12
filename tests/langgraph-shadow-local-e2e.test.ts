import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { once } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  requireAgentSession: vi.fn(),
  getRequestMetadata: vi.fn(),
  createAgentRun: vi.fn(),
  getAgentRunById: vi.fn(),
  markAgentRunBlocked: vi.fn(),
  updateAgentRunGeneratedSql: vi.fn(),
  updateAgentRunExecution: vi.fn(),
  findLatestComparableLlmRunForCacheSavings: vi.fn(),
  enforceCanGenerateSql: vi.fn(),
  enforceCanExecuteSql: vi.fn(),
  enforceIntentPolicy: vi.fn(),
  enforceSqlTablePolicy: vi.fn(),
  buildPolicyDeniedResponse: vi.fn(),
  loggerWarn: vi.fn()
}));

vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    routeMocks.afterCallbacks.push(callback);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body
    })
  }
}));

vi.mock("@/lib/server-auth", () => ({
  requireAgentSession: routeMocks.requireAgentSession,
  getRequestMetadata: routeMocks.getRequestMetadata
}));

vi.mock("@/lib/agent-runs", () => ({
  createAgentRun: routeMocks.createAgentRun,
  getAgentRunById: routeMocks.getAgentRunById,
  markAgentRunBlocked: routeMocks.markAgentRunBlocked,
  updateAgentRunGeneratedSql: routeMocks.updateAgentRunGeneratedSql,
  updateAgentRunExecution: routeMocks.updateAgentRunExecution,
  findLatestComparableLlmRunForCacheSavings:
    routeMocks.findLatestComparableLlmRunForCacheSavings
}));

vi.mock("@/lib/profile-policy", () => ({
  enforceCanGenerateSql: routeMocks.enforceCanGenerateSql,
  enforceCanExecuteSql: routeMocks.enforceCanExecuteSql,
  enforceIntentPolicy: routeMocks.enforceIntentPolicy,
  enforceSqlTablePolicy: routeMocks.enforceSqlTablePolicy,
  buildPolicyDeniedResponse: routeMocks.buildPolicyDeniedResponse
}));

vi.mock("@/lib/n8n-endpoint", () => ({
  N8N_WATSON_ORCHESTRATE_ENDPOINT: "http://n8n.test/webhook"
}));

vi.mock("@/lib/server-logger", () => ({
  logger: {
    info: vi.fn(),
    warn: routeMocks.loggerWarn,
    error: vi.fn()
  }
}));

const LANGGRAPH_REPO =
  process.env.LANGGRAPH_REPO_DIR ||
  "C:\\Users\\Leandro Silveira\\Documents\\agente-sql-langgraph";
const PYTHON_EXECUTABLE =
  process.env.PYTHON_EXECUTABLE ||
  "C:\\Users\\Leandro Silveira\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const AGENT_RUN_ID = "11111111-1111-4111-8111-111111111111";
const APPROVED_SQL = "SELECT id FROM schema_test.table_test";
const LANGGRAPH_S2S_TOKEN = "test-local-s2s-token";

type LocalLangGraphServer = {
  process: ChildProcess;
  baseUrl: string;
};

const session = {
  sessionId: "session-1",
  userId: "user-1",
  name: "User One",
  email: "user@example.invalid",
  userProfile: "admin"
};

const policy = {
  can_view_sql: true,
  allowed_tables: [],
  denied_tables: []
};

function resetRouteMocks() {
  vi.resetModules();
  vi.stubEnv("N8N_INTERNAL_WEBHOOK_TOKEN", "test-token");
  vi.stubEnv("LANGGRAPH_SHADOW_ENABLED", "true");
  vi.stubEnv("LANGGRAPH_SHADOW_TIMEOUT_MS", "500");
  vi.stubEnv("LANGGRAPH_S2S_TOKEN", LANGGRAPH_S2S_TOKEN);
  routeMocks.afterCallbacks.length = 0;
  routeMocks.loggerWarn.mockReset();
  routeMocks.requireAgentSession.mockResolvedValue({ session, response: null });
  routeMocks.getRequestMetadata.mockResolvedValue({
    ipAddress: "127.0.0.1",
    userAgent: "vitest"
  });
  routeMocks.createAgentRun.mockResolvedValue({
    id: AGENT_RUN_ID,
    run_id: AGENT_RUN_ID
  });
  routeMocks.getAgentRunById.mockResolvedValue({
    id: AGENT_RUN_ID,
    sql_generated: APPROVED_SQL
  });
  routeMocks.markAgentRunBlocked.mockResolvedValue(undefined);
  routeMocks.updateAgentRunGeneratedSql.mockResolvedValue(undefined);
  routeMocks.updateAgentRunExecution.mockResolvedValue(undefined);
  routeMocks.findLatestComparableLlmRunForCacheSavings.mockResolvedValue(null);
  routeMocks.enforceCanGenerateSql.mockResolvedValue({
    allowed: true,
    policy,
    reason: null
  });
  routeMocks.enforceCanExecuteSql.mockResolvedValue({
    allowed: true,
    policy,
    reason: null
  });
  routeMocks.enforceIntentPolicy.mockReturnValue({ allowed: true, reason: null });
  routeMocks.enforceSqlTablePolicy.mockReturnValue({
    allowed: true,
    reason: null,
    blockedTable: null,
    extractedTables: []
  });
  routeMocks.buildPolicyDeniedResponse.mockReturnValue({
    success: false,
    error: "policy_denied"
  });
}

function installNetworkGuard() {
  const realFetch = globalThis.fetch.bind(globalThis);
  const blockedHosts: string[] = [];
  const guardedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url
    );

    if (url.hostname === "n8n.test") {
      return officialN8nResponse(url.pathname);
    }

    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return realFetch(input, init);
    }

    blockedHosts.push(url.hostname);
    throw new Error("NETWORK_BLOCKED_NON_LOCALHOST");
  });

  vi.stubGlobal("fetch", guardedFetch);
  return { blockedHosts, guardedFetch };
}

function officialN8nResponse(path: string) {
  if (path !== "/webhook") {
    throw new Error("Unexpected mocked n8n path.");
  }

  return Promise.resolve(
    new Response(
      JSON.stringify({
        success: true,
        sql: APPROVED_SQL,
        agent_version: "official-n8n-version",
        detected_intent: "resultado_por_marca",
        validation_status: "aprovado",
        query_id: "query-1",
        execution_time_ms: 12,
        row_count: 1,
        columns: ["id"],
        data: [{ id: 1 }],
        raw: { source: "mocked-n8n" },
        truncated: false
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    )
  );
}

async function startLangGraphServer(): Promise<LocalLangGraphServer> {
  const child = spawn(
    PYTHON_EXECUTABLE,
    ["-m", "app.local_testing.internal_sql_agent_v1_local_server", "--port", "0"],
    {
      cwd: LANGGRAPH_REPO,
      env: {
        ...process.env,
        LANGGRAPH_LOCAL_TEST_ONLY: "1",
        LANGGRAPH_LOCAL_TEST_HOST: "127.0.0.1",
        LANGGRAPH_S2S_TOKEN,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUTF8: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const ready = await waitForReady(child);

  return {
    process: child,
    baseUrl: `http://${ready.host}:${ready.port}`
  };
}

async function waitForReady(child: ChildProcess) {
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const line = stdout
      .split(/\r?\n/)
      .find((item) => item.includes("langgraph_local_shadow_ready"));
    if (line) {
      return JSON.parse(line) as { host: string; port: number };
    }
    if (child.exitCode !== null) {
      throw new Error(`LangGraph local server exited: ${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  child.kill();
  throw new Error(`LangGraph local server did not start: ${stderr}`);
}

async function stopLangGraphServer(server: LocalLangGraphServer) {
  server.process.kill();
  await Promise.race([
    once(server.process, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1000))
  ]);
}

async function closeServer(server: Server) {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function readLangGraphRecords(baseUrl: string) {
  const response = await fetch(
    `${baseUrl}/__local-test/records?agent_run_id=${AGENT_RUN_ID}`
  );
  return (await response.json()) as {
    records: Array<Record<string, unknown>>;
  };
}

async function readReceivedRequests(baseUrl: string) {
  const response = await fetch(`${baseUrl}/__local-test/received-requests`);
  return (await response.json()) as {
    requests: Array<Record<string, unknown>>;
  };
}

async function callGenerateRoute(baseUrl: string) {
  resetRouteMocks();
  vi.stubEnv("LANGGRAPH_INTERNAL_BASE_URL", baseUrl);
  const { POST } = await import("@/app/api/generate-sql/route");
  const response = await POST(
    new Request("http://localhost/api/generate-sql", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Execute uma generic analysis de teste."
      })
    })
  );

  return {
    body: await response.json(),
    status: response.status
  };
}

async function callExecuteRoute(baseUrl: string) {
  resetRouteMocks();
  vi.stubEnv("LANGGRAPH_INTERNAL_BASE_URL", baseUrl);
  const { POST } = await import("@/app/api/execute-watson/route");
  const response = await POST(
    new Request("http://localhost/api/execute-watson", {
      method: "POST",
      body: JSON.stringify({
        pergunta: "Execute a SQL aprovada",
        sql: APPROVED_SQL,
        agent_run_id: AGENT_RUN_ID
      })
    })
  );

  return {
    body: await response.json(),
    status: response.status
  };
}

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local test server address unavailable.");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("LangGraph local shadow E2E", () => {
  beforeEach(() => {
    resetRouteMocks();
  });

  it("dispatches generate and execute shadows to local LangGraph and persists 1:N evidence", async () => {
    const server = await startLangGraphServer();
    const { blockedHosts } = installNetworkGuard();

    try {
      const generate = await callGenerateRoute(server.baseUrl);
      await routeMocks.afterCallbacks[0]();
      const execute = await callExecuteRoute(server.baseUrl);
      await routeMocks.afterCallbacks[0]();
      const records = (await readLangGraphRecords(server.baseUrl)).records;
      const requests = (await readReceivedRequests(server.baseUrl)).requests;

      expect(generate.status).toBe(200);
      expect(generate.body).toMatchObject({
        success: true,
        sql: APPROVED_SQL,
        agent_run_id: AGENT_RUN_ID,
        run_id: AGENT_RUN_ID
      });
      expect(execute.status).toBe(200);
      expect(execute.body).toMatchObject({
        success: true,
        agent_run_id: AGENT_RUN_ID,
        run_id: AGENT_RUN_ID,
        row_count: 1
      });
      expect(records).toHaveLength(2);
      expect(new Set(records.map((record) => record.event_type))).toEqual(
        new Set(["generate", "execute_approved_shadow"])
      );
      expect(new Set(records.map((record) => record.agent_run_id))).toEqual(
        new Set([AGENT_RUN_ID])
      );
      expect(new Set(records.map((record) => record.run_id)).size).toBe(2);
      expect(new Set(records.map((record) => record.shadow_record_id)).size).toBe(2);
      expect(records.find((record) => record.event_type === "generate")).toMatchObject({
        question: "Execute uma generic analysis de teste.",
        generated_sql: APPROVED_SQL,
        preflight_executed: false
      });
      expect(
        records.find((record) => record.event_type === "execute_approved_shadow")
      ).toMatchObject({
        approved_sql_original: APPROVED_SQL,
        requires_reapproval: false,
        preflight_executed: false
      });
      expect(requests[0]).toMatchObject({
        contract_version: "1",
        agent_run_id: AGENT_RUN_ID,
        question: "Execute uma generic analysis de teste.",
        principal: {
          id: "user-1",
          email: "user@example.invalid",
          profile: "admin"
        }
      });
      expect(requests[1]).toMatchObject({
        contract_version: "1",
        agent_run_id: AGENT_RUN_ID,
        approved_sql: APPROVED_SQL,
        principal: {
          id: "user-1",
          email: "user@example.invalid",
          profile: "admin"
        }
      });
      expect(JSON.stringify(requests).toLowerCase()).not.toContain("authorization");
      expect(JSON.stringify(requests)).not.toContain(LANGGRAPH_S2S_TOKEN);
      expect(JSON.stringify(requests).toLowerCase()).not.toContain("cookie");
      expect(JSON.stringify(requests).toLowerCase()).not.toContain("session");
      expect(JSON.stringify(requests).toLowerCase()).not.toContain("credentials");
      expect(blockedHosts).toEqual([]);
    } finally {
      await stopLangGraphServer(server);
    }
  });

  it("keeps official responses intact when LangGraph is offline", async () => {
    const { blockedHosts } = installNetworkGuard();
    const generate = await callGenerateRoute("http://127.0.0.1:9");
    await routeMocks.afterCallbacks[0]();
    const execute = await callExecuteRoute("http://127.0.0.1:9");
    await routeMocks.afterCallbacks[0]();

    expect(generate.body).toMatchObject({
      success: true,
      agent_run_id: AGENT_RUN_ID
    });
    expect(execute.body).toMatchObject({
      success: true,
      agent_run_id: AGENT_RUN_ID
    });
    expect(routeMocks.loggerWarn).toHaveBeenCalled();
    expect(blockedHosts).toEqual([]);
  });

  it("keeps official response intact when S2S token is missing", async () => {
    const { blockedHosts } = installNetworkGuard();
    const generate = await callGenerateRoute("http://127.0.0.1:9");
    vi.stubEnv("LANGGRAPH_S2S_TOKEN", "");
    await routeMocks.afterCallbacks[0]();

    expect(generate.body).toMatchObject({
      success: true,
      agent_run_id: AGENT_RUN_ID
    });
    expect(routeMocks.loggerWarn).toHaveBeenCalledWith(
      "generate_sql.langgraph_shadow_failed",
      expect.objectContaining({
        status: "configuration_error"
      })
    );
    expect(blockedHosts).toEqual([]);
  });

  it("keeps official response intact when local LangGraph returns HTTP 500", async () => {
    const failingServer = createServer((_request, response) => {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end("{}");
    });
    const baseUrl = await listen(failingServer);
    const { blockedHosts } = installNetworkGuard();

    try {
      const generate = await callGenerateRoute(baseUrl);
      await routeMocks.afterCallbacks[0]();

      expect(generate.body).toMatchObject({
        success: true,
        agent_run_id: AGENT_RUN_ID
      });
      expect(routeMocks.loggerWarn).toHaveBeenCalledWith(
        "generate_sql.langgraph_shadow_failed",
        expect.objectContaining({
          status: "http_error",
          httpStatus: 500
        })
      );
      expect(blockedHosts).toEqual([]);
    } finally {
      await closeServer(failingServer);
    }
  });

  it("keeps official response intact when local LangGraph times out", async () => {
    const slowServer = createServer((_request, response) => {
      setTimeout(() => {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end("{}");
      }, 250);
    });
    const baseUrl = await listen(slowServer);
    const { blockedHosts } = installNetworkGuard();

    try {
      const execute = await callExecuteRoute(baseUrl);
      vi.stubEnv("LANGGRAPH_SHADOW_TIMEOUT_MS", "100");
      await routeMocks.afterCallbacks[0]();

      expect(execute.body).toMatchObject({
        success: true,
        agent_run_id: AGENT_RUN_ID
      });
      expect(routeMocks.loggerWarn).toHaveBeenCalledWith(
        "execute_watson.langgraph_shadow_failed",
        expect.objectContaining({
          status: "timeout"
        })
      );
      expect(blockedHosts).toEqual([]);
    } finally {
      await closeServer(slowServer);
    }
  });
});
