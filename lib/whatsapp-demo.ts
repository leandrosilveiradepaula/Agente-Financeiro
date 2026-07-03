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
