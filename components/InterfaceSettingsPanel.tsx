"use client";

import { RotateCcw, Save, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import type { InterfaceSettings } from "@/lib/interface-settings";
import { getDefaultInterfaceSettings } from "@/lib/interface-settings";

type InterfaceSettingsPanelProps = {
  settings: InterfaceSettings;
  onSaveSettings: (settings: InterfaceSettings) => void;
  onResetSettings: () => void;
};

function numericValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function InterfaceSettingsPanel({
  settings,
  onSaveSettings,
  onResetSettings
}: InterfaceSettingsPanelProps) {
  const [draft, setDraft] = useState<InterfaceSettings>(settings);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function update<K extends keyof InterfaceSettings>(key: K, value: InterfaceSettings[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
    setMessage("");
  }

  function saveSettings() {
    const normalized: InterfaceSettings = {
      ...draft,
      pdfMaxRows: numericValue(draft.pdfMaxRows, 5, 50),
      pdfMaxColumns: numericValue(draft.pdfMaxColumns, 4, 15),
      pdfMaxSqlLines: numericValue(draft.pdfMaxSqlLines, 30, 300)
    };

    onSaveSettings(normalized);
    setDraft(normalized);
    setMessage("ConfiguraÃ§Ãµes salvas.");
    window.setTimeout(() => setMessage(""), 1800);
  }

  function restoreDefaults() {
    const defaults = getDefaultInterfaceSettings();
    setDraft(defaults);
    onResetSettings();
    setMessage("PadrÃ£o restaurado.");
    window.setTimeout(() => setMessage(""), 1800);
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <Settings className="h-5 w-5 text-lake" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-ink">ConfiguraÃ§Ãµes da interface</h2>
      </div>

      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">
              PDF â€” mÃ¡ximo de linhas
            </span>
            <input
              type="number"
              min={5}
              max={50}
              value={draft.pdfMaxRows}
              onChange={(event) => update("pdfMaxRows", Number(event.target.value))}
              className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">
              PDF â€” mÃ¡ximo de colunas
            </span>
            <input
              type="number"
              min={4}
              max={15}
              value={draft.pdfMaxColumns}
              onChange={(event) => update("pdfMaxColumns", Number(event.target.value))}
              className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">
            PDF â€” mÃ¡ximo de linhas da SQL
          </span>
          <input
            type="number"
            min={30}
            max={300}
            value={draft.pdfMaxSqlLines}
            onChange={(event) => update("pdfMaxSqlLines", Number(event.target.value))}
            className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500">
            Modo padrÃ£o de resultado
          </span>
          <select
            value={draft.defaultResultMode}
            onChange={(event) =>
              update("defaultResultMode", event.target.value === "manual" ? "manual" : "auto")
            }
            className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-sm text-ink shadow-sm focus:border-blue-400 focus:outline-none"
          >
            <option value="auto">AutomÃ¡tico</option>
            <option value="manual">Manual</option>
          </select>
        </label>

        <div className="grid gap-2">
          {[
            ["pdfIncludeSql", "PDF â€” incluir SQL"],
            ["markdownIncludeSql", "Markdown â€” incluir SQL no fallback local"],
            ["useSqlCache", "Usar cache de SQL por padrão"],
            ["showDiagnosticsPanel", "Mostrar painel de diagnÃ³stico"],
            ["showExecutiveReportHistory", "Mostrar histÃ³rico de relatÃ³rios"],
            ["showWhatsAppDemoPanel", "Mostrar painel de demonstraÃ§Ã£o WhatsApp"]
          ].map(([key, label]) => (
            <label
              key={key}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <span className="text-sm font-medium text-ink">{label}</span>
              <input
                type="checkbox"
                checked={Boolean(draft[key as keyof InterfaceSettings])}
                onChange={(event) =>
                  update(key as keyof InterfaceSettings, event.target.checked as never)
                }
                className="h-4 w-4 accent-teal-700"
              />
            </label>
          ))}
        </div>

        {message ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            {message}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={saveSettings}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-lake px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-800"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            Salvar configuraÃ§Ãµes
          </button>
          <button
            type="button"
            onClick={restoreDefaults}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Restaurar padrÃ£o
          </button>
        </div>
      </div>
    </section>
  );
}
