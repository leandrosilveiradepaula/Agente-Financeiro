import QRCode from "qrcode";
import { applyWhatsAppTriggerPrefix } from "./whatsapp-safety.js";

export type DemoQuestion = {
  id: string;
  label: string;
  question: string;
};

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    id: "estouro_orcamento",
    label: "Estouro de orçamento",
    question: "Quais as contas que tiveram maiores estouros de orçamento no mês?"
  },
  {
    id: "orcado_vs_realizado",
    label: "Orçado x realizado",
    question: "Qual foi a principal variação entre orçado e realizado que afetou nosso resultado neste mês?"
  },
  {
    id: "resultado_marcas",
    label: "Resultado por marca",
    question:
      "Monte uma tabela com os resultados do mês por marca e classifique quais as marcas com melhor desempenho em valor e em % sobre ROL"
  }
];

const DEFAULT_DEMO_TITLE = "Agente SQL Financeiro DuckLake";
const DEFAULT_DEMO_SUBTITLE = "Escaneie o QR Code para testar o agente financeiro pelo WhatsApp";
const DEFAULT_DEMO_QUESTION = DEMO_QUESTIONS[0].question;

export function normalizeDemoPhoneNumber(value: string) {
  return value.replace(/\D/g, "");
}

export function sanitizeDemoText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

export function buildWhatsAppDemoLink({ phoneNumber, text }: { phoneNumber: string; text: string }) {
  const normalizedPhone = normalizeDemoPhoneNumber(phoneNumber);
  const normalizedText = sanitizeDemoText(applyWhatsAppTriggerPrefix(text));

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(normalizedText)}`;
}

export function getDemoMessageText(question: string) {
  return sanitizeDemoText(applyWhatsAppTriggerPrefix(question));
}

export function getDemoQuestion(questionId?: string, customText?: string) {
  const sanitizedCustomText = customText ? sanitizeDemoText(customText) : "";
  if (sanitizedCustomText) {
    return sanitizedCustomText;
  }

  const selected = questionId
    ? DEMO_QUESTIONS.find((question) => question.id === questionId)
    : undefined;

  return selected?.question || sanitizeDemoText(process.env.DEMO_DEFAULT_QUESTION || DEFAULT_DEMO_QUESTION);
}

export async function generateQrPngBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 720,
    color: {
      dark: "#0f172a",
      light: "#ffffff"
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function demoConfigFromEnv() {
  const phoneNumber = normalizeDemoPhoneNumber(process.env.DEMO_BOT_PHONE_NUMBER || "");
  const title = sanitizeDemoText(process.env.DEMO_TITLE || DEFAULT_DEMO_TITLE);
  const subtitle = sanitizeDemoText(process.env.DEMO_SUBTITLE || DEFAULT_DEMO_SUBTITLE);

  return { phoneNumber, title, subtitle };
}

export function renderDemoHtml({
  title,
  subtitle,
  phoneNumber,
  question,
  messageText,
  url,
  qrImagePath = "/demo/qr.png",
  questions = DEMO_QUESTIONS
}: {
  title: string;
  subtitle: string;
  phoneNumber: string;
  question: string;
  messageText?: string;
  url: string;
  qrImagePath?: string;
  questions?: DemoQuestion[];
}) {
  const displayedMessageText = messageText || getDemoMessageText(question);
  const questionLinks = questions
    .map(
      (item) =>
        `<a class="chip" href="/demo?questionId=${encodeURIComponent(item.id)}">${escapeHtml(item.label)}</a>`
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - Demonstração WhatsApp</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --ink: #0f172a;
      --muted: #475569;
      --line: #dbe3ea;
      --teal: #0f766e;
      --blue: #2563eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, rgba(37, 99, 235, 0.08), transparent 360px), var(--bg);
      color: var(--ink);
    }
    main {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px 18px;
    }
    .panel {
      width: min(940px, 100%);
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }
    .content {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) minmax(260px, 360px);
      gap: 28px;
      padding: 34px;
      align-items: center;
    }
    .eyebrow {
      color: var(--teal);
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 0 0 10px;
    }
    h1 {
      font-size: clamp(30px, 5vw, 46px);
      line-height: 1.05;
      margin: 0;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 16px 0 0;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.55;
    }
    .instruction {
      margin: 22px 0 0;
      color: #1e293b;
      line-height: 1.6;
    }
    .question {
      margin-top: 22px;
      padding: 16px;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      background: #eff6ff;
      color: #1e3a8a;
      line-height: 1.5;
    }
    .meta {
      margin-top: 16px;
      color: var(--muted);
      font-size: 14px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 24px;
    }
    .button, .chip {
      display: inline-flex;
      align-items: center;
      min-height: 40px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 700;
    }
    .button {
      background: var(--blue);
      color: #fff;
      padding: 0 16px;
    }
    .chip {
      border: 1px solid var(--line);
      color: #0f172a;
      padding: 0 12px;
      background: #fff;
      font-size: 14px;
    }
    .qr-wrap {
      display: grid;
      justify-items: center;
      gap: 14px;
    }
    .qr {
      width: min(100%, 340px);
      aspect-ratio: 1;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fff;
    }
    .qr img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    footer {
      border-top: 1px solid var(--line);
      padding: 16px 34px;
      color: #64748b;
      font-size: 14px;
      background: #f8fafc;
    }
    @media (max-width: 760px) {
      .content {
        grid-template-columns: 1fr;
        padding: 24px;
      }
      footer { padding: 16px 24px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <div class="content">
        <div>
          <p class="eyebrow">Demonstração WhatsApp</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="subtitle">${escapeHtml(subtitle)}</p>
          <p class="instruction">Aponte a câmera do celular para o QR Code, abra o WhatsApp e envie a pergunta.</p>
          <div class="question"><strong>Pergunta padrão</strong><br />${escapeHtml(question)}</div>
          <div class="question"><strong>Mensagem enviada</strong><br />${escapeHtml(displayedMessageText)}</div>
          <p class="meta"><strong>Número do robô:</strong> ${escapeHtml(phoneNumber)}</p>
          <div class="actions">
            <a class="button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>
            ${questionLinks}
          </div>
        </div>
        <div class="qr-wrap">
          <div class="qr">
            <img src="${escapeHtml(qrImagePath)}" alt="QR Code para abrir o WhatsApp" />
          </div>
        </div>
      </div>
      <footer>Ambiente de demonstração. Não utilizar dados sensíveis.</footer>
    </section>
  </main>
</body>
</html>`;
}
