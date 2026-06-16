# Shiftlink

Frontend prototype for the Databricks Apps and Agents Hackathon for Good (DAIS 2026).

**Live Databricks app:** [referral-copilot](https://referral-copilot-7474659963071016.aws.databricksapps.com)

The deployed app may require Databricks workspace sign-in.

Shiftlink is a role-based hospital exchange for referral and volunteering workflows. Doctors search facilities, inspect evidence, shortlist options, and send scheduling requests. Hospitals get a separate exchange view where they can approve or deny requests sent to their facility, and they can also request doctors directly from the local user table.

## Current Status

This repository currently contains a working React/Vite prototype with a small Node/Express server for OpenAI-backed API routes.

Implemented:

- Doctor practice context field directly in doctor sign-up, with a fallback onboarding screen when a doctor account has no saved profile.
- Local sign-up and login flow for doctor and hospital accounts.
- Local browser-backed user database in `localStorage`.
- Hospital sign-up fields for hospital name, street address, phone number, and optional Facebook page.
- Text entry for specialties, experience, preferred regions, and volunteering interests.
- Browser audio capture with `MediaRecorder`.
- Speech-to-text handoff to `POST /api/transcribe`.
- OpenAI transcription through the server-side `OPENAI_API_KEY`.
- Demo transcript fallback when `/api/transcribe` is not available.
- Local doctor profile persistence in `localStorage`.
- Doctor app shell with Search, Schedule, and Shortlist tabs.
- Lakehouse-backed facility loading from `GET /api/facilities`.
- Search panel with ranked Lakehouse facility cards above a bottom-docked chat transcript and input.
- Streaming chatbot endpoint at `POST /api/chat/stream`.
- Non-streaming structured chatbot endpoint at `POST /api/chat`.
- OpenAI `gpt-5.5` chatbot responses with medium reasoning by default.
- Structured chatbot metadata for assistant reply text, map queries, facility IDs, proposed profile add/remove changes, guardrail status, and data-source status.
- Google Maps JavaScript API integration when `GET /api/config` returns a Google Maps key.
- Google Maps fallback map when no API key is configured.
- Lakehouse facility markers using Google Maps Advanced Markers.
- Google Places hospital search from the map toolbar.
- Chat-to-map handoff when the assistant returns a `mapQuery`.
- Facility cards, evidence drawer, contact links, trust tiers, shortlist actions, and schedule builder.
- Hospital exchange view for facility-specific scheduling request review.
- Hospital approve and deny actions for pending doctor-to-hospital requests.
- Hospital-to-doctor requests from the local doctor account list.
- Doctor accept and decline actions for hospital-originated requests.
- Automatic schedule insertion when a doctor accepts a hospital request.
- Local scheduling request persistence in `localStorage`.
- Shiftlink light and dark theme toggle persisted in `localStorage`.
- Databricks Apps bundle configuration in `databricks.yml`.
- Production build with Vite.

Not implemented yet:

- Runtime persistence to backend tables for users, doctor profiles, shortlists, schedules, or two-way scheduling decisions.
- Persistent chat history beyond the browser session.
- Automatic persistence of chatbot-proposed profile context changes.
- LLM-powered evidence scoring or email generation.
- Production authentication, authorization, password hashing, or session management.
- Patient records or PHI handling.

## Runtime Facility Data

The deployed app is configured with `SHIFTLINK_DATA_MODE=lakehouse`. In that mode, the Node server loads facility records from:

- `workspace.virtue_foundation_enriched.gold_facilities`

`GET /api/facilities` queries Databricks SQL Statement Execution through the configured SQL warehouse, maps selected `gold_facilities` columns into the React facility-card shape, and returns `dataAccess` metadata for the UI. The doctor workspace shows the returned Lakehouse record count in the data-source strip.

The app keeps three hardcoded demo facilities in `src/App.jsx` only as a fallback if the Lakehouse endpoint is unavailable.

The Lakehouse-backed UI records include:

- facility name, type, city, state, distance, latitude, longitude
- trust tier: `strong`, `partial`, or `weak`
- evidence snippets from fields such as clinical signals, equipment, specialties, bed count, doctor count, contact verification, and emergency-readiness tier
- verification and quality flags
- phone and email contact fields

The map plots the currently loaded Lakehouse facility records. Google Places search results render as a separate live-results layer on top of that dataset layer.

## Data Sources

The current app runtime uses the enriched Lakehouse table `workspace.virtue_foundation_enriched.gold_facilities`. The runtime data source is reported by `GET /api/data-status`; the Databricks app is configured with `SHIFTLINK_DATA_MODE=lakehouse`.

The Lakehouse-oriented SQL assets target the Virtue Foundation dataset in Databricks Unity Catalog:

- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities`
- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory`
- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators`

The app does not query the read-only source tables directly at runtime. It queries the derived serving table in the workspace catalog:

- `workspace.virtue_foundation_enriched.gold_facilities`

## Table Naming Contract

Shiftlink keeps facility analytics and app-owned persistence in separate namespaces:

| Purpose | Namespace | Status |
|---|---|---|
| Facility analytics, derived from the Virtue Foundation dataset | `workspace.virtue_foundation_enriched` | Live |
| App-owned users, profiles, and scheduling state | `workspace.shiftlink_app` in Databricks docs/metadata; `shiftlink_app` inside Lakebase Postgres SQL | Planned |

Current runtime facility table:

- `workspace.virtue_foundation_enriched.gold_facilities`

Related Lakehouse tables available for future recommendation work:

- `workspace.virtue_foundation_enriched.gold_pincode`
- `workspace.virtue_foundation_enriched.gold_nfhs_district`
- `workspace.virtue_foundation_enriched.fct_facility_specialty`
- `workspace.virtue_foundation_enriched.gold_demand_supply_gap`

Planned app persistence table names:

- `workspace.shiftlink_app.users`
- `workspace.shiftlink_app.doctor_profiles`
- `workspace.shiftlink_app.hospital_profiles`
- `workspace.shiftlink_app.referral_shortlist`
- `workspace.shiftlink_app.schedule_requests`
- `workspace.shiftlink_app.chat_events`
- `workspace.shiftlink_app.map_searches`

The app does not currently query `workspace.shiftlink_app.*`; local account/profile/scheduling state remains browser-backed until backend auth and persistence routes are implemented. The Lakebase schema artifact for the user/profile subset is [`sql/20_shiftlink_app_user_database.sql`](sql/20_shiftlink_app_user_database.sql).

Useful repo context:

- `findings/dataset-deep-dive.md` summarizes the source tables and data quality traps.
- `docs/superpowers/specs/2026-06-16-shiftlink-integration-spec.md` is the latest planning/spec document. It is reference material and is not fully implemented in the current React prototype.
- `docs/shiftlink-user-database-lakebase.md` documents the planned Lakebase user/profile tables using the Shiftlink table naming contract.
- `docs/superpowers/specs/2026-06-16-onboarding-flow-final.md`, `docs/superpowers/specs/2026-06-16-recommender-changes.md`, `docs/superpowers/specs/2026-06-16-outreach-changes.md`, and `docs/superpowers/specs/2026-06-16-scheduler-agent-final.md` are feature planning/reference docs.
- `docs/visual-directions/referral-copilot-mockups.html` contains the visual direction board used before selecting the Hospital Exchange design direction.
- `explore.py` is a local Databricks exploration script. It is not part of the React app runtime.

## App Flows

### Account Access

The first screen is a role-based sign-up/login view.

Supported local account types:

- `doctor`
- `hospital`

Doctor accounts provide practice context during sign-up, then enter the referral workspace. Hospital accounts enter their hospital name, street address, phone number, and optional Facebook page, then enter that hospital's exchange view.

Current local storage keys:

- `referralCopilotUsers` stores prototype user accounts.
- `referralCopilotSessionUserId` stores the active local session.
- `referralCopilotScheduleRequests` stores two-way scheduling requests.

Passwords and hospital profile fields are stored in localStorage for prototype purposes only. This is not production authentication.

### Doctor Context

During doctor sign-up, the doctor fills in a profile textarea with specialties, experience, languages, preferred regions, and volunteering interests. The setup copy tells the doctor that this context can be updated, added to, or removed later through the chatbot.

If an older local doctor account has no saved profile, the app shows the same context editor as a fallback onboarding screen before the doctor enters the main workspace.

The `Speak` control:

1. Requests microphone access in the browser.
2. Records audio with `MediaRecorder`.
3. Sends an audio blob to `POST /api/transcribe`.
4. Adds the returned transcript to the textarea.

If the endpoint is unavailable, the prototype inserts a demo transcript so the UI can still be tested without a backend.

The saved doctor profile is stored per user in `localStorage` under `referralCopilotDoctorProfile:{userId}`.

### Search

The Search tab has:

- a bottom-docked streaming chat interaction area
- a chat input
- ranked Lakehouse facility cards
- a visible data-source strip showing whether search is using Lakehouse data or local fallback data
- a Google map or fallback map
- a map search field for cities, districts, and hospital locations
- Google Places search results shown as a separate live-results layer when the Maps key supports Places
- an evidence drawer for the selected facility

The chatbot streams from `POST /api/chat/stream` and keeps `POST /api/chat` as a non-streaming structured fallback. The server uses `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5.5`), `OPENAI_REASONING_EFFORT` (default `medium`), and `OPENAI_STREAM_TIMEOUT_MS` (default `45000`). Server-side guardrails keep the assistant focused on hospital search, doctor context, outreach, map logistics, and two-way scheduling. If the OpenAI key is missing or the streaming request fails, the endpoint streams a local fallback response so the UI remains usable.

`GET /api/data-status` reports the active data mode. In Databricks, the app runs with `SHIFTLINK_DATA_MODE=lakehouse`; chat and facility cards use the facility list returned by `/api/facilities` from the enriched Lakehouse table. If the Lakehouse endpoint fails, the frontend falls back to the local demo facilities and marks the data-source strip accordingly.

### Shortlist

The Shortlist tab shows facilities saved during the current browser session. Shortlist state is React state only; it is not persisted to a backend.

### Schedule

The Schedule tab lets the doctor add planned visits to facilities. Adding a visit also creates a pending doctor-to-hospital scheduling request in `referralCopilotScheduleRequests`. The doctor's in-memory schedule list and weekly ribbon update immediately.

The same tab shows hospital-to-doctor requests. The doctor can accept or decline those requests. Accepting a hospital request changes that request to `approved` and inserts the visit into the doctor's in-memory schedule.

### Hospital Exchange

Hospital users see a facility-specific exchange queue. Requests are filtered by the hospital profile created during sign-up.

The exchange view shows:

- pending, approved, and denied counts
- a request form populated from local doctor accounts
- hospital-entered name, address, phone, email, and optional Facebook page
- doctor name and email
- requested date and time
- request purpose
- approve and deny buttons for pending doctor-originated requests
- an outgoing queue for requests sent to doctors
- facility contact and evidence context

Hospital decisions and doctor decisions are stored in `referralCopilotScheduleRequests` in the browser.

## Tech Stack

- React 19
- Vite 8
- Node/Express API server
- OpenAI SDK
- lucide-react icons
- Google Maps JavaScript API
- Google Places Library for Maps JavaScript
- Browser `MediaRecorder` API
- Local browser storage for users, sessions, profiles, and requests in the current prototype

The project was tested locally with Node `v25.3.0` and npm `11.7.0`.

## Local Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Add a Google Maps API key. `GOOGLE_MAPS_API_KEY` is read by the Node server at runtime, while `VITE_GOOGLE_MAPS_API_KEY` keeps local Vite builds compatible:

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_javascript_api_key
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_javascript_api_key
```

Add a server-side OpenAI key:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=medium
OPENAI_STREAM_TIMEOUT_MS=45000
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
SHIFTLINK_DATA_MODE=lakehouse
SHIFTLINK_FACILITIES_TABLE=workspace.virtue_foundation_enriched.gold_facilities
```

For local Lakehouse testing, also provide Databricks workspace credentials and a SQL warehouse ID:

```bash
DATABRICKS_HOST=https://dbc-87f85fc5-dc00.cloud.databricks.com
DATABRICKS_SQL_WAREHOUSE_ID=260da0aaab951fdb
DATABRICKS_TOKEN=your_local_databricks_token
```

In Databricks Apps, `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET` are injected by the app runtime, so the deployed app does not need a committed Databricks token.

Optional for production-style Maps configuration:

```bash
GOOGLE_MAPS_MAP_ID=your_google_maps_map_id
VITE_GOOGLE_MAP_ID=your_google_maps_map_id
```

Run the integrated Vite and API dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

Build for production:

```bash
npm run build
```

Preview a production build with Vite only:

```bash
npm run preview
```

Run the production start command used by Databricks Apps:

```bash
npm run start
```

`npm run start` builds the Vite app and starts the Node server that serves `dist/` plus `/api/chat`, `/api/chat/stream`, `/api/transcribe`, `/api/config`, `/api/data-status`, and `/api/health`.

## Databricks Apps Configuration

`databricks.yml` defines a Databricks Apps bundle for the existing app resource:

- App resource name: `referral_copilot`
- Databricks app name: `referral-copilot`
- Workspace host: `https://dbc-87f85fc5-dc00.cloud.databricks.com`
- Start command: `npm run start`
- Google Maps secret reference: scope `referral-copilot`, key `google-maps-api-key`
- OpenAI secret reference: scope `referral-copilot`, key `openai-api-key`
- SQL warehouse resource: `260da0aaab951fdb`
- Unity Catalog table resource: `workspace.virtue_foundation_enriched.gold_facilities`
- Runtime env aliases: `GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, and `OPENAI_API_KEY`
- OpenAI defaults in the app config: `OPENAI_MODEL=gpt-5.5`, `OPENAI_REASONING_EFFORT=medium`, `OPENAI_STREAM_TIMEOUT_MS=45000`
- Data source mode: `SHIFTLINK_DATA_MODE=lakehouse`

The Databricks app resource name and URL still use the earlier `referral-copilot` deployment name, while the product UI shown to users is Shiftlink.

## Google Maps Configuration

The live map branch is enabled when `GET /api/config` returns a Google Maps key. The server reads `GOOGLE_MAPS_API_KEY` first and falls back to `VITE_GOOGLE_MAPS_API_KEY`.

The app loads:

- Maps JavaScript API
- `marker` library
- `places` library
- Advanced Markers

The map toolbar uses Google Places to search hospital locations near the doctor's query. Lakehouse facility markers remain visible as the dataset layer, while Google Places search results render as a separate live-results layer.

The code uses `GOOGLE_MAPS_MAP_ID` or `VITE_GOOGLE_MAP_ID` when provided. If no map ID is provided, the app falls back to `DEMO_MAP_ID`, which is suitable for local prototype rendering but should be replaced for production.

The `.env` file is ignored by git. Do not commit real API keys. The Google Maps JavaScript key is returned to browser JavaScript by `/api/config` because Maps JS keys are client-side keys. `OPENAI_API_KEY` must stay server-side and must not be prefixed with `VITE_`.

## Repository Layout

```text
.
|-- README.md
|-- databricks.yml
|-- docs/
|   |-- shiftlink-user-database-lakebase.md
|   |-- visual-directions/
|   |   `-- referral-copilot-mockups.html
|   |-- superpowers/specs/
|   `-- sql/
|-- findings/dataset-deep-dive.md
|-- ideas/README.md
|-- recommender/
|-- sql/
|-- explore.py
|-- index.html
|-- package.json
|-- package-lock.json
|-- server.mjs
|-- src/
|   |-- App.jsx
|   |-- main.jsx
|   `-- styles.css
`-- .env.example
```

Generated or local-only paths:

- `node_modules/`
- `dist/`
- `.env`

These are ignored by `.gitignore`.

## Verification

Verified on 2026-06-16 in this workspace with:

```bash
npm run build
npm audit --json
databricks bundle validate
databricks apps get referral-copilot -o json
curl 'http://127.0.0.1:5174/api/facilities?limit=5'
```

Current verification results:

- `npm run build` completed successfully.
- `npm audit --json` reported zero vulnerabilities.
- `databricks bundle validate` completed successfully for the `dev` target.
- `databricks apps deploy --auto-approve` completed successfully.
- `databricks apps get referral-copilot -o json` reported the app in `RUNNING` state with active compute.
- Active Databricks deployment ID: `01f169c9445612f38f6586944d319fc5`.
- Active Databricks deployment status: `SUCCEEDED`.
- `databricks grants get table workspace.virtue_foundation_enriched.gold_facilities -o json` shows the app service principal has `SELECT`.
- Local Lakehouse-mode `/api/facilities?limit=5` returned five records from `workspace.virtue_foundation_enriched.gold_facilities`.
- The in-app browser rendered the doctor workspace with `Lakehouse Delta tables`, `24 live records`, and real facility names from the enriched table.

## Security and Privacy Notes

- `.env` is ignored by git.
- The Google Maps API key should be restricted in Google Cloud before any public deployment.
- No patient-record workflow is implemented; users should not enter PHI into the prototype.
- The prototype does not send email.
- The prototype does not persist users, doctor context, shortlists, schedules, or hospital decisions outside the browser.
- Prototype passwords are stored in localStorage and must be replaced with real authentication before deployment.
- The speech recording flow sends audio to `/api/transcribe`; audio is processed server-side with the configured OpenAI transcription model.

## Next Engineering Steps

1. Pass doctor profile, specialty, and region filters into `/api/facilities` instead of using one default Lakehouse query.
2. Extend runtime search beyond `gold_facilities` to include district need and specialty gap tables.
3. Add recommendation scoring backed by `gold_demand_supply_gap` and related Lakehouse fields.
4. Add backend user accounts, password hashing, session management, and role authorization.
5. Persist doctor profiles, hospital profiles, referral shortlists, schedule requests, chat events, and map searches under the `workspace.shiftlink_app` app namespace.
6. Add email draft generation only if a send/review workflow is also implemented.
