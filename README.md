# Shiftlink

Frontend prototype for the Databricks Apps and Agents Hackathon for Good (DAIS 2026).

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
- Chat-style left panel connected to `POST /api/chat`.
- OpenAI `gpt-5.5` chatbot responses with medium reasoning by default.
- Structured chatbot output for assistant reply text, map queries, facility IDs, quick prompts, and proposed profile add/remove changes.
- Google Maps JavaScript API integration when `VITE_GOOGLE_MAPS_API_KEY` is set.
- Google Maps fallback map when no API key is configured.
- Pseudo facility markers using Google Maps Advanced Markers.
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

- Live Databricks SQL queries from the frontend.
- Persistent backend tables for users, doctor profiles, shortlists, schedules, or two-way scheduling decisions.
- Persistent chat history beyond the browser session.
- Automatic persistence of chatbot-proposed profile context changes.
- LLM-powered evidence scoring or email generation.
- Production authentication, authorization, password hashing, or session management.
- Patient records or PHI handling.

## Demo Data

The frontend currently uses hardcoded pseudo facility data in `src/App.jsx`.

The pseudo data is intentionally shaped like the planned Databricks data path:

- facility name, type, city, state, distance, latitude, longitude
- trust tier: `strong`, `partial`, or `weak`
- evidence snippets from fields such as capability, procedure, equipment, specialties, and description
- weak-evidence flags
- phone and email contact fields

The map currently plots three pseudo facilities around Ahmedabad.

## Planned Data Sources

The product design targets the Virtue Foundation dataset in Databricks Unity Catalog:

- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities`
- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory`
- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators`

The current frontend does not query these tables directly.

Useful repo context:

- `findings/dataset-deep-dive.md` summarizes the source tables and data quality traps.
- `docs/superpowers/specs/2026-06-15-referral-copilot-design.md` contains the broader design spec.
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

- a chat-style interaction area
- quick prompt buttons
- a search input
- ranked pseudo facility cards
- a Google map or fallback map
- a map search field for cities, districts, and hospital locations
- Google Places search results shown as a separate live-results layer when the Maps key supports Places
- an evidence drawer for the selected facility

The chatbot calls the local server at `POST /api/chat`. The server uses `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5.5`), and `OPENAI_REASONING_EFFORT` (default `medium`). If the OpenAI key is missing or the request fails, the endpoint returns a local fallback response so the UI remains usable.

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

Add a Google Maps API key:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_javascript_api_key
```

Add a server-side OpenAI key:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.5
OPENAI_REASONING_EFFORT=medium
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
```

Optional for production-style Maps configuration:

```bash
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

`npm run start` builds the Vite app and starts the Node server that serves `dist/` plus `/api/chat`, `/api/transcribe`, and `/api/health`.

## Databricks Apps Configuration

`databricks.yml` defines a Databricks Apps bundle for the existing app resource:

- App resource name: `referral_copilot`
- Databricks app name: `referral-copilot`
- Workspace host: `https://dbc-87f85fc5-dc00.cloud.databricks.com`
- Start command: `npm run start`
- Google Maps secret reference: scope `referral-copilot`, key `google-maps-api-key`
- OpenAI secret reference: scope `referral-copilot`, key `openai-api-key`

The Databricks app resource name and URL still use the earlier `referral-copilot` deployment name, while the product UI shown to users is Shiftlink.

## Google Maps Configuration

The live map branch is enabled when `VITE_GOOGLE_MAPS_API_KEY` is present.

The app loads:

- Maps JavaScript API
- `marker` library
- `places` library
- Advanced Markers

The map toolbar uses Google Places to search hospital locations near the doctor's query. The curated pseudo facility markers remain visible as the dataset layer, while Google Places search results render as a separate live-results layer.

The code uses `VITE_GOOGLE_MAP_ID` when provided. If no map ID is provided, the app falls back to `DEMO_MAP_ID`, which is suitable for local prototype rendering but should be replaced for production.

The `.env` file is ignored by git. Do not commit real API keys. `VITE_GOOGLE_MAPS_API_KEY` is intentionally available to browser JavaScript because Google Maps JS keys are client-side keys. `OPENAI_API_KEY` must stay server-side and must not be prefixed with `VITE_`.

## Repository Layout

```text
.
|-- README.md
|-- databricks.yml
|-- docs/
|   |-- visual-directions/
|   |   `-- referral-copilot-mockups.html
|   `-- superpowers/specs/2026-06-15-referral-copilot-design.md
|-- findings/dataset-deep-dive.md
|-- ideas/README.md
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

The current frontend has been verified with:

```bash
npm run build
npm audit --json
```

At the time this README was written:

- `npm run build` completed successfully.
- `npm audit --json` reported zero vulnerabilities.
- `GET /api/health` confirmed the local server sees the OpenAI configuration.
- `POST /api/chat` returned an OpenAI `gpt-5.5` structured response with a `mapQuery`.
- The in-app browser verified a map toolbar search for `hospitals near Jaipur` returned 12 Google Places hospital markers.
- The in-app browser verified a chatbot request for `hospitals near Udaipur` produced an assistant reply, updated the map query, and rendered 12 Google Places hospital markers.
- A standalone Playwright smoke test confirmed doctor sign-up shows the context textarea and `Speak` control, blocks account creation until context exists, and saves the profile under the new doctor account.
- A standalone Playwright smoke test confirmed hospital sign-up captures hospital name, street address, phone number, and optional Facebook page, removes the pseudo facility selector, and renders the saved hospital profile in the exchange view.
- A standalone Playwright smoke test completed doctor signup, hospital signup, hospital-to-doctor request creation, doctor acceptance, and approved schedule insertion.
- The local browser rendered the live Google Maps branch with pseudo facility markers and Google Places result markers when a Maps API key was present.

## Security and Privacy Notes

- `.env` is ignored by git.
- The Google Maps API key should be restricted in Google Cloud before any public deployment.
- The prototype does not collect patient information.
- The prototype does not send email.
- The prototype does not persist users, doctor context, shortlists, schedules, or hospital decisions outside the browser.
- Prototype passwords are stored in localStorage and must be replaced with real authentication before deployment.
- The speech recording flow only sends audio to `/api/transcribe`; that endpoint is not implemented in this repo yet.

## Next Engineering Steps

1. Add a FastAPI backend.
2. Implement `/api/transcribe`.
3. Add backend user accounts, password hashing, session management, and role authorization.
4. Add Databricks SQL access for facility search.
5. Implement backend profile, shortlist, schedule, and hospital decision persistence.
6. Replace pseudo facility data with scored Databricks results.
7. Add LLM-backed query parsing and evidence scoring.
8. Add email draft generation.
9. Add the backend service to the Databricks Apps bundle.
