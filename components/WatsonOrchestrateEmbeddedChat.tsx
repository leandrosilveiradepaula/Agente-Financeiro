"use client";

import { ChevronDown, Loader2, MessageCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

const ROOT_ELEMENT_ID = "watson-orchestrate-chat-root";
const DEFAULT_HOST_URL = "https://us-south.watson-orchestrate.cloud.ibm.com";
const DEFAULT_ORCHESTRATION_ID =
  "dcb73a4cf6ba45a498d4fe3f24f1b114_92d931c3-9a72-4844-97e4-a641ca7bd5b8";
const DEFAULT_AGENT_ID = "d1ec6cd9-2f9b-4f71-ab35-f99e4551405d";
const DEFAULT_CRN =
  "crn:v1:bluemix:public:watsonx-orchestrate:us-south:a/dcb73a4cf6ba45a498d4fe3f24f1b114:92d931c3-9a72-4844-97e4-a641ca7bd5b8::";
const SCRIPT_ID = "watson-orchestrate-embedded-chat-loader";

declare global {
  interface Window {
    wxOConfiguration?: {
      orchestrationID: string;
      hostURL: string;
      rootElementID: string;
      deploymentPlatform: "ibmcloud";
      crn: string;
      chatOptions: {
        agentId: string;
      };
    };
    wxoLoader?: {
      init: () => void | Promise<void>;
    };
    __watsonOrchestrateChatInitialized?: boolean;
  }
}

function getConfig() {
  const hostURL = process.env.NEXT_PUBLIC_WXO_HOST_URL || DEFAULT_HOST_URL;

  return {
    orchestrationID:
      process.env.NEXT_PUBLIC_WXO_ORCHESTRATION_ID || DEFAULT_ORCHESTRATION_ID,
    hostURL,
    rootElementID: ROOT_ELEMENT_ID,
    deploymentPlatform: "ibmcloud" as const,
    crn: process.env.NEXT_PUBLIC_WXO_CRN || DEFAULT_CRN,
    chatOptions: {
      agentId: process.env.NEXT_PUBLIC_WXO_AGENT_ID || DEFAULT_AGENT_ID
    }
  };
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    if (existingScript) {
      if (window.wxoLoader) {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("script-load-error")), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script-load-error"));
    document.body.appendChild(script);
  });
}

export function WatsonOrchestrateEmbeddedChat() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!open || window.__watsonOrchestrateChatInitialized) {
      return;
    }

    let cancelled = false;

    async function initializeChat() {
      const config = getConfig();
      const scriptUrl = `${config.hostURL}/wxochat/wxoLoader.js?embed=true`;

      setLoading(true);
      setLoadError("");
      window.wxOConfiguration = config;

      try {
        await loadScript(scriptUrl);
        if (cancelled) {
          return;
        }

        if (!window.wxoLoader?.init) {
          throw new Error("loader-not-available");
        }

        await window.wxoLoader.init();
        window.__watsonOrchestrateChatInitialized = true;
      } catch {
        if (!cancelled) {
          setLoadError(
            "Não foi possível carregar o chat do Watson Orchestrate. Verifique a configuração do embedded chat."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void initializeChat();

    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-lake" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-ink">Chat Watson Orchestrate</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-steel">
            Este chat usa o agente publicado no watsonx Orchestrate. Ele é auxiliar ao fluxo
            principal de geração e análise de SQL.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={ROOT_ELEMENT_ID}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <ChevronDown
            className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          {open ? "Fechar chat Watson" : "Abrir chat Watson"}
        </button>
      </div>

      <div className={open ? "mt-4" : "hidden"}>
        {loading ? (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando chat do Watson Orchestrate...
          </div>
        ) : null}
        {loadError ? (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
        ) : null}
        <div
          id={ROOT_ELEMENT_ID}
          className="min-h-[520px] overflow-hidden rounded-md border border-slate-200 bg-slate-50"
        />
      </div>
    </section>
  );
}
