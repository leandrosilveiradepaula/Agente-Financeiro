import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SavedTeamsReport } from "./types.js";

const MAX_REPORTS = 100;

function storageFile() {
  return resolve(process.env.SAVED_REPORTS_FILE || "./data/saved-reports.json");
}

function sortReports(items: SavedTeamsReport[]) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function isSavedReport(value: unknown): value is SavedTeamsReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.teamsUserId === "string" &&
    typeof item.conversationId === "string" &&
    typeof item.question === "string" &&
    typeof item.markdown === "string" &&
    typeof item.createdAt === "string"
  );
}

export async function readSavedReports(): Promise<SavedTeamsReport[]> {
  try {
    const raw = await readFile(storageFile(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortReports(parsed.filter(isSavedReport)).slice(0, MAX_REPORTS) : [];
  } catch {
    return [];
  }
}

export async function writeSavedReports(items: SavedTeamsReport[]) {
  const file = storageFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(sortReports(items).slice(0, MAX_REPORTS), null, 2), "utf-8");
}

export async function saveReport(item: SavedTeamsReport) {
  const current = await readSavedReports();
  const deduped = current.filter((report) => {
    if (item.queryId && report.queryId) {
      return report.teamsUserId !== item.teamsUserId || report.queryId !== item.queryId;
    }

    return !(
      report.teamsUserId === item.teamsUserId &&
      report.question.trim().toLowerCase() === item.question.trim().toLowerCase() &&
      report.createdAt === item.createdAt
    );
  });
  const next = sortReports([item, ...deduped]).slice(0, MAX_REPORTS);
  await writeSavedReports(next);
  return item;
}

export async function listReportsByUser(teamsUserId: string, limit = 5) {
  const reports = await readSavedReports();
  return reports.filter((report) => report.teamsUserId === teamsUserId).slice(0, limit);
}

export async function getReportById(id: string) {
  const reports = await readSavedReports();
  return reports.find((report) => report.id === id);
}
