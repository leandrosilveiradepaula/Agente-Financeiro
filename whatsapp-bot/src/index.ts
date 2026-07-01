import "dotenv/config";
import express from "express";
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
  normalizePhoneNumber,
  type RawBodyRequest,
  validateMetaSignature
} from "./security.js";
import type { DuckLakeAgentResult, SavedWhatsAppReport, WhatsAppInboundMessage } from "./types.js";
import { verifyWebhook } from "./webhook-verification.js";
import { isWhatsAppConfigured, sendWhatsAppTextMessage } from "./whatsapp-client.js";

const app = express();
const port = Number(process.env.WHATSAPP_PORT || 3980);
const pendingReports = new Map<string, SavedWhatsAppReport>();

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buf);
    }
  })
);

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

function statusMessage(phoneNumber: string) {
  const endpointConfigured = Boolean(process.env.DUCKLAKE_AGENT_ENDPOINT);
  const allowed = isAllowedNumber(phoneNumber);
  const authorizationMode = isAuthorizationListActive() ? (allowed ? "numero autorizado" : "numero nao autorizado") : "lista livre em desenvolvimento";

  return `*Status do bot*

- Bot online
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

async function handleCommand(text: string, from: string) {
  if (isHelpCommand(text)) {
    return helpMessage();
  }

  if (text === "status") {
    return statusMessage(from);
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

export async function processIncomingTextMessage(message: WhatsAppInboundMessage) {
  const from = normalizePhoneNumber(message.from);
  const text = normalizeText(message.text || "");

  if (!isAllowedNumber(from)) {
    return "Este numero nao esta autorizado a usar o Agente SQL Financeiro DuckLake.";
  }

  if (!text) {
    return "Envie uma pergunta financeira em texto para iniciar.";
  }

  const commandResponse = await handleCommand(text.toLowerCase(), from);
  if (commandResponse) {
    return commandResponse;
  }

  const result = await askDuckLakeAgent(text);
  const pending = makePendingReport(result, from, message.name);
  pendingReports.set(from, pending);

  console.log(
    JSON.stringify({
      event: "ducklake_whatsapp_report",
      phone: maskPhoneNumber(from),
      queryId: result.queryId,
      intent: result.intent,
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
      success: result.executeResponse.success
    })
  );

  return formatWhatsAppReport(result);
}

function extractInboundMessages(payload: unknown): WhatsAppInboundMessage[] {
  const body = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
          messages?: Array<{
            from?: string;
            id?: string;
            type?: string;
            text?: { body?: string };
          }>;
          statuses?: unknown[];
        };
      }>;
    }>;
  };

  const extracted: WhatsAppInboundMessage[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value || value.statuses?.length) {
        continue;
      }

      for (const item of value.messages ?? []) {
        const contact = value.contacts?.find((candidate) => candidate.wa_id === item.from);
        extracted.push({
          from: item.from || "",
          id: item.id,
          name: contact?.profile?.name,
          type: item.type || "unknown",
          text: item.text?.body
        });
      }
    }
  }

  return extracted.filter((item) => item.from);
}

async function handleWebhookMessage(message: WhatsAppInboundMessage) {
  try {
    if (message.type !== "text") {
      await sendWhatsAppTextMessage(message.from, "Por enquanto eu entendo apenas mensagens de texto.");
      return;
    }

    await sendWhatsAppTextMessage(
      message.from,
      "Recebi sua pergunta. Vou gerar a SQL, executar a consulta e montar o relatorio executivo."
    );
    const response = await processIncomingTextMessage(message);
    await sendWhatsAppTextMessage(message.from, response);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ducklake_whatsapp_error",
        phone: maskPhoneNumber(message.from),
        error: error instanceof Error ? error.message : "Erro desconhecido"
      })
    );
    await sendWhatsAppTextMessage(
      message.from,
      "Nao consegui concluir sua solicitacao agora. Tente novamente em alguns instantes."
    ).catch(() => undefined);
  }
}

app.get("/", (_req, res) => {
  res
    .type("html")
    .send("<h1>Agente SQL Financeiro DuckLake - WhatsApp Bot</h1><p>Servico local do bot WhatsApp.</p>");
});

app.get("/privacy", (_req, res) => {
  res
    .type("html")
    .send("<h1>Privacidade</h1><p>Este MVP processa mensagens autorizadas para gerar relatorios financeiros via agente DuckLake.</p>");
});

app.get("/terms", (_req, res) => {
  res
    .type("html")
    .send("<h1>Termos</h1><p>Uso interno para consultas financeiras autorizadas. Nao envie dados fora do escopo permitido.</p>");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agentEndpointConfigured: Boolean(process.env.DUCKLAKE_AGENT_ENDPOINT),
    whatsappConfigured: isWhatsAppConfigured(),
    storage: storageFile()
  });
});

app.get("/webhook", verifyWebhook);

app.post("/webhook", (req: RawBodyRequest, res) => {
  if (!validateMetaSignature(req)) {
    return res.sendStatus(403);
  }

  const messages = extractInboundMessages(req.body);
  res.sendStatus(200);

  for (const message of messages) {
    void handleWebhookMessage(message);
  }
});

app.post("/debug/ask", async (req, res) => {
  try {
    const from = typeof req.body?.from === "string" ? req.body.from : "debug";
    const question = typeof req.body?.question === "string" ? req.body.question : "";
    const response = await processIncomingTextMessage({
      from,
      name: "Debug",
      type: "text",
      text: question
    });

    res.json({
      success: true,
      from: normalizePhoneNumber(from),
      response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Erro desconhecido"
    });
  }
});

app.listen(port, () => {
  console.log(`DuckLake WhatsApp bot listening on http://localhost:${port}`);
});
