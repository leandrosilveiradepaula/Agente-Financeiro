import "dotenv/config";
import express from "express";
import {
  DEMO_QUESTIONS,
  buildWhatsAppDemoLink,
  demoConfigFromEnv,
  generateQrPngBuffer,
  getDemoMessageText,
  getDemoQuestion,
  renderDemoHtml
} from "./demo-qr.js";
import { storageFile } from "./report-storage.js";
import {
  maskPhoneNumber,
  normalizePhoneNumber,
  type RawBodyRequest,
  validateMetaSignature
} from "./security.js";
import type { WhatsAppInboundMessage } from "./types.js";
import { verifyWebhook } from "./webhook-verification.js";
import { isWhatsAppConfigured, sendWhatsAppTextMessage } from "./whatsapp-client.js";
import { handleIncomingWhatsAppText } from "./whatsapp-message-handler.js";
import { getWhatsAppSafetyConfig } from "./whatsapp-safety.js";
import { getWebJsStatus, startWhatsAppWebJsClient } from "./whatsapp-webjs-client.js";

const app = express();
const port = Number(process.env.WHATSAPP_PORT || 3980);
const provider = process.env.WHATSAPP_PROVIDER || "debug";

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buf);
    }
  })
);

function firstQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }

  return typeof value === "string" ? value : "";
}

function buildDemoPayload(query: Record<string, unknown>) {
  const { phoneNumber, title, subtitle } = demoConfigFromEnv();
  const questionId = firstQueryValue(query.questionId);
  const customText = firstQueryValue(query.text);
  const question = getDemoQuestion(questionId, customText);
  const messageText = getDemoMessageText(question);
  const url = phoneNumber ? buildWhatsAppDemoLink({ phoneNumber, text: question }) : "";
  const search = new URLSearchParams();

  if (customText) {
    search.set("text", customText);
  } else if (questionId) {
    search.set("questionId", questionId);
  }

  const qrImagePath = `/demo/qr.png${search.toString() ? `?${search.toString()}` : ""}`;

  return { phoneNumber, title, subtitle, question, messageText, url, qrImagePath };
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
    const result = await handleIncomingWhatsAppText({
      from: message.from,
      text: message.text || "",
      displayName: message.name,
      source: "meta"
    });
    await sendWhatsAppTextMessage(message.from, result.response);
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

app.get("/demo", (req, res) => {
  const payload = buildDemoPayload(req.query);

  if (!payload.phoneNumber) {
    return res
      .status(500)
      .type("html")
      .send(
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Demonstração WhatsApp</title></head><body><main style="font-family:system-ui;padding:32px"><h1>Número do robô não configurado.</h1><p>Configure DEMO_BOT_PHONE_NUMBER no .env do whatsapp-bot.</p></main></body></html>'
      );
  }

  return res.type("html").send(renderDemoHtml(payload));
});

app.get("/demo/qr.png", async (req, res) => {
  const payload = buildDemoPayload(req.query);

  if (!payload.phoneNumber) {
    return res.status(500).type("text/plain").send("Número do robô não configurado.");
  }

  const png = await generateQrPngBuffer(payload.url);
  res.setHeader("Cache-Control", "no-store");
  return res.type("png").send(png);
});

app.get("/demo/link", (req, res) => {
  const payload = buildDemoPayload(req.query);

  if (!payload.phoneNumber) {
    return res.status(500).json({
      error: "Número do robô não configurado."
    });
  }

  return res.json({
    url: payload.url,
    phoneNumber: payload.phoneNumber,
    question: payload.question
  });
});

app.get("/demo/questions", (_req, res) => {
  res.json(DEMO_QUESTIONS);
});

app.get("/health", (_req, res) => {
  const webjsStatus = getWebJsStatus();
  const safety = getWhatsAppSafetyConfig();

  res.json({
    status: "ok",
    provider,
    agentEndpointConfigured: Boolean(process.env.DUCKLAKE_AGENT_ENDPOINT),
    whatsappConfigured: isWhatsAppConfigured(),
    webjsReady: provider === "webjs" ? webjsStatus.ready : false,
    webjsInboundEnabled: safety.inboundEnabled,
    webjsDryRun: safety.dryRun,
    webjsRequireTrigger: safety.requireTrigger,
    webjsTriggerPrefix: safety.triggerPrefix,
    webjsAllowedNumbersCount: safety.allowedNumbersCount,
    storage: storageFile()
  });
});

app.get("/webjs/status", (_req, res) => {
  const webjsStatus = getWebJsStatus();
  const safety = getWhatsAppSafetyConfig();

  res.json({
    provider,
    ready: provider === "webjs" ? webjsStatus.ready : false,
    authenticated: provider === "webjs" ? webjsStatus.authenticated : false,
    webjsInboundEnabled: safety.inboundEnabled,
    webjsDryRun: safety.dryRun,
    webjsRequireTrigger: safety.requireTrigger,
    webjsTriggerPrefix: safety.triggerPrefix,
    webjsAllowedNumbersCount: safety.allowedNumbersCount
  });
});

app.get("/webjs/safety", (_req, res) => {
  const safety = getWhatsAppSafetyConfig();

  res.json({
    provider,
    inboundEnabled: safety.inboundEnabled,
    dryRun: safety.dryRun,
    requireTrigger: safety.requireTrigger,
    triggerPrefix: safety.triggerPrefix,
    allowedNumbersCount: safety.allowedNumbersCount,
    ignoreGroups: safety.ignoreGroups
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
    const result = await handleIncomingWhatsAppText({
      from,
      displayName: "Debug",
      text: question,
      source: "debug"
    });

    res.json({
      success: result.success,
      from: normalizePhoneNumber(from),
      response: result.response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Erro desconhecido"
    });
  }
});

if (provider === "webjs") {
  startWhatsAppWebJsClient();
}

app.listen(port, () => {
  console.log(`DuckLake WhatsApp bot listening on http://localhost:${port}`);
});
