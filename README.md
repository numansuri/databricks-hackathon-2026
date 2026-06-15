# Referral Copilot

Frontend prototype for the Databricks Apps and Agents Hackathon for Good (DAIS 2026).

Referral Copilot is a doctor-facing referral and volunteering workflow. The current app lets a doctor set up practice context, search a pseudo facility result set, inspect evidence, shortlist facilities, and build a visit schedule on top of Google Maps.

## Current Status

This repository currently contains a working React/Vite frontend prototype.

Implemented:

- Onboarding screen for a doctor's practice context.
- Text entry for specialties, experience, preferred regions, and volunteering interests.
- Browser audio capture with `MediaRecorder`.
- Speech-to-text handoff to `POST /api/transcribe` when a backend exists.
- Demo transcript fallback when `/api/transcribe` is not available.
- Local profile persistence in `localStorage`.
- Main app shell with Search, Schedule, and Shortlist tabs.
- Chat-style left panel with context-update guidance.
- Google Maps JavaScript API integration when `VITE_GOOGLE_MAPS_API_KEY` is set.
- Google Maps fallback map when no API key is configured.
- Pseudo facility markers using Google Maps Advanced Markers.
- Facility cards, evidence drawer, contact links, trust tiers, shortlist actions, and schedule builder.
- Production build with Vite.

Not implemented yet:

- FastAPI backend.
- Databricks Apps deployment wrapper.
- Live Databricks SQL queries from the frontend.
- Persistent backend tables for doctor profiles, shortlists, or schedules.
- Real OpenAI Whisper transcription endpoint.
- LLM-powered query parsing, evidence scoring, or email generation.
- Real authentication.
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
- `explore.py` is a local Databricks exploration script. It is not part of the React app runtime.

## App Flows

### Onboarding

On first visit, the doctor fills in a profile textarea. The setup copy tells the doctor that this context can be updated, added to, or removed later through the chatbot.

The `Speak` control:

1. Requests microphone access in the browser.
2. Records audio with `MediaRecorder`.
3. Sends an audio blob to `POST /api/transcribe`.
4. Adds the returned transcript to the textarea.

If the endpoint is unavailable, the prototype inserts a demo transcript so the UI can still be tested without a backend.

The saved profile is stored in `localStorage` under `referralCopilotDoctorProfile`. A generated doctor ID is stored under `referralCopilotDoctorId`.

### Search

The Search tab has:

- a chat-style interaction area
- quick prompt buttons
- a search input
- ranked pseudo facility cards
- a Google map or fallback map
- an evidence drawer for the selected facility

The chatbot currently has static behavior. It does not call an LLM yet.

### Shortlist

The Shortlist tab shows facilities saved during the current browser session. Shortlist state is React state only; it is not persisted to a backend.

### Schedule

The Schedule tab lets the doctor add planned visits to facilities. The schedule list and weekly ribbon update immediately. Schedule state is React state only; it is not persisted to a backend.

## Tech Stack

- React 19
- Vite 8
- lucide-react icons
- Google Maps JavaScript API
- Browser `MediaRecorder` API
- Local browser storage for the current prototype

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

Optional for production-style Maps configuration:

```bash
VITE_GOOGLE_MAP_ID=your_google_maps_map_id
```

Run the dev server:

```bash
npm run dev -- --port 5173
```

Open:

```text
http://localhost:5173/
```

Build for production:

```bash
npm run build
```

Preview a production build:

```bash
npm run preview
```

## Google Maps Configuration

The live map branch is enabled when `VITE_GOOGLE_MAPS_API_KEY` is present.

The app loads:

- Maps JavaScript API
- `marker` library
- Advanced Markers

The code uses `VITE_GOOGLE_MAP_ID` when provided. If no map ID is provided, the app falls back to `DEMO_MAP_ID`, which is suitable for local prototype rendering but should be replaced for production.

The `.env` file is ignored by git. Do not commit real API keys.

## Repository Layout

```text
.
|-- README.md
|-- docs/superpowers/specs/2026-06-15-referral-copilot-design.md
|-- findings/dataset-deep-dive.md
|-- ideas/README.md
|-- explore.py
|-- index.html
|-- package.json
|-- package-lock.json
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
- The local browser rendered the live Google Maps branch with three pseudo facility markers when a Maps API key was present.
- The browser console had no warnings or errors after switching to async Maps loading and Advanced Markers.

## Security and Privacy Notes

- `.env` is ignored by git.
- The Google Maps API key should be restricted in Google Cloud before any public deployment.
- The prototype does not collect patient information.
- The prototype does not send email.
- The prototype does not currently persist doctor context, shortlists, or schedules outside the browser.
- The speech recording flow only sends audio to `/api/transcribe`; that endpoint is not implemented in this repo yet.

## Next Engineering Steps

1. Add a FastAPI backend.
2. Implement `/api/transcribe`.
3. Add Databricks SQL access for facility search.
4. Implement profile, shortlist, and schedule persistence.
5. Replace pseudo facility data with scored Databricks results.
6. Add LLM-backed query parsing and evidence scoring.
7. Add email draft generation.
8. Package the frontend and backend for Databricks Apps.
