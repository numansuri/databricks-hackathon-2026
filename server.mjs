import "dotenv/config";

import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { createServer as createViteServer } from "vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");
const port = Number(process.env.PORT || process.env.DATABRICKS_APP_PORT || (isDev ? 5173 : 4173));
const host = process.env.HOST || "0.0.0.0";
const openaiApiKey = process.env.OPENAI_API_KEY || "";
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const app = express();
app.use(express.json({ limit: "1mb" }));

const chatSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "intent", "mapQuery", "facilityIds", "profileUpdates", "suggestedQuickPrompts"],
  properties: {
    reply: {
      type: "string",
      description: "Concise assistant message for the doctor."
    },
    intent: {
      type: "string",
      enum: ["facility_search", "map_search", "schedule_help", "profile_update", "outreach_help", "general"],
      description: "Primary user intent."
    },
    mapQuery: {
      type: ["string", "null"],
      description: "Location or hospital search text the map should run, or null when no map search is needed."
    },
    facilityIds: {
      type: "array",
      description: "Relevant facility IDs from the provided pseudo dataset.",
      items: { type: "string" }
    },
    profileUpdates: {
      type: "object",
      additionalProperties: false,
      required: ["add", "remove"],
      properties: {
        add: {
          type: "array",
          description: "Profile facts the doctor appears to want added.",
          items: { type: "string" }
        },
        remove: {
          type: "array",
          description: "Profile facts the doctor appears to want removed.",
          items: { type: "string" }
        }
      }
    },
    suggestedQuickPrompts: {
      type: "array",
      description: "Two or three short next actions the doctor may want.",
      items: { type: "string" }
    }
  }
};

const shiftlinkInstructions = [
  "You are Shiftlink's coverage assistant for doctors coordinating hospital referrals, volunteer visits, and scheduling handoffs.",
  "Use only the doctor profile, conversation, pseudo facility dataset, and schedule context supplied by the app.",
  "Do not provide diagnosis, treatment, emergency triage, or patient-specific medical advice.",
  "Do not claim a request was sent, approved, denied, or added to a calendar unless the app context says it already happened.",
  "When the doctor asks to search a place, city, district, or hospital area, set mapQuery to a clean map search string.",
  "When the doctor asks to change their profile context, summarize the proposed add/remove items in profileUpdates and explain that this prototype still needs confirmation before persisting those changes.",
  "Prefer concrete, operational language. Keep replies under 120 words unless the doctor asks for detail."
].join("\n");

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeChatPayload(payload, source = "openai") {
  return {
    reply:
      typeof payload.reply === "string" && payload.reply.trim()
        ? payload.reply.trim()
        : "I can help search facilities, update your context, or reason through scheduling next steps.",
    intent: typeof payload.intent === "string" ? payload.intent : "general",
    mapQuery: typeof payload.mapQuery === "string" && payload.mapQuery.trim() ? payload.mapQuery.trim() : null,
    facilityIds: safeArray(payload.facilityIds).filter((item) => typeof item === "string"),
    profileUpdates: {
      add: safeArray(payload.profileUpdates?.add).filter((item) => typeof item === "string"),
      remove: safeArray(payload.profileUpdates?.remove).filter((item) => typeof item === "string")
    },
    suggestedQuickPrompts: safeArray(payload.suggestedQuickPrompts)
      .filter((item) => typeof item === "string" && item.trim())
      .slice(0, 3),
    source
  };
}

function fallbackChatResponse(message, facilities) {
  const lower = message.toLowerCase();
  const wantsMap =
    /\b(map|near|nearby|around|search|find|location|hospital|clinic|city|district|mumbai|delhi|ahmedabad|rajasthan|gujarat)\b/.test(
      lower
    );
  const profileAdd = /\b(add|update|include|remember)\b/.test(lower);
  const profileRemove = /\b(remove|forget|delete|drop)\b/.test(lower);
  const strong = facilities.find((facility) => facility.tier === "strong") || facilities[0];

  return normalizeChatPayload(
    {
      reply: openaiApiKey
        ? `I could not reach the LLM just now, so I’m using the local fallback. ${strong?.name || "The strongest match"} still looks like the best dataset-backed option, and I can run that map search for you.`
        : "The OpenAI key is not available to the server yet. I’m using the local fallback so you can keep testing search, profile, and scheduling flows.",
      intent: profileAdd || profileRemove ? "profile_update" : wantsMap ? "map_search" : "facility_search",
      mapQuery: wantsMap ? message : null,
      facilityIds: strong ? [strong.id] : [],
      profileUpdates: {
        add: profileAdd ? [message] : [],
        remove: profileRemove ? [message] : []
      },
      suggestedQuickPrompts: [
        "Hospitals near Ahmedabad",
        "Facilities with ICU evidence",
        "Update my profile context"
      ]
    },
    "fallback"
  );
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    openaiConfigured: Boolean(openai),
    model: process.env.OPENAI_MODEL || "gpt-5.5"
  });
});

app.post("/api/chat", async (req, res) => {
  const {
    message = "",
    messages = [],
    profile = null,
    facilities = [],
    selectedFacility = null,
    schedule = [],
    requests = []
  } = req.body || {};
  const trimmedMessage = String(message).trim();

  if (!trimmedMessage) {
    return res.status(400).json({ message: "Message is required." });
  }

  if (!openai) {
    return res.json(fallbackChatResponse(trimmedMessage, safeArray(facilities)));
  }

  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || "medium" },
      instructions: shiftlinkInstructions,
      input: [
        {
          role: "user",
          content: JSON.stringify({
            doctorProfile: profile,
            selectedFacility,
            facilities: safeArray(facilities).map((facility) => ({
              id: facility.id,
              name: facility.name,
              type: facility.type,
              city: facility.city,
              state: facility.state,
              tier: facility.tier,
              score: facility.score,
              match: facility.match,
              evidence: facility.evidence,
              flags: facility.flags
            })),
            schedule,
            requests,
            conversation: safeArray(messages).slice(-8),
            userMessage: trimmedMessage
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "shiftlink_chat_response",
          description: "Structured response for the Shiftlink doctor-facing chatbot.",
          strict: true,
          schema: chatSchema
        },
        verbosity: "low"
      }
    });

    const parsed = JSON.parse(response.output_text || "{}");
    res.json(normalizeChatPayload(parsed));
  } catch (error) {
    console.error("OpenAI chat failed", error);
    res.json(fallbackChatResponse(trimmedMessage, safeArray(facilities)));
  }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Audio file is required." });
  }
  if (!openai) {
    return res.status(503).json({ message: "OpenAI is not configured." });
  }

  try {
    const file = await toFile(req.file.buffer, req.file.originalname || "doctor-profile.webm", {
      type: req.file.mimetype || "audio/webm"
    });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe"
    });
    res.json({ transcript: transcription.text || "" });
  } catch (error) {
    console.error("OpenAI transcription failed", error);
    res.status(502).json({ message: "Transcription failed." });
  }
});

if (isDev) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
} else {
  const distPath = resolve(__dirname, "dist");
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      return next();
    }
    res.sendFile(join(distPath, "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`Shiftlink server listening on http://${host}:${port}`);
});
