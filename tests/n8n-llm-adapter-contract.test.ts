import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getLlmRegistryEnvironment,
  resolveLlmSelection
} from "@/lib/llm-provider-registry";

describe("n8n LLM adapter contract", () => {
  it("sends only safe runtime configuration to orchestration", () => {
    const resolved = resolveLlmSelection({
      environment: getLlmRegistryEnvironment(),
      target: "official",
      profile: "admin"
    });

    const serialized = JSON.stringify(resolved.runtime);

    expect(serialized).toContain("adapter_type");
    expect(serialized).toContain("model_key");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("base_url");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
  });

  it("keeps adapter artifacts structural and secret-free", async () => {
    const files = await Promise.all([
      readFile("docs/n8n/code-resolver-adapter-llm.js", "utf8"),
      readFile("docs/n8n/code-body-openai-compatible.js", "utf8"),
      readFile("docs/n8n/code-normalizar-resposta-llm.js", "utf8"),
      readFile("docs/n8n/llm-adapter-v1.md", "utf8")
    ]);

    const source = files.join("\n").toLowerCase();

    expect(source).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(source).not.toContain("bearer sk-");
    expect(source).not.toContain("gold_lancamentos_contabeis");
    expect(source).not.toContain("grupo_dre");
    expect(source).not.toContain("centro_custo");
    expect(source).not.toContain("estouro_orcamento");
  });

  it("supports protocols rather than provider-specific question logic", async () => {
    const source = await readFile(
      "docs/n8n/code-resolver-adapter-llm.js",
      "utf8"
    );

    expect(source).toContain("gemini_generate_content");
    expect(source).toContain("openai_compatible_chat");
    expect(source).not.toContain("pergunta");
    expect(source).not.toContain("detected_intent");
    expect(source).not.toContain("benchmark");
  });
});
