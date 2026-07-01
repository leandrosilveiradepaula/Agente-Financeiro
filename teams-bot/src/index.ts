import "dotenv/config";
import express from "express";
import { BotFrameworkAdapter } from "botbuilder";
import { DuckLakeTeamsBot } from "./bot.js";

const port = Number(process.env.TEAMS_BOT_PORT || 3978);
const app = express();

app.use(express.json());

const adapter = new BotFrameworkAdapter({
  appId: process.env.TEAMS_BOT_APP_ID,
  appPassword: process.env.TEAMS_BOT_APP_PASSWORD
});

adapter.onTurnError = async (context, error) => {
  console.error("ducklake_teams.turn_error", {
    error: error instanceof Error ? error.message : "UnknownError"
  });
  await context.sendActivity(
    "Não consegui concluir a ação agora. Tente novamente ou acione o suporte."
  );
};

const bot = new DuckLakeTeamsBot();

app.post("/api/messages", (req, res) => {
  adapter.processActivity(req, res, async (context) => {
    await bot.run(context);
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    endpointConfigured: Boolean(process.env.DUCKLAKE_AGENT_ENDPOINT),
    storage: process.env.SAVED_REPORTS_FILE || "./data/saved-reports.json"
  });
});

app.listen(port, () => {
  console.info(`DuckLake Teams Bot listening on http://localhost:${port}`);
});
