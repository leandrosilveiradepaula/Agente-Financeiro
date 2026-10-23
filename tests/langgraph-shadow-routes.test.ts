import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const generateRoute = readFileSync(
  join(root, "app/api/generate-sql/route.ts"),
  "utf8"
).replace(/\r\n/g, "\n");
const executeRoute = readFileSync(
  join(root, "app/api/execute-watson/route.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("LangGraph shadow route integration", () => {
  it("uses Node runtime and framework after() for generate shadow dispatch", () => {
    expect(generateRoute).toContain('export const runtime = "nodejs"');
    expect(generateRoute).toContain('import { after, NextResponse } from "next/server"');
    expect(generateRoute).toContain("after(async () =>");
    expect(generateRoute).toContain("dispatchLangGraphGenerateShadow({");
    expect(generateRoute).toContain("isLangGraphShadowEnabled()");
    expect(generateRoute).not.toContain("void fetch");
  });

  it("keeps generate response independent from shadow status", () => {
    const responsePayloadBlock = sliceBetween(
      generateRoute,
      "const responsePayload: GenerateSqlResponse =",
      "\n    };\n"
    );

    expect(generateRoute).toContain("const responsePayload: GenerateSqlResponse =");
    expect(generateRoute).toContain("return NextResponse.json(responsePayload)");
    expect(generateRoute).toContain("isShadowPhaseOneProviderMatch(");
    expect(responsePayloadBlock).not.toMatch(/shadow|langgraph/i);
  });

  it("sends the product agent_run_id and question to generate shadow", () => {
    expect(generateRoute).toContain("agentRunId: agentRun.id");
    expect(generateRoute).toContain("question: pergunta");
    expect(generateRoute).toContain("principal");
  });

  it("uses Node runtime and framework after() for execute-approved shadow dispatch", () => {
    expect(executeRoute).toContain('export const runtime = "nodejs"');
    expect(executeRoute).toContain('import { after, NextResponse } from "next/server"');
    expect(executeRoute).toContain("after(async () =>");
    expect(executeRoute).toContain("dispatchLangGraphExecuteApprovedShadow({");
    expect(executeRoute).toContain("isLangGraphShadowEnabled()");
    expect(executeRoute).not.toContain("void fetch");
  });

  it("sends approved SQL unchanged to execute-approved shadow", () => {
    expect(executeRoute).toContain("approvedSql: sql");
    expect(executeRoute).toContain("agentRunId");
    expect(executeRoute).not.toContain("approvedSql: sql.trim()");
  });

  it("keeps execute response independent from shadow status", () => {
    const responsePayloadBlock = sliceBetween(
      executeRoute,
      "const responsePayload =",
      "if (agentRunId && isLangGraphShadowEnabled())"
    );

    expect(executeRoute).toContain("const responsePayload =");
    expect(executeRoute).toContain("return NextResponse.json(responsePayload)");
    expect(responsePayloadBlock).not.toMatch(/shadow|langgraph/i);
  });
});
