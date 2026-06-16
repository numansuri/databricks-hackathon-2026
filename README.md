# Shiftlink

**Place specialist volunteers where India's health need is highest.**

Shiftlink helps a single actor — a doctor — decide *where* to volunteer their
specialty, *who* to contact, and *how* to fit the visits into one week. It ranks
Indian districts by **unmet need** for the doctor's specialty (from NFHS-driven
gold health data), names real candidate **host clinics** in the top districts,
drafts a warm **outreach message** to a clinic, and — once a clinic replies with
proposed times — builds the doctor's **visit week deterministically**, with an
honest per-clinic Constraint Ledger of what fit, what didn't, and why. Nothing is
auto-sent or auto-confirmed; every number that isn't ground truth is labeled an
assumption. It is doctor-only (no hospital/marketplace persona).

---

## The demo arc — four tabs are the four features

The whole app keys off one spine. No free text flows downstream:

```
specialty_canonical  →  facility_id  →  requestId
   (onboard→recommend)  (recommend→outreach) (outreach→schedule)
```

1. **Onboard** — Sign in as a doctor, pick **1 of 110 canonical specialties** from
   a controlled picker. The chosen `specialty_canonical` is the join key for
   everything after.
2. **Recommend** — The districts with the highest unmet need for that specialty,
   already impact-ranked (0–100), with a severity badge (critical/high/moderate/low),
   the driving needs, and real candidate host clinics. Honest states are first-class:
   - `no_gap_signal` for the **93** specialties with no measured need signal (an
     empty browse fallback, never a fabricated ranking).
   - "best-available" copy for `pulmonology` / `neonatology` (demand-bearing but no
     critical/high districts).
   - **greenfield** when no credible host clinic survives the filter — never an
     invented clinic.
   - thin-specialty caveat for the 4 sparse specialties.
   An "Add my state" chip narrows the national list client-side (no re-rank).
3. **Outreach** — Pick a host clinic, draft a warm, channel-aware message. Drafting
   is the one live LLM use (`databricks-llama-4-maverick` via the Express server).
   The server picks the channel deterministically (email → phone → WhatsApp →
   website → Facebook) and tailors to the clinic's `specialtiesList`. If the LLM is
   unreachable, a local template draft renders instead — the UI never breaks.
   Approving simulates the clinic replying with proposed times.
4. **Schedule** — Add a fixed commitment, set preferences (mornings, max/day,
   home-by), hit **Build my week**. `buildSchedule()` is fully deterministic: it
   only schedules over slots the clinic actually offered, uses coarse haversine
   travel bands (30/60/120/240 min — no live routing), and emits a **Constraint
   Ledger** explaining each visit and each clinic that needs renegotiated times.
   Confirmation goes through one writer (`confirmProposals`), keyed by `requestId`.

### Demo tips

