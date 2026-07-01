import {
  ActivityHandler,
  CardFactory,
  MessageFactory,
  TeamsActivityHandler,
  TurnContext
} from "botbuilder";
import { buildExecutiveReportCard, buildHelpCard, buildSavedReportCard } from "./adaptive-cards.js";
import { askDuckLakeAgent } from "./ducklake-agent-client.js";
import { getReportById, listReportsByUser, saveReport } from "./report-storage.js";
import { normalizeTeamsMessage, truncateMarkdown } from "./text-formatting.js";
import type { DuckLakeAgentResult, SavedTeamsReport } from "./types.js";

const pendingReports = new Map<string, SavedTeamsReport>();

function allowedUsers() {
  return (process.env.ALLOWED_TEAMS_USERS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function tenantId(context: TurnContext) {
  const channelData = context.activity.channelData as { tenant?: { id?: string } } | undefined;
  return channelData?.tenant?.id;
}

function isAuthorized(context: TurnContext) {
  const allowedTenant = process.env.ALLOWED_TEAMS_TENANT_ID;

  if (allowedTenant && tenantId(context) !== allowedTenant) {
    return false;
  }

  const users = allowedUsers();

  if (users.length && !users.includes(context.activity.from?.id || "")) {
    return false;
  }

  return true;
}

function createSavedReport(context: TurnContext, result: DuckLakeAgentResult): SavedTeamsReport {
  return {
    id: crypto.randomUUID(),
    teamsUserId: context.activity.from.id,
    teamsUserName: context.activity.from.name,
    conversationId: context.activity.conversation.id,
    queryId: result.queryId,
    question: result.question,
    markdown: result.markdown,
    summary: result.summary,
    columns: result.columns,
    dataPreview: result.data.slice(0, 5),
    rowCount: result.rowCount,
    executionTimeMs: result.executionTimeMs,
    createdAt: new Date().toISOString()
  };
}

async function sendMarkdown(context: TurnContext, reportId: string) {
  const report = pendingReports.get(reportId) ?? (await getReportById(reportId));

  if (!report) {
    await context.sendActivity("Não encontrei esse relatório. Gere a consulta novamente.");
    return;
  }

  await context.sendActivity(truncateMarkdown(report.markdown));
}

async function savePendingReport(context: TurnContext, reportId: string) {
  const report = pendingReports.get(reportId);

  if (!report) {
    await context.sendActivity("Não encontrei esse relatório temporário. Gere a consulta novamente.");
    return;
  }

  await saveReport(report);
  await context.sendActivity("Relatório salvo com sucesso.");
}

async function listMyReports(context: TurnContext) {
  const reports = await listReportsByUser(context.activity.from.id, 5);

  if (!reports.length) {
    await context.sendActivity("Você ainda não possui relatórios salvos.");
    return;
  }

  await context.sendActivity("Últimos relatórios salvos:");
  for (const report of reports) {
    await context.sendActivity({ attachments: [buildSavedReportCard(report)] });
  }
}

async function answerStatus(context: TurnContext) {
  const endpoint = process.env.DUCKLAKE_AGENT_ENDPOINT || "endpoint padrão configurado";
  const storageFile = process.env.SAVED_REPORTS_FILE || "./data/saved-reports.json";
  await context.sendActivity(
    [
      "Bot online.",
      `Endpoint configurado: ${endpoint ? "sim" : "não"}`,
      `URL do agente: ${endpoint}`,
      `Storage local: ${storageFile}`
    ].join("\n")
  );
}

async function handleQuestion(context: TurnContext, question: string) {
  await context.sendActivity(
    "Recebi sua pergunta. Vou gerar a SQL, executar a consulta e montar o relatório executivo."
  );

  try {
    const result = await askDuckLakeAgent(question);
    const report = createSavedReport(context, result);
    pendingReports.set(report.id, report);

    console.info("ducklake_teams.query_completed", {
      queryId: result.queryId,
      intent: result.intent,
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs
    });

    await context.sendActivity({
      attachments: [
        buildExecutiveReportCard({
          result,
          reportId: report.id,
          webAppUrl: process.env.DUCKLAKE_WEB_APP_URL
        })
      ]
    });
  } catch (error) {
    console.error("ducklake_teams.query_failed", {
      error: error instanceof Error ? error.message : "UnknownError"
    });
    await context.sendActivity(
      "Não consegui concluir a consulta agora. Verifiquei que houve erro na geração ou execução. Tente novamente ou acione o suporte."
    );
  }
}

export class DuckLakeTeamsBot extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      if (!isAuthorized(context)) {
        await context.sendActivity("Você não está autorizado a usar este bot.");
        await next();
        return;
      }

      const value = context.activity.value as { action?: string; reportId?: string } | undefined;

      if (value?.action === "saveReport" && value.reportId) {
        await savePendingReport(context, value.reportId);
        await next();
        return;
      }

      if (value?.action === "sendMarkdown" && value.reportId) {
        await sendMarkdown(context, value.reportId);
        await next();
        return;
      }

      if (value?.action === "viewSavedSummary" && value.reportId) {
        const report = await getReportById(value.reportId);
        await context.sendActivity(report ? report.summary.paragraphs.join("\n\n") : "Relatório não encontrado.");
        await next();
        return;
      }

      const text = normalizeTeamsMessage(context.activity.text || "");

      if (!text) {
        await next();
        return;
      }

      const command = text.toLowerCase();

      if (command === "help" || command === "ajuda") {
        await context.sendActivity({ attachments: [buildHelpCard()] });
      } else if (command === "status") {
        await answerStatus(context);
      } else if (command === "meus relatórios" || command === "meus relatorios") {
        await listMyReports(context);
      } else if (command === "limpar") {
        await context.sendActivity("Para remover relatórios salvos, isso será implementado em etapa futura.");
      } else {
        await handleQuestion(context, text);
      }

      await next();
    });
  }
}
