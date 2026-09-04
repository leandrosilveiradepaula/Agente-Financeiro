export type WhatsAppDemoHealth = {
  status?: string;
  provider?: string;
  agentEndpointConfigured?: boolean;
  whatsappConfigured?: boolean;
  webjsReady?: boolean;
  storage?: string;
};

export type WhatsAppWebJsStatus = {
  provider?: string;
  ready?: boolean;
  authenticated?: boolean;
};

export type WhatsAppWebJsSafety = {
  provider?: string;
  inboundEnabled?: boolean;
  dryRun?: boolean;
  requireTrigger?: boolean;
  triggerPrefix?: string;
  allowedNumbersCount?: number;
  ignoreGroups?: boolean;
};

export type WhatsAppSafetyMode = "seguro" | "demo_controlada" | "risco" | "indisponivel";

export type WhatsAppDemoLink = {
  url: string;
  phoneNumber: string;
  question: string;
};

export type WhatsAppDemoQuestion = {
  id: string;
  label: string;
  question: string;
};

const DEFAULT_WHATSAPP_BOT_URL = "http://localhost:3980";

export function getWhatsAppBotUrl(value?: string) {
  const configured = value || process.env.NEXT_PUBLIC_WHATSAPP_BOT_URL || DEFAULT_WHATSAPP_BOT_URL;
  return configured.replace(/\/+$/, "");
}

export function buildWhatsAppDemoPath(questionId?: string) {
  return questionId ? `?questionId=${encodeURIComponent(questionId)}` : "";
}

export function buildWhatsAppBotEndpoint(baseUrl: string, path: string, questionId?: string) {
  return `${getWhatsAppBotUrl(baseUrl)}${path}${buildWhatsAppDemoPath(questionId)}`;
}

export function getWhatsAppSafetyMode(safety: WhatsAppWebJsSafety | null): WhatsAppSafetyMode {
  if (!safety) {
    return "indisponivel";
  }

  if (!safety.inboundEnabled || safety.dryRun) {
    return "seguro";
  }

  if (safety.inboundEnabled && !safety.dryRun && (safety.allowedNumbersCount ?? 0) > 0) {
    return "demo_controlada";
  }

  return "risco";
}

export function getWhatsAppSafetySummary(safety: WhatsAppWebJsSafety | null) {
  const mode = getWhatsAppSafetyMode(safety);

  if (mode === "indisponivel") {
    return "Status de segurança indisponível.";
  }

  if (mode === "seguro") {
    if (!safety?.inboundEnabled) {
      return "Modo seguro ativo: o bot não responde mensagens recebidas pelo WhatsApp Web.";
    }

    return "Dry-run ativo: o bot não envia respostas pelo WhatsApp.";
  }

  if (mode === "demo_controlada") {
    return "Modo de demo controlada: somente números autorizados com prefixo podem acionar o agente.";
  }

  return "Modo inseguro: configure uma allowlist antes de usar.";
}
