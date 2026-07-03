"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getWhatsAppBotUrl,
  getWhatsAppSafetyMode,
  type WhatsAppDemoHealth,
  type WhatsAppWebJsSafety
} from "@/lib/whatsapp-demo";

type SummaryState = {
  online: boolean | null;
  mode: string;
};

function modeLabel(safety: WhatsAppWebJsSafety | null) {
  const mode = getWhatsAppSafetyMode(safety);

  if (mode === "seguro") {
    return "modo seguro";
  }

  if (mode === "demo_controlada") {
    return "demo controlada";
  }

  if (mode === "risco") {
    return "risco";
  }

  return "segurança indisponível";
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export function WhatsAppOperationalSummary() {
  const baseUrl = useMemo(() => getWhatsAppBotUrl(), []);
  const [summary, setSummary] = useState<SummaryState>({
    online: null,
    mode: "verificando segurança"
  });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);

    async function loadSummary() {
      try {
        const [health, safetyResult] = await Promise.all([
          fetchJson<WhatsAppDemoHealth>(`${baseUrl}/health`, controller.signal),
          fetchJson<WhatsAppWebJsSafety>(`${baseUrl}/webjs/safety`, controller.signal).then(
            (data) => ({ ok: true as const, data }),
            () => ({ ok: false as const, data: null })
          )
        ]);

        setSummary({
          online: health.status === "ok",
          mode: modeLabel(safetyResult.data)
        });
      } catch {
        setSummary({
          online: false,
          mode: "segurança indisponível"
        });
      } finally {
        window.clearTimeout(timeout);
      }
    }

    loadSummary();

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [baseUrl]);

  const onlineLabel =
    summary.online === null ? "verificando" : summary.online ? "online" : "offline";
  const onlineClasses =
    summary.online === true
      ? "bg-emerald-50 text-emerald-800"
      : summary.online === false
        ? "bg-rose-50 text-rose-800"
        : "bg-slate-100 text-slate-700";

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`rounded-md px-2 py-0.5 font-semibold ${onlineClasses}`}>{onlineLabel}</span>
      <span className="text-slate-400">•</span>
      <span>{summary.mode}</span>
    </span>
  );
}
