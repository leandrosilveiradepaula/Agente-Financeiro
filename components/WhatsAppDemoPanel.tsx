"use client";

import {
  CheckCircle2,
  Clipboard,
  ExternalLink,
  MessageCircle,
  QrCode,
  RefreshCw,
  TriangleAlert,
  WifiOff,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildWhatsAppBotEndpoint,
  getWhatsAppBotUrl,
  type WhatsAppDemoHealth,
  type WhatsAppDemoLink,
  type WhatsAppDemoQuestion,
  type WhatsAppWebJsStatus
} from "@/lib/whatsapp-demo";

type WhatsAppDemoPanelProps = {
  whatsappBotUrl?: string;
};

type PanelStatus = "idle" | "loading" | "online" | "offline" | "cors";

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    throw new Error(`Falha HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

function statusPill(label: string, ok?: boolean, unknownLabel = "indisponível") {
  const tone = ok === true ? "emerald" : ok === false ? "rose" : "amber";
  const Icon = ok === true ? CheckCircle2 : ok === false ? XCircle : TriangleAlert;
  const text = ok === undefined ? unknownLabel : ok ? "sim" : "não";
  const classes =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${classes}`}>
        <Icon className="h-3 w-3" aria-hidden="true" />
        {text}
      </span>
    </div>
  );
}

