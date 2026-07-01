const DEFAULT_GRAPH_API_VERSION = "v21.0";

function graphApiVersion() {
  return process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
}

function messagesUrl() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID nao configurado.");
  }

  return `https://graph.facebook.com/${graphApiVersion()}/${phoneNumberId}/messages`;
}

function accessToken() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    throw new Error("WHATSAPP_ACCESS_TOKEN nao configurado.");
  }

  return token;
}

export function isWhatsAppConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsAppTextMessage(to: string, text: string) {
  const response = await fetch(messagesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    })
  });

  const body = await response.text();
  const parsed = body ? JSON.parse(body) : {};

  if (!response.ok) {
    const message =
      parsed?.error?.message || parsed?.error_message || `Meta Graph API retornou HTTP ${response.status}.`;
    throw new Error(message);
  }

  return parsed;
}
