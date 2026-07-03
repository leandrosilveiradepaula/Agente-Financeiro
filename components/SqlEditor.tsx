"use client";

import Editor from "@monaco-editor/react";
import { Check, Clipboard, FileCode2 } from "lucide-react";
import { useState } from "react";

type SqlEditorProps = {
  sql: string;
  onSqlChange: (value: string) => void;
};

export function SqlEditor({ sql, onSqlChange }: SqlEditorProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  async function copySql() {
    if (!sql.trim()) {
      return;
    }

    try {
      setCopyError("");
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Não foi possível copiar a SQL. Selecione o texto e copie manualmente.");
    }
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-5 w-5 text-lake" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-ink">SQL gerada</h2>
        </div>
        <button
          type="button"
          disabled={!sql.trim()}
          onClick={copySql}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />
          ) : (
            <Clipboard className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? "Copiado" : "Copiar SQL"}
        </button>
      </div>

      <div
        className={`overflow-hidden rounded-md border ${
          sql
            ? "min-h-72 border-slate-800 bg-slate-950"
            : "min-h-40 border-dashed border-slate-300 bg-slate-50"
        }`}
      >
        {sql ? (
          <Editor
            height="320px"
            language="sql"
            theme="vs-dark"
            value={sql}
            onChange={(value) => onSqlChange(value ?? "")}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              wordWrap: "on",
              automaticLayout: true,
              tabSize: 2
            }}
          />
        ) : (
          <div className="flex min-h-40 items-center justify-center px-4 text-center text-sm font-medium text-steel">
            Digite uma pergunta ou escolha uma pergunta padrão para gerar a SQL.
          </div>
        )}
      </div>
      {copyError ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
          {copyError}
        </div>
      ) : null}
    </section>
  );
}