export function WhatsAppDemoPanel({ whatsappBotUrl }: WhatsAppDemoPanelProps) {
  const baseUrl = useMemo(() => getWhatsAppBotUrl(whatsappBotUrl), [whatsappBotUrl]);
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [health, setHealth] = useState<WhatsAppDemoHealth | null>(null);
  const [webjsStatus, setWebjsStatus] = useState<WhatsAppWebJsStatus | null>(null);
  const [demoLink, setDemoLink] = useState<WhatsAppDemoLink | null>(null);
  const [questions, setQuestions] = useState<WhatsAppDemoQuestion[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [qrAvailable, setQrAvailable] = useState(true);

  const selectedPath = selectedQuestionId
    ? `?questionId=${encodeURIComponent(selectedQuestionId)}`
    : "";
  const demoPageUrl = `${baseUrl}/demo${selectedPath}`;
  const qrUrl = `${baseUrl}/demo/qr.png${selectedPath}`;

  const loadStatus = useCallback(
    async (questionId = "") => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 6000);
      const suffix = questionId ? `?questionId=${encodeURIComponent(questionId)}` : "";

      setStatus("loading");
      setMessage("");
      setQrAvailable(true);

      try {
        const [nextHealth, nextWebjsStatus, nextDemoLink, nextQuestions] = await Promise.all([
          fetchJson<WhatsAppDemoHealth>(`${baseUrl}/health`, controller.signal),
          fetchJson<WhatsAppWebJsStatus>(`${baseUrl}/webjs/status`, controller.signal),
          fetchJson<WhatsAppDemoLink>(`${baseUrl}/demo/link${suffix}`, controller.signal),
          fetchJson<WhatsAppDemoQuestion[]>(`${baseUrl}/demo/questions`, controller.signal)
        ]);

        setHealth(nextHealth);
        setWebjsStatus(nextWebjsStatus);
        setDemoLink(nextDemoLink);
        setQuestions(Array.isArray(nextQuestions) ? nextQuestions : []);
        setStatus("online");
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        const isLikelyCors =
          typeof window !== "undefined" &&
          window.location.protocol === "https:" &&
          baseUrl.startsWith("http://");

        setStatus(isLikelyCors ? "cors" : "offline");
        setMessage(
          isLikelyCors
            ? "Status não disponível por restrição de CORS. Abra a demo diretamente."
            : isAbort
              ? "WhatsApp Bot offline ou inacessível."
              : "WhatsApp Bot offline ou inacessível."
        );
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [baseUrl]
  );

  useEffect(() => {
    void loadStatus("");
  }, [loadStatus]);

  async function copyWhatsAppLink() {
    if (!demoLink?.url) {
      setMessage("Link WhatsApp indisponível. Verifique se o whatsapp-bot está rodando.");
      return;
    }

    try {
      await navigator.clipboard.writeText(demoLink.url);
      setMessage("Link WhatsApp copiado.");
      window.setTimeout(() => setMessage(""), 1800);
    } catch {
      setMessage("Não foi possível copiar o link WhatsApp.");
    }
  }

  function selectQuestion(questionId: string) {
    setSelectedQuestionId(questionId);
    void loadStatus(questionId);
  }

  const isLoading = status === "loading";
  const isOnline = status === "online";
  const statusText = isOnline ? "online" : isLoading ? "atualizando" : "offline";

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-lake" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-ink">Demonstração WhatsApp</h2>
            <p className="text-xs text-slate-500">Ambiente local para apresentação comercial.</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${
            isOnline
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {isOnline ? <CheckCircle2 className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {statusText}
        </span>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
        Ambiente de demonstração. Não utilizar dados sensíveis.
      </div>

      <div className="mt-3 grid gap-2">
        {statusPill("Bot HTTP", isOnline)}
        {statusPill("WhatsApp Web", webjsStatus ? Boolean(webjsStatus.ready) : undefined, "sem status")}
        {statusPill(
          "Authenticated",
          webjsStatus ? Boolean(webjsStatus.authenticated) : undefined,
          "sem status"
        )}
        {statusPill(
          "Agent endpoint",
          health ? Boolean(health.agentEndpointConfigured) : undefined,
          "sem status"
        )}
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <QrCode className="h-4 w-4 text-lake" aria-hidden="true" />
          QR Code de demonstração
        </div>
        <div className="mt-3 flex justify-center">
          {qrAvailable ? (
            <img
              src={qrUrl}
              alt="QR Code para abrir a demonstração no WhatsApp"
              className="h-52 w-52 rounded-md border border-slate-200 bg-white p-2"
              onError={() => setQrAvailable(false)}
            />
          ) : (
            <div className="flex h-52 w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-3 text-center text-sm text-slate-500">
              QR Code indisponível. Verifique se o whatsapp-bot está rodando.
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Provider</p>
          <p className="mt-0.5 font-semibold text-ink">{health?.provider || webjsStatus?.provider || "webjs"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Número do robô</p>
          <p className="mt-0.5 break-all font-semibold text-ink">{demoLink?.phoneNumber || "indisponível"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Pergunta padrão</p>
          <p className="mt-0.5 text-slate-700">{demoLink?.question || "indisponível"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Link wa.me</p>
          <p className="mt-0.5 break-all text-xs text-slate-600">{demoLink?.url || "indisponível"}</p>
        </div>
      </div>

      {questions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {questions.map((question) => (
            <button
              key={question.id}
              type="button"
              onClick={() => selectQuestion(question.id)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                selectedQuestionId === question.id
                  ? "border-teal-300 bg-teal-50 text-teal-800"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"
              }`}
            >
              {question.label}
            </button>
          ))}
        </div>
      ) : null}

      {message ? (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-sm font-medium ${
            status === "offline" || status === "cors"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {message}
          {status === "offline" ? (
            <span className="mt-1 block text-xs">Inicie o serviço em whatsapp-bot com npm run dev.</span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <a
          href={demoPageUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-lake px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-800"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Abrir demo WhatsApp
        </a>
        <button
          type="button"
          onClick={copyWhatsAppLink}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
          Copiar link WhatsApp
        </button>
        <a
          href={demoLink?.url || buildWhatsAppBotEndpoint(baseUrl, "/demo/link", selectedQuestionId)}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold shadow-sm transition ${
            demoLink?.url
              ? "border-slate-200 bg-white text-ink hover:border-blue-300 hover:bg-blue-50"
              : "pointer-events-none border-slate-200 bg-slate-100 text-slate-400"
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          Abrir no WhatsApp
        </a>
        <button
          type="button"
          onClick={() => loadStatus(selectedQuestionId)}
          disabled={isLoading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          Atualizar status
        </button>
      </div>

      <p className="mt-3 break-all text-xs text-slate-500">Bot URL: {baseUrl}</p>
    </section>
  );
}
