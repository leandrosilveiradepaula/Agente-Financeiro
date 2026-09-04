"use client";

import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { exportExecutiveCsv } from "@/lib/exportExecutiveFiles";
import {
  formatResultCellValue,
  getResultColumnAlignment,
  getResultColumnKind,
  getResultColumnKindFromRows,
  getResultColumnLabel,
  isNegativeResultValue
} from "@/lib/result-presentation";
import type { ResultRow } from "@/lib/types";

type ResultTableProps = {
  columns: string[];
  data: ResultRow[];
};

function formatCell(value: ResultRow[string]) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function isRankingOne(column: string, value: ResultRow[string]) {
  return column.toLowerCase().includes("ranking") && Number(value) === 1;
}

export function ResultTable({ columns, data }: ResultTableProps) {
  const [filter, setFilter] = useState("");
  const [exportError, setExportError] = useState("");
  const normalizedFilter = filter.trim().toLowerCase();
  const columnKinds = useMemo(
    () => new Map(columns.map((column) => [column, getResultColumnKindFromRows(column, data)])),
    [columns, data]
  );
  const filteredData = useMemo(() => {
    if (!normalizedFilter) {
      return data;
    }

    return data.filter((row) =>
      columns.some((column) =>
        formatCell(row[column]).toLowerCase().includes(normalizedFilter)
      )
    );
  }, [columns, data, normalizedFilter]);

  if (!columns.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-steel">
        Comece fazendo uma pergunta sobre seus dados financeiros.
      </div>
    );
  }

  function handleExportCsv() {
    try {
      setExportError("");
      exportExecutiveCsv(columns, data);
    } catch {
      setExportError("Não foi possível exportar o CSV. Tente novamente em instantes.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="relative block md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtrar resultados"
            className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-ink placeholder:text-slate-400"
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm font-medium text-steel">
            {filteredData.length} de {data.length} linhas
          </span>
          <button
            type="button"
            disabled={!columns.length}
            onClick={handleExportCsv}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar CSV
          </button>
        </div>
      </div>

      {exportError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
          {exportError}
        </div>
      ) : null}

      <div className="max-w-full overflow-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-xs font-semibold uppercase tracking-normal text-slate-600">
            <tr>
              {columns.map((column) => {
                const columnKind = columnKinds.get(column) ?? getResultColumnKind(column);
                const alignment = getResultColumnAlignment(columnKind);

                return (
                  <th
                    key={column}
                    className={`whitespace-nowrap border-b border-slate-200 px-3 py-3 ${
                      alignment === "right"
                        ? "text-right"
                        : alignment === "center"
                          ? "text-center"
                          : "text-left"
                    }`}
                  >
                    {getResultColumnLabel(column)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white text-slate-600">
            {filteredData.length ? (
              filteredData.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${columns.join("-")}`} className="hover:bg-slate-50">
                  {columns.map((column) => {
                    const cellValue = row[column];
                    const columnKind = getResultColumnKind(column, cellValue);
                    const alignment = getResultColumnAlignment(columnKind);
                    const numericColumn = alignment === "right";

                    return (
                      <td
                        key={column}
                        className={`max-w-80 px-3 py-3 align-top ${
                          numericColumn
                            ? "text-right tabular-nums"
                            : alignment === "center"
                              ? "text-center"
                              : "text-left"
                        }`}
                      >
                        <span
                          className={`line-clamp-3 break-words ${
                            numericColumn ? "whitespace-nowrap" : ""
                          } ${
                            isNegativeResultValue(column, cellValue) &&
                            column.toLowerCase().includes("variancia")
                              ? "font-semibold text-rose-700"
                              : ""
                          } ${
                            isRankingOne(column, cellValue)
                              ? "rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-800"
                              : ""
                          }`}
                        >
                          {formatResultCellValue(column, cellValue)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : data.length ? (
              <tr>
                <td className="px-3 py-4 text-steel" colSpan={columns.length}>
                  Nenhuma linha encontrada para o filtro aplicado.
                </td>
              </tr>
            ) : (
              <tr>
                <td className="px-3 py-4 text-steel" colSpan={columns.length}>
                  Não foram encontrados registros para os critérios analisados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
