import qrcodeTerminal from "qrcode-terminal";
import whatsappWeb, { type Client as WebJsClient, type Message } from "whatsapp-web.js";
import { handleIncomingWhatsAppText } from "./whatsapp-message-handler.js";
import { maskPhoneNumber, normalizePhoneNumber } from "./security.js";
import {
  evaluateWhatsAppSafety,
  getWhatsAppSafetyConfig,
  normalizePhoneCandidates,
  type WhatsAppSafetyConfig
} from "./whatsapp-safety.js";

const { Client, LocalAuth } = whatsappWeb;

type WebJsState = {
  provider: "webjs";
  ready: boolean;
  authenticated: boolean;
  lastQrAt?: string;
  lastDisconnectReason?: string;
  safety: WhatsAppSafetyConfig;
};

const state: WebJsState = {
  provider: "webjs",
  ready: false,
  authenticated: false,
  safety: getWhatsAppSafetyConfig()
};

let client: WebJsClient | null = null;
let started = false;

export function getWebJsStatus(): WebJsState {
  state.safety = getWhatsAppSafetyConfig();
  return { ...state, safety: { ...state.safety } };
}

function logBlockedMessage(phone: string, reason: string, candidates: string[] = []) {
  console.log(
    JSON.stringify({
      event: "ducklake_webjs_message_blocked",
      phone: maskPhoneNumber(phone),
      reason,
      candidateCount: candidates.length,
      candidateMasks: candidates.map(maskPhoneNumber)
    })
  );
}

function logAllowedMessage(phone: string) {
  console.log(
    JSON.stringify({
      event: "ducklake_webjs_message_allowed",
      phone: maskPhoneNumber(phone),
      reason: "allowed_number_and_trigger"
    })
  );
}

async function getContactInfo(message: Message) {
  try {
    const contact = await message.getContact();
    const idUser = typeof contact.id?.user === "string" ? contact.id.user : undefined;
    const number = typeof contact.number === "string" ? contact.number : undefined;

    return {
      displayName: contact.pushname || contact.name || undefined,
      senderCandidates: [message.from, message.author, idUser, number]
    };
  } catch {
    return {
      displayName: undefined,
      senderCandidates: [message.from, message.author]
    };
  }
}

async function handleWebJsMessage(message: Message) {
  if (message.fromMe) {
    logBlockedMessage(message.from, "from_me_ignored", normalizePhoneCandidates([message.from, message.author]));
    return;
  }

  const isGroup = message.from.endsWith("@g.us");
  const text = message.body?.trim();
  const contactInfo = await getContactInfo(message);
  const senderCandidates = normalizePhoneCandidates(contactInfo.senderCandidates);
  const primaryPhone = senderCandidates[0] || normalizePhoneNumber(message.from);

  const safety = evaluateWhatsAppSafety({
    source: "webjs",
    from: primaryPhone,
    senderCandidates: contactInfo.senderCandidates,
    text: text || "",
    isGroup
  });

  if (!safety.allowed) {
    logBlockedMessage(primaryPhone, safety.reason || "not_allowed_number", safety.normalizedCandidates ?? senderCandidates);
    return;
  }

  try {
    logAllowedMessage(safety.matchedCandidate || primaryPhone);
    const phoneNumber = safety.matchedCandidate || primaryPhone;
    const result = await handleIncomingWhatsAppText({
      from: phoneNumber,
      text: safety.sanitizedText || "",
      displayName: contactInfo.displayName,
      source: "webjs"
    });

    if (getWhatsAppSafetyConfig().dryRun) {
      console.log(
        JSON.stringify({
          event: "ducklake_webjs_dry_run",
          phone: maskPhoneNumber(phoneNumber),
          responsePreview: result.response.slice(0, 240)
        })
      );
      return;
    }

    await client?.sendMessage(message.from, result.response);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ducklake_webjs_error",
        phone: maskPhoneNumber(primaryPhone),
        error: error instanceof Error ? error.message : "Erro desconhecido"
      })
    );
    await client
      ?.sendMessage(
        message.from,
        "Nao consegui concluir sua solicitacao agora. Tente novamente em alguns instantes."
      )
      .catch(() => undefined);
  }
}

export function startWhatsAppWebJsClient() {
  if (started) {
    return getWebJsStatus();
  }

  started = true;
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: "ducklake-whatsapp-bot"
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });

  client.on("qr", (qr: string) => {
    state.ready = false;
    state.authenticated = false;
    state.lastQrAt = new Date().toISOString();
    console.log("Escaneie o QR Code com o WhatsApp para conectar o agente.");
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on("authenticated", () => {
    state.authenticated = true;
    console.log("WhatsApp Web autenticado.");
  });

  client.on("auth_failure", (message: string) => {
    state.authenticated = false;
    state.ready = false;
    console.error(`Falha de autenticacao do WhatsApp Web: ${message}`);
  });

  client.on("ready", () => {
    state.ready = true;
    state.authenticated = true;
    console.log("WhatsApp Web conectado.");
  });

  client.on("disconnected", (reason: string) => {
    state.ready = false;
    state.authenticated = false;
    state.lastDisconnectReason = String(reason);
    console.warn(`WhatsApp Web desconectado: ${reason}`);
  });

  client.on("message", (message: Message) => {
    void handleWebJsMessage(message);
  });

  void client.initialize().catch((error: unknown) => {
    state.ready = false;
    state.authenticated = false;
    console.error(
      `Erro ao iniciar WhatsApp Web: ${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  });

  return getWebJsStatus();
}
