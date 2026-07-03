import { askDuckLakeAgent } from "./ducklake-agent-client.js";
import {
  formatSavedReportsList,
  formatWhatsAppMarkdown,
  formatWhatsAppReport,
  normalizeText
} from "./message-formatting.js";
import { listReportsByUser, saveReport, storageFile } from "./report-storage.js";
import {
  isAllowedNumber,
  isAuthorizationListActive,
  maskPhoneNumber,
  normalizePhoneNumber
} from "./security.js";
import { isWhatsAppConfigured } from "./whatsapp-client.js";
import type { DuckLakeAgentResult, SavedWhatsAppReport } from "./types.js";

export type WhatsAppProvider = "debug" | "meta" | "webjs";

const pendingReports = new Map<string, SavedWhatsAppReport>();

function makePendingReport(
  result: DuckLakeAgentResult,
  phoneNumber: string,
  whatsappName?: string
): SavedWhatsAppReport {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  return {
    id: crypto.randomUUID(),
    whatsappUserId: normalizedPhone,
    whatsappName,
    phoneNumber: normalizedPhone,
    queryId: result.queryId,
    question: result.question,
    markdown: result.markdown,
    summary: result.summary,
    columns: result.columns,
    dataPreview: result.data.slice(0, 10),
    rowCount: result.rowCount,
    executionTimeMs: result.executionTimeMs,
    createdAt: new Date().toISOString()
  };
}

function helpMessage() {
  return `*Comandos disponiveis*

- Digite uma pergunta financeira
- salvar - salva o ultimo relatorio
- markdown - envia o markdown do ultimo relatorio
- meus relatorios - lista relatorios salvos
- status - mostra o status do bot
- ajuda - mostra esta ajuda

Exemplos:
- Quais as contas que tiveram maiores estouros de orcamento no mes?
- Qual foi a principal variacao entre orcado e realizado?
- Monte uma tabela com os resultados do mes por marca`;
}

function statusMessage(phoneNumber: string, source: WhatsAppProvider) {
  const endpointConfigured = Boolean(process.env.DUCKLAKE_AGENT_ENDPOINT);
  const allowed = isAllowedNumber(phoneNumber);
  const authorizationMode = isAuthorizationListActive()
    ? allowed
      ? "numero autorizado"
      : "numero nao autorizado"
    : "lista livre em desenvolvimento";

  return `*Status do bot*

- Bot online
- Provider: ${source}
- Endpoint do agente configurado: ${endpointConfigured ? "sim" : "usando padrao"}
- WhatsApp configurado: ${isWhatsAppConfigured() ? "sim" : "nao"}
- Storage local: ${storageFile()}
- Autorizacao: ${authorizationMode}`;
}

function isHelpCommand(text: string) {
  return text === "ajuda" || text === "help";
}

function isSavedReportsCommand(text: string) {
  return text === "meus relatorios" || text === "meus relatórios";
}

async function handleCommand(text: string, from: string, source: WhatsAppProvider) {
  if (isHelpCommand(text)) {
    return helpMessage();
  }

  if (text === "status") {
    return statusMessage(from, source);
  }

  if (text === "salvar") {
    const pending = pendingReports.get(normalizePhoneNumber(from));
    if (!pending) {
      return "Nao encontrei relatorio recente para salvar. Envie uma pergunta primeiro.";
    }

    await saveReport(pending);
    return "Relatorio salvo com sucesso. Para listar, envie: meus relatorios";
  }

  if (text === "markdown") {
    const pending = pendingReports.get(normalizePhoneNumber(from));
    if (!pending) {
      return "Nao encontrei relatorio recente para enviar. Envie uma pergunta primeiro.";
    }

    return formatWhatsAppMarkdown(pending.markdown);
  }

  if (isSavedReportsCommand(text)) {
    const reports = await listReportsByUser(normalizePhoneNumber(from), 5);
    return formatSavedReportsList(reports);
  }

  return null;
}

export async function handleIncomingWhatsAppText(input: {
  from: string;
  text: string;
  displayName?: string;
  source: WhatsAppProvider;
}): Promise<{ success: boolean; response: string }> {
  const from = normalizePhoneNumber(input.from);
  const text = normalizeText(input.text || "");

  if (!isAllowedNumber(from)) {
    return {
      success: false,
      response: "Este numero nao esta autorizado a usar o Agente SQL Financeiro DuckLake."
    };
  }

  if (!text) {
    return {
      success: false,
      response: "Envie uma pergunta financeira em texto para iniciar."
    };
  }

  const commandResponse = await handleCommand(text.toLowerCase(), from, input.source);
  if (commandResponse) {
    return {
      success: true,
      response: commandResponse
    };
  }

  const result = await askDuckLakeAgent(text);
  const pending = makePendingReport(result, from, input.displayName);
  pendingReports.set(from, pending);

  console.log(
    JSON.stringify({
      event: "ducklake_whatsapp_report",
      source: input.source,
      phone: maskPhoneNumber(from),
      queryId: result.queryId,
      intent: result.intent,
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
      success: result.executeResponse.success
    })
  );

  return {
    success: true,
    response: formatWhatsAppReport(result)
  };
}
