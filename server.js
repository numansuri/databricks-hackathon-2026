import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDraft, templateDraft, resolveChannels, llmStatus } from "./server/outreach.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const INDEX_HTML = path.join(DIST, "index.html");
const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 4173;

// Guard rail: cap total LLM calls per process lifetime so a shared key/endpoint
// can't be drained (there is no per-user auth inside the app). Resets on restart.
// Parse defensively: a bad value (e.g. "abc" -> NaN) must NOT silently disable the
// cap, so fall back to the default and floor at 0.
function parseMaxCalls(raw) {
  if (raw === undefined || raw === "") return 500;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500;
}
const MAX_LLM_CALLS = parseMaxCalls(process.env.OUTREACH_MAX_CALLS);
let llmCalls = 0;

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    llm: llmStatus(),
    llmCalls,
    maxLlmCalls: MAX_LLM_CALLS,
    distBuilt: fs.existsSync(INDEX_HTML),
  });
});

app.post("/api/outreach", async (req, res) => {
  const { facility, doctor, district_need = null, preferred_channel = null } = req.body || {};
  if (!facility || typeof facility !== "object" || !facility.name) {
    return res.status(400).json({ error: "facility (with at least a name) is required" });
  }

  const channels = resolveChannels(facility, preferred_channel);
  const channel = channels.recommended;

  const respond = (draft) =>
    res.json({
      recommended_channel: channel,
      available_channels: channels.available,
      channel_values: channels.values,
      subject: draft.subject,
      body: draft.body,
      phone_sms_script: draft.phone_sms_script,
      source: draft.source,
    });

  const fallback = () => respond(templateDraft({ facility, doctor, district_need, channel }));

  if (channel === "none" || llmCalls >= MAX_LLM_CALLS) {
    return fallback();
  }

  try {
    llmCalls += 1;
    return respond(await generateDraft({ facility, doctor, district_need, channel }));
  } catch (err) {
    console.error("[/api/outreach] LLM failed, using template:", err?.message || err);
    return fallback();
  }
});

// Unknown /api/* routes return a JSON 404 — never fall through to the SPA shell,
// which would mask broken API calls (e.g. /api/transcribe) with a 200 + index.html.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Static frontend + SPA fallback (works across Express 4/5).
app.use(express.static(DIST));
app.use((req, res) => {
  if (fs.existsSync(INDEX_HTML)) return res.sendFile(INDEX_HTML);
  res
    .status(503)
    .send("Frontend not built yet. Run `npm run build` to produce dist/, then restart.");
});

app.listen(PORT, "0.0.0.0", () => {
  const s = llmStatus();
  console.log(
    `Shiftlink server on :${PORT} — LLM provider=${s.provider} model=${s.model} configured=${s.configured} distBuilt=${fs.existsSync(INDEX_HTML)}`
  );
});
