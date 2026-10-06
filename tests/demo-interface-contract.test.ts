import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ALLOWED_AGENT_PROFILES } from "@/lib/admin-users";

describe("DEMO commercial interface contract", () => {
  it("keeps the approved profile set explicit and complete", () => {
    expect(ALLOWED_AGENT_PROFILES).toEqual([
      "admin",
      "diretoria",
      "financeiro",
      "auditoria",
      "comercial"
    ]);
  });

  it("uses response content, not frontend environment flags, to select DEMO combined behavior", async () => {
    const source = await readFile("app/page.tsx", "utf8");

    expect(source).not.toContain("AGENT_INTERFACE_MODE");
    expect(source).toContain("generation.response?.execution_result");
    expect(source).toContain("allowLocalFallback={!isCombinedBackendExecution}");
    expect(source).toContain("execution.response?.success !== true");
    expect(source).toContain("const hasSuccessfulExecution = execution.response?.success === true");
  });

  it("prioritizes backend executive content for combined DEMO results and preserves official fallback", async () => {
    const source = await readFile("app/page.tsx", "utf8");

    expect(source).toContain("backendExecutiveSummary");
    expect(source).toContain("execution.response?.relatorio_executivo");
    expect(source).toContain("execution.response?.executive_summary");
    expect(source).toContain(
      "backendExecutiveSummary ?? (!isCombinedBackendExecution ? executiveSummary : null)"
    );
  });

  it("keeps ordinary commercial labels on the main interface", async () => {
    const pageSource = await readFile("app/page.tsx", "utf8");
    const summarySource = await readFile("components/ExecutiveSummary.tsx", "utf8");
    const actionsSource = await readFile("components/ExecutiveReportActions.tsx", "utf8");

    expect(pageSource).toContain("Agente Financeiro");
    expect(pageSource).toContain("Grupo Horizonte");
    expect(pageSource).toContain("Inteligência para conversar com seus dados.");
    expect(summarySource).toContain("Resposta executiva");
    expect(actionsSource).toContain("Resposta executiva");
    expect(pageSource).toContain("Resultados");
    expect(pageSource).toContain("Histórico");
  });

  it("loads a versioned LLM catalog and sends the selected provider contract", async () => {
    const pageSource = await readFile("app/page.tsx", "utf8");
    const questionSource = await readFile("components/QuestionInput.tsx", "utf8");
    const routeSource = await readFile("app/api/generate-sql/route.ts", "utf8");

    expect(pageSource).toContain("/api/llm-models?target=shadow");
    expect(pageSource).toContain("provider_key: selectedLlmModel.provider_key");
    expect(pageSource).toContain("model_key: selectedLlmModel.model_key");
    expect(pageSource).toContain("config_version: selectedLlmModel.config_version");
    expect(questionSource).toContain("Modelo de IA");
    expect(questionSource).toContain("indisponível neste fluxo");
    expect(routeSource).toContain("resolveLlmSelection");
    expect(routeSource).toContain("llm_registry_version");
    expect(routeSource).toContain("llm_selection: resolvedLlmSelection.selection");
  });

  it("lets the client persist a preferred authorized LLM", async () => {
    const pageSource = await readFile("app/page.tsx", "utf8");
    const settingsSource = await readFile("components/InterfaceSettingsPanel.tsx", "utf8");
    const storageSource = await readFile("lib/interface-settings.ts", "utf8");

    expect(settingsSource).toContain("Configuração de IA");
    expect(settingsSource).toContain("Modelo de IA padrão");
    expect(settingsSource).toContain("model.available_for_target");
    expect(storageSource).toContain("defaultLlmModelId");
    expect(pageSource).toContain("interfaceSettings.defaultLlmModelId");
    expect(pageSource).toContain("preferredModel");
  });

  it("preserves explicit cache reuse without suggesting a fixed question lookup", async () => {
    const source = await readFile("components/QuestionInput.tsx", "utf8");

    expect(source).toContain("Reaproveitar análises já processadas");
    expect(source).toContain(
      "Usa resultados previamente processados quando houver correspondência válida"
    );
    expect(source).not.toContain("Reaproveitar análises conhecidas");
    expect(source).not.toContain("Usa consultas já aprovadas para perguntas recorrentes");
  });

  it("keeps admin operational panels controlled by existing capabilities", async () => {
    const source = await readFile("app/page.tsx", "utf8");

    expect(source).toContain("const showWhatsAppOperationalTool = canManageOperationalTools");
    expect(source).toContain("const showInterfaceSettingsTool = canManageOperationalTools");
    expect(source).toContain("const showDiagnosticsTool = canAuditOperationalTools");
    expect(source).toContain("const showBenchmarkTool = canAuditOperationalTools");
    expect(source).toContain("Ferramentas operacionais");
    expect(source).toContain("Demonstração WhatsApp");
    expect(source).toContain("Configurações da interface");
    expect(source).toContain("Diagnóstico do agente");
    expect(source).toContain("Benchmark e homologação");
  });

  it("does not render second execution controls after a successful execution", async () => {
    const source = await readFile("app/page.tsx", "utf8");

    expect(source).toContain("!hasSuccessfulExecution ? (");
    expect(source).toContain("execution.response?.success !== true");
    expect(source).toContain("ResultModeTabs");
    expect(source).toContain("ManualWatsonResultInput");
  });

  it("keeps technical status details out of the commercial status cards", async () => {
    const source = await readFile("app/page.tsx", "utf8");

    expect(source).toContain('label: "Tipo de análise"');
    expect(source).toContain('value: "Identificada"');
    expect(source).toMatch(/hasSuccessfulExecution\s+\?\s+"Concluído"/);
    expect(source).toContain("displayAgentVersion");
    expect(source).toContain("...(displayAgentVersion");
    expect(source).toContain("canSeeTechnicalDetails");
    expect(source).not.toContain('value: hasDetectedIntent ? detectedIntent : "Não detectada"');
  });
});
