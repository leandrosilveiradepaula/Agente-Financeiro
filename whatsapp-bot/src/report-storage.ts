import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SavedWhatsAppReport } from "./types.js";

const MAX_REPORTS = 100;

export function storageFile() {
  return resolve(process.env.SAVED_REPORTS_FILE || "./data/saved-reports.json");
}

function sortReports(items: SavedWhatsAppReport[]) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function isSavedReport(value: unknown): value is SavedWhatsAppReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.whatsappUserId === "string" &&
    typeof item.phoneNumber === "string" &&
    typeof item.question === "string" &&
    typeof item.markdown === "string" &&
    typeof item.createdAt === "string"
  );
}

export async function readSavedReports(): Promise<SavedWhatsAppReport[]> {
  try {
    const raw = await readFile(storageFile(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortReports(parsed.filter(isSavedReport)).slice(0, MAX_REPORTS) : [];
  } catch {
    return [];
  }
}

export async function writeSavedReports(items: SavedWhatsAppReport[]) {
  const file = storageFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(sortReports(items).slice(0, MAX_REPORTS), null, 2), "utf-8");
}

export async function saveReport(item: SavedWhatsAppReport) {
  const current = await readSavedReports();
  const deduped = current.filter((report) => {
    if (item.queryId && report.queryId) {
      return report.whatsappUserId !== item.whatsappUserId || report.queryId !== item.queryId;
    }

    return !(
      report.whatsappUserId === item.whatsappUserId &&
      report.question.trim().toLowerCase() === item.question.trim().toLowerCase() &&
      report.createdAt === item.createdAt
    );
  });
  const next = sortReports([item, ...deduped]).slice(0, MAX_REPORTS);
  await writeSavedReports(next);
  return item;
}

export async function listReportsByUser(whatsappUserId: string, limit = 5) {
  const reports = await readSavedReports();
  return reports.filter((report) => report.whatsappUserId === whatsappUserId).slice(0, limit);
}
