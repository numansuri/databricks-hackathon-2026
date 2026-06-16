# Outreach drafting flow

Shiftlink lets a specialist doctor turn a recommended facility into a tailored,
ready-to-send introductory message. This doc covers the design implemented in
`server/outreach.js`, `server.js`, and the `OutreachPanel` in `src/App.jsx`.

## The flow

1. The doctor picks a recommended facility and clicks **Draft outreach for approval**.
2. The frontend POSTs the facility + the doctor's profile to **`POST /api/outreach`**.
3. The server picks the best **contact channel deterministically** (server-side, not
   the model) and calls an LLM to draft a short, warm message tailored to the facility
   and the doctor's specialty.
4. The doctor reviews the draft in the panel: switch channel, edit the subject/body,
   then **approve**.
5. "Sending" is a prefilled native action — `mailto:`, `tel:`, `wa.me/<digits>?text=`,
   open website/Facebook page, or **Copy message** to paste anywhere. There is **no
   mail server** in this prototype.

## Provider-agnostic LLM (OpenAI SDK)

All LLM calls go through the official OpenAI SDK. The SDK's `baseURL` is configurable,
so the **same code** talks to either provider:

- **Databricks Foundation Model APIs (default, in-network).** The SDK points at
  `${DATABRICKS_HOST}/serving-endpoints`. This is the production path: a deployed
  Databricks **Free Edition** app has **no external internet egress**, so it cannot
  reach `api.openai.com` — but it *can* reach in-network serving endpoints. The default
  model is `databricks-llama-4-maverick`, served in-network.
- **OpenAI direct (`api.openai.com`).** Used for local dev or any tier with egress +
  OpenAI credits. Default model `gpt-4.1-mini`.

Provider auto-detects: `OPENAI_API_KEY` → openai; else `DATABRICKS_HOST`/`DATABRICKS_CLIENT_ID`
→ databricks; else `none`. Override with `LLM_PROVIDER` / `OUTREACH_MODEL`.

### In-network model availability (this Free Edition workspace, verified 3x/model)

- `databricks-llama-4-maverick` — **enabled, default**. Fast (~1.7s), non-reasoning,
  reliably returns clean tailored JSON (3/3 success).
- `databricks-gpt-oss-120b` — OpenAI's open model, also **enabled**, **but** a *reasoning*
  model that is **unreliable for strict-JSON drafting** here (3/3 fail): it spends its
  token budget reasoning and truncates the final JSON at `max_tokens=1500`. Not the
  default; only usable with a much larger `max_tokens`.
- `databricks-gemini-3-5-flash`, `databricks-claude-opus-4-8` — **gated (disabled)** here
  (PERMISSION_DENIED / rate limit 0).

Databricks serving endpoints **always reject** `response_format: json_object` (400), so the
**Databricks path makes a single call without it** and relies on the prompt to return JSON.
The **OpenAI-direct path sends `response_format: json_object`** and transparently retries
once without it if the endpoint rejects the param. `extractJson` tolerates fenced blocks
and the array-of-`{reasoning,text}` content shape that reasoning models emit.

### Auth

- **Deployed app:** Databricks injects `DATABRICKS_HOST` + `DATABRICKS_CLIENT_ID` +
  `DATABRICKS_CLIENT_SECRET`. The server does an **OAuth M2M (client_credentials)** token
  exchange against `${HOST}/oidc/v1/token` (scope `all-apis`) and caches the token until
  ~5 min before expiry.
- **Local dev:** a `DATABRICKS_TOKEN` (PAT) short-circuits the OAuth flow.

## `POST /api/outreach` contract

Request:

```json
{
  "facility": { "id, name, type, city, state, email, phone, website, facebook, capabilities[], match" },
  "doctor":   { "name, specialties[], regions[], experienceYears" },
  "district_need": "string|null",
  "preferred_channel": "email|phone|whatsapp|website|facebook|null"
}
```

`facility.name` is required (400 otherwise). Response:

```json
{
  "recommended_channel": "email",
  "available_channels": ["email", "phone", "whatsapp"],
  "channel_values": { "email, phone, website, facebook, whatsapp" },
  "subject": "string|null",   // null unless channel is email
  "body": "string",
  "phone_sms_script": "string",
  "source": "ai" | "template"
}
```

### Deterministic channel selection

`resolveChannels` builds the available set from the facility's contact fields, in priority
order **email > phone > whatsapp > website > facebook**. WhatsApp is offered only when the
phone looks like an Indian mobile (10 digits starting 6-9, optionally `+91`), as
`https://wa.me/<digits>`. A caller-supplied `preferred_channel` wins if it's available.
If nothing is contactable, channel is `none` and the endpoint skips the LLM.

## Resilience & guard rails

- **Template fallback.** Any LLM failure (no provider, gated model, network, bad JSON,
  empty body) is caught and the endpoint returns a local template draft
  (`source: "template"`) — the UI never hard-fails. The frontend `localOutreachDraft`
  mirrors the same logic so it works even if `/api/outreach` itself is unreachable.
- **Per-process call cap.** `OUTREACH_MAX_CALLS` (default 500) caps total LLM calls for
  the process lifetime so a shared key/endpoint can't be drained (the app has no per-user
  auth). Resets on restart. Setting it to 0 forces the template path.

## Out of scope (intentionally)

- **No real email server / sending.** Channels are prefilled native links + copy only.
- **No web-search contact-finding** for the ~3.6% of facilities that have only a
  website/Facebook page and no email/phone.
- **No live Unity Catalog queries** at request time — the facility + need data is passed
  in from the already-loaded frontend state.

## Deploy notes

- `databricks.yml` declares an `outreach_model` **serving-endpoint resource**
  (`databricks-llama-4-maverick`, `CAN_QUERY`) and sets `LLM_PROVIDER=databricks` plus
  `OUTREACH_MODEL` from that resource.
- OAuth M2M credentials (`DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET`) and
  `DATABRICKS_HOST` are auto-injected into the deployed app.
- Free Edition apps **auto-stop after ~24h** of inactivity; the in-process LLM call
  counter and any cached token reset on the next start.