For some specialties the highest-impact district is **greenfield** (no host clinic
in the data), so the app honestly shows a "no credible host yet" state there. For a
smooth live demo, pick a specialty whose **top** district has host clinics. Verified
good combos: `endocrinology_diabetes` → Theni, Tamil Nadu (rank 1, impact 100, 2
hosts); `preventive_medicine` → Deoghar, Jharkhand (rank 2, 3 hosts);
`adolescent_medicine` → Paschim Medinipur, West Bengal (rank 1, 3 hosts);
`medical_oncology` / `gynecologic_oncology` → Adilabad, Telangana (rank 1). Note:
"Pediatrics" is the densest signal but its top districts (Araria, Kanpur Dehat) are
greenfield — its first clickable host is around rank 5 (Budaun, UP).

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  React 19 + Vite SPA            src/App.jsx (single file)       │
│  · onboarding picker            src/specialties.js (110 + alias)│
│  · thin reader, ZERO ranking    src/recommendation.js           │
│  · deterministic scheduler      src/scheduler.js                │
│         │ reads at runtime              │ POST /api/outreach     │
│         ▼                               ▼                        │
│  public/gold/*.json (bundled)    Node Express  server.js         │
│  (pre-ranked slices)             + server/outreach.js (LLM)      │
└───────────────────────────────────────────────────────────────┘
            ▲ generated offline                  │ in-network call
            │ recommend.py --emit-slice          ▼
   ┌─────────────────────────┐        Databricks FM serving endpoint
   │ recommender/recommend.py│        databricks-llama-4-maverick
   │ (pure-stdlib, the one   │
   │  ranking brain)         │  reads  Databricks gold tables in
   └─────────────────────────┘ ─────  workspace.virtue_foundation_enriched
```

- **React 19 + Vite SPA** — `src/App.jsx` is the whole UI. It does **zero ranking**;
  it filters the pre-ranked bundled slices and renders.
- **One Node Express server** — `server.js` + `server/outreach.js`. The only live AI
  route is `POST /api/outreach`; `GET /api/health` reports LLM/build status. The
  same process serves the built SPA in production. No FastAPI, no second runtime.
- **Deterministic Python recommender** — `recommender/recommend.py` is pure stdlib.
  It is the single source of district rankings and emits the bundled JSON the app
  reads. The app never ranks.
- **Databricks** — gold tables live in `workspace.virtue_foundation_enriched`; the
  `databricks-llama-4-maverick` serving endpoint backs outreach drafting.

---

## Data — bundled, pre-ranked JSON slices

The app ships pre-computed JSON in `public/gold/`, generated **offline** by
`recommend.py --emit-slice` from the live gold layer and committed. At runtime the
app reads these files directly — **no live Databricks SQL** in the demo path.

| File | What it is |
|---|---|
| `demand_supply_slice.json` | The ranking. `meta` (110 total / 17 demand-bearing / 4 thin / 93 no-signal / top-20 per specialty), `demandBearing` (top-20 impact-ranked districts per demand specialty), and `noSignal` (the 93 names). |
| `facilities_slice.json` | ~357 canonical facility objects for the bundled districts — `id` (= `gold_facilities.unique_id`), name/type/city/state, lat/lng, contacts (email/phone/website/facebook), `specialtiesList`, ownership, complexity, district keys. The app enriches a recommended clinic by `facility_id`. |
| `facilities_seed.json` | A 20-row first-page subset of the slice, imported synchronously so the `facilities` state array is never empty at init. |
| `specialty_aliases.json` | Shared alias → canonical map so the picker typeahead and the recommender resolve specialties identically. |
| `district_cards.json` | Per-district context (persona label, top need categories, top priority specialties) for the Recommend tab's context block. |

`recommend.py` is the **single ranking brain**: the picker *lists* all 110
specialties (every one is a valid join key), but only the **17** demand-bearing
ones produce a ranking. The other **93** return `no_gap_signal`. The emit step
asserts these counts (vocabulary-drift guard) and verifies every named candidate
clinic's `facility_id` resolves in the slice.

---

## Run locally

Requires Node (for the app/server) and Python 3 (only if you regenerate slices).

```bash
npm install
```

**Dev (two processes, hot reload):**

```bash
node server.js          # API on :4173
npm run dev             # Vite SPA on :5173 (proxies /api → :4173)
```

`vite.config.js` proxies `/api/*` to `http://localhost:4173`, so outreach works
end-to-end in dev. Open http://localhost:5173.

**One-process (build then serve, like production):**

```bash
npm run start           # = vite build && node server.js  → serves SPA + /api on :4173
```

`server.js` returns a 503 "Frontend not built yet" only if `dist/` is missing —
the `vite build &&` prefix prevents that. `dist/` is **not** committed.

> **`/api/outreach` without Databricks creds:** with no LLM provider configured the
> endpoint returns a deterministic **template draft** (`source: "template"`), so the
> UI is fully usable offline. With creds it calls the FM endpoint and returns
> `source: "ai"`. Set them via `.env` (see `.env.example`) — `OPENAI_API_KEY` for
> direct OpenAI, or `DATABRICKS_HOST` + `DATABRICKS_TOKEN` (PAT) for local Databricks.
> These are **server-side only** — never prefix with `VITE_`.

**Regenerate the bundled slices (optional, needs a fresh gold export):**

```bash
python recommender/recommend.py --emit-slice --out public/gold
```

---

## Deploy (Databricks Apps)

`databricks.yml` declares the app and its serving-endpoint resource:

- `outreach_model` → `databricks-llama-4-maverick` (`CAN_QUERY`), injected as
  `OUTREACH_MODEL`; `LLM_PROVIDER=databricks`.
- `config.command` is `["npm", "run", "start"]` — `vite build && node server.js`
  builds `dist/` then serves the SPA **and** `/api/*` from one process.

In a deployed Free Edition app, external egress is blocked, so outreach calls the
**in-network** Databricks FM endpoint via the OpenAI SDK (base URL pointed at
`/serving-endpoints`), using OAuth credentials auto-injected by the platform. There
is a per-process LLM-call cap (`OUTREACH_MAX_CALLS`, default 500) since the app has
no per-user auth. Prewarm the app once before a demo so the build+boot is done.

---

## Repo layout

```
src/
  App.jsx              single-file React app (onboard / recommend / outreach / schedule)
  specialties.js       110 canonical specialties + resolveSpecialty (asserts 110 at load)
  recommendation.js    thin reader/filter over the bundled slices — NO ranking
  scheduler.js         buildSchedule() + travel bands + Constraint Ledger (deterministic)
  scheduler.test.mjs   scheduler unit tests
  styles.css
server.js              the only server: serves dist/ + POST /api/outreach, GET /api/health
server/outreach.js     channel selection + LLM drafting (Databricks/OpenAI) + template fallback
recommender/
  recommend.py         the single ranking brain; --emit-slice writes public/gold/*.json
  EVAL.md, README.md   scoring rationale + eval notes
public/gold/*.json     bundled, pre-ranked data the app reads at runtime
docs/superpowers/specs/ design specs (the integration spec is the source of truth)
databricks.yml         Databricks App + outreach_model serving-endpoint resource
vite.config.js         dev /api proxy → :4173
package.json           dev / build / start scripts
```

The authoritative design doc is
`docs/superpowers/specs/2026-06-16-shiftlink-integration-spec.md`.
