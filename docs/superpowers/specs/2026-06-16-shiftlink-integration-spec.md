# Shiftlink — App Integration & Coherence Spec (the backbone)

**Status:** Authoritative. This is the **single source of truth** for how Shiftlink's four features become one app.
**Date:** 2026-06-16
**Supersedes / overrides:** where this document disagrees with any feature spec, **this document wins.** The old `docs/superpowers/specs/2026-06-15-referral-copilot-design.md` is **DEAD** — do not implement it.
**Read order for the implementing agent:** (1) this doc, then (2) `2026-06-16-onboarding-flow-final.md`, (3) `2026-06-16-recommender-changes.md`, (4) `2026-06-16-outreach-changes.md`, (5) `2026-06-16-scheduler-agent-final.md`.

> **Provenance:** Built from a 5-lens coherence audit + synthesis, an adversarial Codex review (gpt-5.5), and **live Databricks verification** of every load-bearing data claim (queries in §3). Decisions are listed in §8 (D1–D27).

---

## 0. The thirty-second mental model

**Shiftlink places specialist volunteers where the need is highest.** One actor (a doctor). One spine (`specialty_canonical` → `gold_demand_supply_gap_v2`). Four tabs that *are* the four features:

```
ONBOARD            RECOMMEND              OUTREACH                 SCHEDULE
pick 1 of 110  →   rank districts by  →   draft a warm message →  clinic replies w/ times →
specialty          unmet need for         to a real clinic         build the visit week
(canonical)        that specialty;        (LLM, llama-4-maverick)  deterministically +
                   name host clinics      + pick channel           honest constraint ledger
```

Every downstream step keys off IDs the previous step produced: `specialty_canonical` (onboard→recommend), `facility_id` (recommend→outreach), `requestId` (outreach→schedule). **No free text flows downstream.**

---

## 1. Product narrative (one paragraph, for the demo)

A doctor signs in and picks their specialty from a controlled list of 110 canonical values. Shiftlink ranks the Indian districts with the highest **unmet need** for that specialty (from NFHS-driven gold data), names real **candidate host clinics** in the top districts, lets the doctor **draft an outreach message** to a clinic (warm, channel-aware, LLM-drafted with a deterministic fallback), and — once a clinic **replies with proposed times** — **builds the doctor's visit week deterministically**, showing an honest per-clinic **Constraint Ledger** of what fit, what didn't, and why. Nothing is auto-sent; nothing is auto-confirmed; every number that isn't ground truth is labeled an assumption.

---

## 2. What is CUT and KEPT (and why)

### KEPT
| Kept | Why |
|---|---|
| Specialist-**volunteer-placement** spine | All three built/spec'd artifacts (onboarding, recommender, scheduler) already share `specialty_canonical` + `gold_demand_supply_gap_v2`. 3 of 4 features cohere with zero glue. |
| 110-value specialty **picker** as the front door | Real join keys; the doctor finds their specialty by name. |
| **Deterministic recommender** (`recommend.py`) as the one ranking brain | Codex-hardened, 13-check selftest, honest (`no_gap_signal`, thin, greenfield). |
| **Outreach LLM drafting** (`databricks-llama-4-maverick` via Express) | The one legitimate LLM use; already built, with template fallback. |
| **Deterministic scheduler** `buildSchedule()` + **Constraint Ledger** | The honesty hero; offline-demoable; no LLM on the feasibility path. |
| `referralCopilot…` **localStorage namespace** | Renaming is pure churn that breaks 3 specs and orphans demo data. |

### CUT
| Cut | Why |
|---|---|
| **Patient-REFERRAL spine** (care-need search, evidence Strong/Partial/Weak trust tiers, `EvidenceDrawer`, canned "I found three facilities…" chat) | A second, contradicting product with no gold backing. Fabricated demo data. |
| **Hospital role / `HospitalDashboard` / `HospitalDoctorRequestForm` / two-way scheduling requests** | A second persona with no gold data; a multi-login dance no 3-min demo survives. The clinic's "voice" is already simulated by `approveOutreach` (which mints `proposedTimes`). **AuthGate becomes doctor-only.** |
| **Google Maps** (`MapWorkspace`/`GoogleMapShell`, `loadGoogleMaps`, `VITE_GOOGLE_MAPS_API_KEY`, the dead "Optimize" button as a map control) | The product's spatial unit is the **district**, not street pins; Free Edition has no egress to the Maps API. *(Facility lat/lng is still used by the scheduler's coarse travel bands — see §7 — but no Maps integration ships.)* |
| **Static canned chat box** on the Search tab | The deterministic ranked district list **is** the answer; a faked LLM chat contradicts it. |
| **`preferences.intent` toggle** | No gold column; reopens the two-product confusion. Hardcode `intent: 'volunteer'`. |
| **FastAPI / Python backend** (old design doc) | Express is built and sufficient; two runtimes = needless ops risk. |
| **`APP_TAGLINE = "Hospital exchange"`** (App.jsx L38) | Marketplace language for the cut two-sided product. New tagline: **"Place specialists where the need is highest."** |

> **The four tabs become:** **Recommend** (was "Search"; district ranking + host clinics), **Outreach** (draft + approve to send), **Schedule** (build-my-week from replies), **Shortlist** (saved clinics). `activeView` values stay the string set `"search" | "outreach" | "schedule" | "shortlist"` — only the **label** "Search"→"Recommend" changes, so no router churn.

---

## 3. Verified data foundation (queried live, 2026-06-16 — treat as ground truth)

All tables are in `workspace.virtue_foundation_enriched` (the **writable** catalog; the DAIS source catalog is a read-only Delta Share — never written).

### 3.1 Facility join — there is NO "fatal trap"
`gold_facility_enriched` (9,978 rows) ⋈ `gold_facilities` (9,989 rows) join **100%** on **both** keys:
- `gold_facility_enriched.facility_id = gold_facilities.unique_id` → **9,978/9,978**
- `gold_facility_enriched.facility_sk = gold_facilities.facility_sk` → **9,978/9,978**

**Use `facility_id = unique_id`** (clean UUID semantics). *(An earlier audit lens claimed `facility_sk` matched 0 rows — that was FALSE. Both keys work. There is no key trap to warn about.)*

### 3.2 Coordinates live DIRECTLY in `gold_facility_enriched`
Columns `lat_clean`, `long_clean` are present for **9,942/9,978 = 99.64%**. `gold_facility_enriched` also carries `pincode_clean`. **No join is needed for coordinates.** For the ~36 nulls, fall back via `gold_pincode` (key `gold_pincode.pincode = pincode_clean`; columns `centroid_lat`, `centroid_lon`, `has_centroid` — all verified to exist). The pincode centroid is a **~36-row safety net, not a primary mechanism** — do not build a pincode pipeline as the main coordinate source.

### 3.3 Contacts live in `gold_facilities`
Columns `email_final`, `phone_final`, `official_website`, `facebook_link`, `specialties_list`, `address_city`, `address_state`. After the §3.1 join, **9,978/9,978 = 100%** of facilities have ≥1 contact channel. **The facility join is needed ONLY for contacts + `specialties_list`** (coords come from enriched directly).

### 3.4 Recommendation vocabulary — `gold_demand_supply_gap_v2` (26,599 rows)
- **110** distinct `specialty_canonical`.
- Exactly **17** are **demand-bearing** (non-null `priority_tier`): `pediatrics, preventive_medicine, obstetrics_gynecology, nutrition_dietetics, internal_medicine, maternal_child_health, endocrinology_diabetes, family_planning_contraception, gynecologic_oncology, medical_oncology, cardiology, addiction_medicine, adolescent_medicine, pediatric_emergency_medicine, psychiatry, neonatology, pulmonology`.
- **4** are **thin** (`is_thin_specialty = true`): `nutrition_dietetics, addiction_medicine, adolescent_medicine, pediatric_emergency_medicine`.
- **`pulmonology` and `neonatology` have 0 critical/high districts** (only moderate/low) → the "no high-need districts measured; here are the best-available" cold-start copy applies to those two.
- The other **93** specialties have all-null ranking columns → `no_gap_signal` (honest refusal), never a fabricated ranking.
- `driving_needs` is an **`ARRAY`** (render as a list, don't parse a string); `unmet_demand`, `pop_weighted_demand` are `DOUBLE`; `score_basis`, `priority_tier`, `specialty_absent` present.

### 3.5 District context — `gold_district_card`
Exists with `persona_label` (STRING), `top_need_categories` (ARRAY), `top_priority_specialties` (ARRAY), keyed `(state_ut_norm, district_name_norm)`. Used for the Recommend tab's "district context" block.

### 3.6 Bundled-slice size
Top-20 districts × 17 demand specialties = 340 ranking rows, + 93 `no_gap_signal` names, + their candidate-clinic facilities (top-~20 districts only). **Well under 1 MB** — safe to bundle as static JSON.

---

## 4. The unified facility data contract (LOCKED)

**One canonical, camelCase facility object lives in React state and flows through Recommend → Outreach → Schedule unchanged.** Every panel that shows a facility reads this shape; `facilities.find(f => f.id === …)` must never return `undefined` (§7.1).

```js
// THE canonical in-app facility object — the ONLY facility shape in React state.
{
  id,                    // = gold_facilities.unique_id (== gold_facility_enriched.facility_id). THE end-to-end join key.
  name,                  // gold_facility_enriched.facility_name
  type,                  // gold_facility_enriched.facility_type
  city,                  // gold_facilities.address_city
  state,                 // gold_facilities.address_state
  lat,                   // gold_facility_enriched.lat_clean  (number | null) — 99.64% present
  lng,                   // gold_facility_enriched.long_clean (number | null)
  coordsAreApproximate,  // true iff lat/lng came from the gold_pincode centroid fallback (~36 rows), else false
  email,                 // gold_facilities.email_final   (string | null)
  phone,                 // gold_facilities.phone_final   (string | null)
  website,               // gold_facilities.official_website (string | null)
  facebook,              // gold_facilities.facebook_link  (string | null)   *** field name is `facebook`, NOT `facebookUrl` ***
  specialtiesList,       // gold_facilities.specialties_list (string[])      → wired to outreach as `capabilities[]`
  ownership,             // gold_facility_enriched.ownership_sector_final: 'public' | 'private' | 'unknown' (never guessed)
  isPublic,              // gold_facility_enriched.is_public_health_facility (bool)
  complexityTier,        // gold_facility_enriched.facility_complexity_tier
  hasSpecialistEvidence, // gold_facility_enriched.has_specialist_evidence (bool)
  specialistDomainCount, // gold_facility_enriched.specialist_domain_count (int)
  district,              // gold_facility_enriched.nfhs_district_name_norm
  stateNorm,             // gold_facility_enriched.nfhs_state_ut_norm
  districtKey            // `${stateNorm}::${district}` — the deterministic district join key used everywhere
}
```

**NOT in the contract** (demo decoration absent from gold — no feature may depend on these; delete them from the hardcoded seed array's shape): `evidence[]`, `flags[]`, `map{x,y}`, `distanceKm`, `score`, `match`, and the `tier: 'strong'|'partial'|'weak'` trust field. *(The recommender's `candidate_clinics[].tier` — a facility-complexity tier — is a different thing; it maps to `complexityTier`.)*

### 4.1 How the P0 bundled slice is generated (ONE offline SQL → static JSON)
`public/gold/facilities_slice.json` — each row is exactly the object above, produced once, offline, and committed:

```sql
SELECT e.facility_id                                AS id,
       e.facility_name                              AS name,
       e.facility_type                              AS type,
       f.address_city                               AS city,
       f.address_state                              AS state,
       COALESCE(e.lat_clean,  p.centroid_lat)       AS lat,
       COALESCE(e.long_clean, p.centroid_lon)       AS lng,
       (e.lat_clean IS NULL)                        AS coordsAreApproximate,
       f.email_final                                AS email,
       f.phone_final                                AS phone,
       f.official_website                           AS website,
       f.facebook_link                              AS facebook,
       f.specialties_list                           AS specialtiesList,
       e.ownership_sector_final                     AS ownership,
       e.is_public_health_facility                  AS isPublic,
       e.facility_complexity_tier                   AS complexityTier,
       e.has_specialist_evidence                    AS hasSpecialistEvidence,
       e.specialist_domain_count                    AS specialistDomainCount,
       e.nfhs_district_name_norm                    AS district,
       e.nfhs_state_ut_norm                         AS stateNorm,
       concat_ws('::', e.nfhs_state_ut_norm, e.nfhs_district_name_norm) AS districtKey
FROM workspace.virtue_foundation_enriched.gold_facility_enriched e
JOIN workspace.virtue_foundation_enriched.gold_facilities f ON e.facility_id = f.unique_id
LEFT JOIN workspace.virtue_foundation_enriched.gold_pincode p ON e.pincode_clean = p.pincode
-- Bundle ONLY facilities in the top-~20 districts of the 17 demand-bearing specialties (keeps the file < 1 MB):
WHERE concat_ws('::', e.nfhs_state_ut_norm, e.nfhs_district_name_norm) IN ( :topDistrictKeys );
```
No runtime second lookup; no pincode math in the browser. `:topDistrictKeys` is the set of `districtKey`s appearing in `demand_supply_slice.json` (§5).

### 4.2 The one unsatisfiable cell
Roughly 1 facility in 9,978 has neither validated lat/lng nor a resolvable pincode centroid → `lat: null, lng: null`. This is handled by the scheduler's existing **`unknown_location` band** (0 buffer, ledger reads "travel not checked"). No new code path.

---

## 5. The single recommendation engine (LOCKED)

**`recommend.py` is the one ranking brain.** The onboarding spec's hand-written `src/recommendation.js` *ranker* is **CUT**; `src/recommendation.js` becomes a **thin reader/filter** over a pre-ranked bundled slice. **The React app contains ZERO ranking logic** — it filters the pre-ranked array by `specialty_canonical` (+ optional state chip) and renders. (Full detail in `2026-06-16-recommender-changes.md`.)

### 5.1 Vocabulary: list 110, rank 17 (LOCKED — reverses onboarding §9.1)
- The picker **lists all 110** canonical specialties (every one is a valid join key; the doctor must find theirs by name).
- Only the **17 demand-bearing** specialties produce a district ranking.
- The other **93 return `no_gap_signal`** (honest refusal) and route to the browse fallback. The onboarding spec's "all 110 return a non-empty ranking" is **data-impossible** (15,599 null ranking rows) and is reversed: a populated-looking all-null card is *less* honest than an empty state.

### 5.2 Scoring (LOCKED — one sort tuple, defined once in `recommend.py`)
**Rank by `impact_index` DESC, tie-break `pop_weighted_demand` DESC.** `priority_tier` is a displayed **severity badge** (critical/high/moderate/low), not a sort key; `specialty_absent` is a "no specialists of your kind here today" badge. This keeps the recommender's clean, explainable 0–100 `impact_index` (already eval'd and Codex-hardened — see `recommender/EVAL.md` finding #9, which *removed* tier/setting tilts because they caused impact inversions) and folds in the population-reach intent via the tie-break. The app shows the 0–100 number as the headline; the badge as context.

### 5.3 Honesty behaviors (KEPT verbatim from `recommend.py`)
- `no_gap_signal` for the 93 non-demand specialties.
- Thin-specialty caveat for the 4 thin specialties: card reads "candidate district (limited data)", never a hard "top-need" rank claim.
- `greenfield` string when no credible host clinic survives the filter — never invent a host.
- The app branches on the status contract: **`'ok' | 'no_gap_signal' | 'no_feasible_district'`**.

### 5.4 Modes (simplified for the app)
The app uses **national ranking + one "Add my state" client-side filter chip** (`preferredStatesNorm[]` IN-filter on the slice). The 4 location modes (`open/prefer/fixed/avoid`), the two-section A/B `prefer` policy, and the `group_order/section_rank/overall_rank` fields are **CUT from the app path** and kept as **CLI-only** flags in standalone `recommend.py`.

### 5.5 `recommend.py --emit-slice` is the build step that produces the bundled JSON
It writes three files into `public/gold/`:
- `demand_supply_slice.json` — for each of the 17 demand specialties, the open-mode top-N districts (impact-ranked), plus the 93 `no_gap_signal` specialty names as a flat list.
- `facilities_slice.json` — the §4.1 SQL output (canonical facility objects for the bundled districts).
- `specialty_aliases.json` — ONE shared alias map (merge `recommend.py`'s `SPECIALTY_ALIASES` + the onboarding spec's Step-1a table) so the picker typeahead and the recommender resolve identically.

**`recommend.py`'s `_candidate_clinics` MUST start emitting `facility_id`** (today it emits only name/type/ownership/tier/beds/doctors). With `facility_id` present, the React app enriches a recommended clinic by id from `facilities_slice.json` (gaining contacts + coords). `recommend.py` stays pure-stdlib and does **not** own a contacts/coords table.

---

## 6. Stack, build, deploy, merge order, P0/P1

### 6.1 ONE backend (LOCKED)
**Node Express, `server.js` at repo root — the only server, one process.** FastAPI is dead. The onboarding spec's "FastAPI + Databricks SQL" (P1) is rewritten to **Express endpoints alongside `/api/outreach`.**
- **Built:** `POST /api/outreach`, `GET /api/health`.
- **P1 only (stretch):** `POST /api/recommendations`, `POST /api/facilities`, `POST /api/schedule-narrative`. No second runtime.

### 6.2 ONE start + build (LOCKED — resolves the two competing `start` scripts)
```json
"start": "vite build && node server.js"
```
`databricks.yml` `config.command` stays `["npm","run","start"]`. `dist/` must exist before `server.js` serves it. **Delete the `vite preview` start path** (it cannot serve `/api`, so outreach would 404). Dev: `npm run dev` (Vite :5173) + `node server.js` (:4173) with `vite.config.js` proxying `/api → http://localhost:4173`.

> **Boot-time (resolved by Codex Q4):** **Do NOT commit `dist/`.** Keep `start: "vite build && node server.js"` and **prewarm the app before the demo** (hit it once so the build+boot is done). A committed `dist/` goes stale silently and is worse than a prewarm. (`node server.js` returns a 503 "Frontend not built yet" if `dist/` is missing — the `vite build &&` prefix prevents that.)

### 6.3 Authoritative `databricks.yml` = the outreach worktree's version
It declares the `outreach_model` serving-endpoint resource (`databricks-llama-4-maverick`, `CAN_QUERY`) and sets `LLM_PROVIDER=databricks` + `OUTREACH_MODEL`. **If main's `databricks.yml` wins the merge, every outreach draft silently degrades to the template fallback.** Drop the `google_maps_api_key` secret + `VITE_GOOGLE_MAPS_API_KEY` env (Maps is cut).

### 6.4 Merge order (LOCKED) and symbol-anchoring
1. **`outreach-implementation` FIRST** — it alone changes the build/deploy substrate (`server.js`, `server/outreach.js`, `express`+`openai` deps, `vite.config.js` proxy, `databricks.yml`) and shifts every `App.jsx` line by roughly **+74…+205**.
2. **Onboarding** (client-only P0: `SpecialtyPicker` + thin `src/recommendation.js` reader + `public/gold/*.json`).
3. **Scheduler** (client-only: `buildSchedule` + `SchedulerPanel`; wires the dead "Optimize" button).
4. Any P1 Express endpoints last.

**Anchor on SYMBOLS, never line numbers.** All line citations in the onboarding/scheduler specs are **already stale** (main is 2216 lines; the outreach worktree is 2577). The implementing agent must re-grep symbols: `function App|DoctorApp|AuthGate|Onboarding|TopBar|SearchPanel|MapWorkspace|OutreachPanel|HospitalDashboard|SchedulePanel|ScheduleRibbon`; `const facilities|weekDays`; `getProfileKey|getOutreachKey|getScheduleKey`; `createOutreachDraft|approveClinicTime|approveOutreach|addSchedule|updateSchedule|buildOutreachMessage`. Symbols are stable across branches; only lines moved.

### 6.5 P0 / P1 cut line (shared by all features)
- **P0 (the demo):** client-only React + ONE Express server whose only live AI route is `/api/outreach` (template fallback if the endpoint/LLM is missing). `/api/transcribe` stays **UNIMPLEMENTED** — the mic falls back to `DEMO_PROFILE_TRANSCRIPT`, which already works; do not build it. All recommendation/facility data comes from bundled `public/gold/*.json`. **No live Databricks SQL.** The scheduler needs no backend at all.
- **P1 (post-demo stretch):** Express `/api/recommendations` + `/api/facilities` backed by Databricks SQL (Node SQL driver) + a durable profile store; the client swaps its data source from bundled JSON to API responses using the **identical `districtKey` contract** (zero UX change). Scheduler LLM narrator + `schedule_runs` Delta logging are stretch-only.

### 6.6 localStorage namespace (LOCKED)
**Keep all `referralCopilot…` keys** (`getProfileKey/getOutreachKey/getScheduleKey`, `USER_DATABASE_KEY/SESSION_USER_KEY/SCHEDULE_REQUESTS_KEY`, and the scheduler's new `getScheduleRunKey`). `APP_NAME = "Shiftlink"` and `THEME_KEY = "shiftlinkTheme"` stay as-is (display/theme only). Renaming the keys is pure churn that breaks three specs and orphans demo data.

---

## 7. The runtime integration seam (LOCKED)

Spine keys: **`specialty_canonical`** (onboard→recommend), **`facility_id`** + **`requestId`** (recommend→outreach→schedule). No free-text specialty ever flows downstream.

### 7.1 `facilities` is ONE deduped-by-id React state array (MERGE, never REPLACE)
Today `const facilities` is a module-level hardcoded array of 3 cardiology clinics (App.jsx L48–112), read at init in several places: `selectedFacilityId` defaults to `facilities[0].id` (L484), `shortlist` to `[facilities[0].id]` (L485), the seed `schedule` entry references `facilities[0].id` (L489), `OutreachPanel` and `SchedulePanel` read `facilities[0].id` (L1527, L1924), `getHospitalFacility` returns `facilities[0]` (L203). **`facilities[0]` is therefore read at module/component init and must never be empty.**

**Resolution (refined per Codex — do NOT keep the fake demo clinics as the seed):**
- **Delete the hardcoded 3-clinic cardiology array entirely.** Codex finding: keeping those as a seed/union **pollutes real recommendations and hides empty-state bugs**. Initialize `facilities` from **real bundled slice data**, not invented demo rows.
- Convert `facilities` from a module constant into **DoctorApp state**. Initialize it **synchronously** by importing a small bundled seed from the slice (e.g. `import seedFacilities from '../public/gold/facilities_seed.json'` — a committed first-page subset of `facilities_slice.json`) so init reads are safe **without** depending on an async fetch. The full slice loads into the same state on mount.
- **Guard every `facilities[0]` access** anyway: change init reads from `facilities[0].id` to `facilities[0]?.id ?? ""` (sites: `selectedFacilityId`, `shortlist`, seed `schedule`, `OutreachPanel`/`SchedulePanel` defaults, `getHospitalFacility` — which is itself removed with the hospital cut). The array must never be assumed non-empty.
- When the Recommend tab expands a district's host clinics, **MERGE** those canonical facility objects into the array, **deduped by `id`** — never replace. Recommender/onboarding code appends *before* any outreach/scheduler code can reference a facility.
- **Any facility shown in any panel MUST be in the `facilities` array**, so `createOutreachDraft(facilityId)` (which does `facilities.find(id)` and silently `return`s if missing) always resolves. Today it no-ops silently if the facility isn't present; after this change it can't be.
- **Greenfield districts** (no credible host) yield read-only context text — never an outreach/scheduler target (no id/coords/contact).

### 7.2 Handoff shapes (LOCKED — do not change field names)
**Outreach request** (the seam carrier; the existing shape, unchanged):
```js
{ id, facilityId, channel, destination,
  status: 'draft' | 'reply_received' | 'appointment_confirmed',
  proposedTimes: [{ date: 'YYYY-MM-DD', time: 'HH:MM', label }],   // minted by approveOutreach (the simulated clinic reply)
  approvedTime?, schedulingApprovalStatus, message, createdAt }
```
At the `/api/outreach` fetch boundary, a `mapFacilityForApi(facility)` adapter maps the canonical object to the server's expected `facility` payload: **`facebook ← facility.facebook`** (the outreach worktree currently reads `facility.facebookUrl` — fix to `facebook`), and **`capabilities ← facility.specialtiesList`** (currently hardcoded `[]`, so the LLM never tailors to the clinic's services — wiring `specialtiesList` is the cheapest specificity win). `email/phone/website/city/state/type/name` map directly.

**Scheduler `clinicReplies` input** = `outreachRequests.filter(r => r.status === 'reply_received').map(r => ({ ...r, facility: facilities.find(f => f.id === r.facilityId) }))` — joined for `{lat, lng}`. Missing lat/lng → `unknown_location` band (the ~1-facility exception, not the norm). Travel model is the coarse 4-band haversine (30/60/120/240 min) — no route optimizer, no live distance service.

**Schedule entry** (single writer-agnostic shape; every clinic-reply entry carries `requestId` + `slotLabel`):
```js
{ id, facilityId, requestId, date, time, purpose,
  status: 'confirmed', approvalStatus: 'doctor_approved',
  calendarStatus: 'calendar_event_created', source: 'clinic_reply', slotLabel }
```

### 7.3 ONE confirmation writer (LOCKED — fixes the double-booking collision)
Today there are **two** ways to turn a clinic reply into a confirmed visit, and they collide:
- `approveClinicTime(requestId, proposedTime)` — the per-slot **Approve** buttons inside `OutreachPanel` (App.jsx L1590) → calls `addSchedule` (and **drops `requestId`** — the entry gets `requestId: ""`).
- the scheduler's planned `confirmProposals(ids)` — batched.

Two writers can double-book one clinic, and `approveClinicTime`'s closed-over-`outreachRequests` loop bug (documented in the scheduler spec) makes bulk approval lossy.

**Resolution:** the **scheduler is the single confirmation surface**. 
1. **Remove the per-slot Approve buttons from `OutreachPanel`** (the `approveClinicTime(request.id, time)` buttons). A clinic that has replied shows "Replied — build your week in Schedule" and routes to the Schedule tab.
2. All clinic-reply confirmation goes through **`confirmProposals(ids)`** (scheduler spec §6): one batched functional `updateSchedule(prev => [...newEntries, ...prev])` + one batched functional `setOutreachRequests(prev => prev.map(...))`. **Never loop `approveClinicTime`.**
3. **Idempotency key = `requestId`.** Any confirm path is a no-op if the matching `outreachRequest.status === 'appointment_confirmed'` OR a schedule entry with that `requestId` already exists — reuse the existing guard pattern from `acceptHospitalRequest` (App.jsx L646: `current.some(e => e.requestId === request.id)`).
4. **Retire `approveClinicTime`.** If any code path must keep it temporarily, it must (a) delegate to `confirmProposals` and (b) stamp `requestId` + `slotLabel`.

### 7.4 Profile compatibility (do it once, fully)
The V2 profile (onboarding spec §7) must keep `profile.tags.specialties[0]` (=== `primarySpecialtyCanonical`) and `profile.tags.regions[0]` populated, because several readers still use them. **Resolution (Codex Q7): keep `tags` mirrored for P0** — the V2 profile always populates `tags.specialties=[primarySpecialtyCanonical]` and `tags.regions=[…humanized states]`. ALSO update the readers to *prefer* V2 fields when present, at **all** of these sites (do not half-do it): `buildOutreachMessage`, `TopBar`, `SearchPanel` greeting, and the outreach worktree's **`buildDoctorForApi`** (reads `profile?.tags?.specialties/regions/experience`). On load, if a stored profile lacks `schemaVersion === 2`, run `migrateV1Profile` before first render.

### 7.5 Legacy UI consumers will CRASH on the new facility object (Codex — the biggest missed gap)
Removing the decoration fields (§4) is not free: existing components **read** them and will throw at render. The implementing agent MUST rewrite or remove these **in the same change** that introduces the canonical facility object:

| Consumer | Reads (now-removed field) | What to do |
|---|---|---|
| `FacilityCard` | `tierMeta[facility.tier].className`, `facility.score.toFixed(...)`, `facility.distanceKm` | **Rewrite** to the volunteer story: headline `impact_index` (0–100) + `priority_tier` **badge**, `complexityTier`, `ownership`/`isPublic`, evidence line from `hasSpecialistEvidence` + `specialistDomainCount`. No trust-tier, no score, no distance. |
| `EvidenceDrawer` | `facility.evidence[]`, `facility.flags[]` | **Remove** — patient-referral evidence-trust UI, cut with the referral spine. Its "View Evidence" entry points go away. |
| Map fallback (`MapWorkspace`/`GoogleMapShell`) | `facility.map.x/y` | **Remove** — cut with Google Maps (D3). |
| `tierMeta` + `.tierStrong/Partial/Weak` styles | — | Dead after the FacilityCard rewrite; remove. |

**Grep gate before merge:** `rg -n "facility\.(tier|score|distanceKm|evidence|flags|map)\b" src/App.jsx` returns **zero** hits outside removed code.

---

## 8. Master decisions table (D1–D27)

| # | Decision | Choice | Affected |
|---|---|---|---|
| D1 | Product identity | Specialist-volunteer placement only | All |
| D2 | Hospital role | **CUT** (doctor-only AuthGate; HospitalDashboard removed/dead) | Narrative, App.jsx |
| D3 | Google Maps | **CUT**; Recommend pane = district + host-clinic list | Narrative, App.jsx, databricks.yml |
| D4 | Facility join key | `gold_facility_enriched.facility_id = gold_facilities.unique_id` (both keys verified 100%) | Data contract, recommender |
| D5 | lat/lng source | `gold_facility_enriched.lat_clean/long_clean` (99.64%), COALESCE `gold_pincode` centroid; ~1 null → `unknown_location` | Data contract, scheduler |
| D6 | Contacts source | `gold_facilities` (email/phone/website/facebook + specialties_list), merged into the slice at build | Data contract, outreach |
| D7 | Who resolves contacts/coords | App enriches by `facility_id` from the bundled slice; `recommend.py` emits only `facility_id` | Recommender, seam |
| D8 | Canonical facility object | The §4 camelCase object; decoration fields excluded | All UI |
| D9 | Outreach tailoring field | `specialtiesList` → wire as `capabilities[]` (today `[]`) | Outreach |
| D10 | Single recommendation engine | `recommend.py`; delete the spec's `rankDistricts`; `src/recommendation.js` = thin reader | Onboarding, recommender |
| D11 | Vocabulary | Picker lists 110; only 17 rank; 93 → `no_gap_signal` (reverse onboarding §9.1) | Onboarding, recommender |
| D12 | Scoring | `impact_index` DESC, tie-break `pop_weighted_demand` DESC; `priority_tier` = badge | Recommender, onboarding |
| D13 | Honesty | Keep `no_gap_signal` / thin-specialty / greenfield verbatim | Recommender, onboarding |
| D14 | Slice generation | `recommend.py --emit-slice` → `demand_supply_slice.json` + `facilities_slice.json` (§4.1 SQL) + `specialty_aliases.json` | Recommender, onboarding, build |
| D15 | Location modes | App: national + one "Add my state" chip; 4-mode/two-section kept CLI-only | Recommender, onboarding |
| D16 | Backend | ONE Node Express `server.js`; kill FastAPI | Stack, all |
| D17 | start/build | `vite build && node server.js`; delete `vite preview` start (commit-`dist/` is the fallback) | Stack, deploy |
| D18 | databricks.yml | Outreach worktree's version is authoritative | Outreach, deploy |
| D19 | Merge order | outreach → onboarding → scheduler → P1 | All |
| D20 | Code anchoring | Symbols, never line numbers | Onboarding, scheduler |
| D21 | localStorage | Keep `referralCopilot…`; `APP_NAME='Shiftlink'` display-only | All |
| D22 | `/api/transcribe` | UNIMPLEMENTED in P0; mic → `DEMO_PROFILE_TRANSCRIPT` | Stack, onboarding |
| D23 | Confirmation writer | Scheduler-only; remove OutreachPanel per-slot Approve buttons | Outreach, scheduler |
| D24 | Idempotency | Key = `requestId`; stamp `requestId`+`slotLabel`; no-op if already confirmed/exists | Scheduler, outreach |
| D25 | facilities array | One deduped-by-id state array; MERGE never REPLACE; seed non-empty | Seam, onboarding |
| D26 | intent toggle | Hardcode `intent='volunteer'` | Onboarding, narrative |
| D27 | LLM scope | LLM only in `/api/outreach` (llama-4-maverick); recommender & scheduler stay deterministic | Recommender, scheduler |

*(Codex adversarial-review additions/adjustments are folded into §10 and the individual specs.)*

---

## 9. The demo arc (one continuous story, ~3 minutes)

1. **Onboard (15s).** Sign in as a doctor → pick **"Pediatrics"** in the picker (badge: "High-need districts"). One field, one button.
2. **Recommend (35s).** Land on the district ranking: **Araria, Bihar — impact 100/100, "critical," no pediatric specialist here today**, with the driving needs listed (anaemia, child illness, malnutrition, immunization). Expand → real candidate host clinics in Araria. Click **"Add my state"** → list narrows; honest note if your state has weaker gaps.
3. **Outreach (35s).** Pick a host clinic → **"Draft outreach for approval"** → a warm, channel-aware message appears (LLM via llama-4-maverick; template fallback is invisible). Switch channel (email/phone/WhatsApp), edit, **Approve** — which simulates the clinic replying with two proposed times.
4. **Schedule (40s).** Go to **Schedule**, add a fixed commitment (a Thursday ward round), set prefs (mornings, max 2/day, home by 6), hit **"Build my week."** The week fills; open the **Constraint Ledger**: each visit cites the clinic's own proposed slot, the per-leg travel buffers, and the assumptions; one clinic sits in "needs new times" with its reason. **Approve all** → calendar entries.
5. **Close (15s):** *"Real NFHS need data picked the district, a real clinic record drafted the outreach, and the schedule optimizes only over slots the clinic actually offered — it never pretends to know road traffic or clinic availability, and flags what needs renegotiation."*

> **Demo-prep (Codex):** the top district for a specialty can be **greenfield** (no host clinic — `candidate_clinics: []`). Pick and rehearse a specialty/district row that has a **real candidate clinic with a `facility_id` + a contact channel** so steps 3–4 work live. Verify the chosen row in `facilities_slice.json` before the demo; "Pediatrics" is the safest demo specialty (highest, densest signal), but confirm the specific top district you show has a non-empty host list.

---

## 10. Handoff checklist & acceptance checks (per feature)

*(Per-feature build steps live in each feature spec; these are the cross-cutting acceptance gates.)*

- **[Data] `npm run` slice build:** `recommend.py --emit-slice` produces `public/gold/{demand_supply_slice,facilities_slice,specialty_aliases}.json`; `facilities_slice.json` rows match the §4 object exactly (camelCase, `facebook` not `facebookUrl`, `specialtiesList` present); every `id` is a `gold_facilities.unique_id`.
- **[Recommend] No app-side ranking:** grep confirms `src/recommendation.js` has no sort by demand columns — it only filters the pre-ranked slice. Selecting any of the 93 non-demand specialties shows the `no_gap_signal` browse fallback, never a blank or fabricated ranking. `pulmonology`/`neonatology` show the "best-available" copy.
- **[Seam] facilities integrity:** after expanding any district, `facilities.find(id)` resolves for every clinic shown; `createOutreachDraft` never silently no-ops; `facilities[0]` is defined at init.
- **[Outreach] tailoring + channel:** the `/api/outreach` payload carries non-empty `capabilities` (from `specialtiesList`) and `facebook` (not `facebookUrl`); with the LLM unreachable, the template draft still renders (UI never hard-fails).
- **[Schedule] single writer + idempotency:** there is exactly one confirmation path (`confirmProposals`); no per-slot Approve buttons remain in `OutreachPanel`; re-clicking "Approve all" is a no-op; every clinic-reply schedule entry has `requestId` + `slotLabel`; zero-feasible is a valid result (all clinics in "needs new times").
- **[Deploy] one process:** `npm run start` builds `dist/` then serves both the SPA and `/api/*` from `server.js`; `databricks.yml` declares the `outreach_model` endpoint; no `vite preview`, no Google Maps key.
- **[Profile] one migration:** every reader of `profile.tags.specialties/regions` (incl. `buildDoctorForApi`) works for both V1-migrated and fresh-V2 profiles.
- **[UI] no crash on the new facility object:** `rg -n "facility\.(tier|score|distanceKm|evidence|flags|map)\b" src/App.jsx` returns zero hits outside removed code; the Recommend tab renders real slice rows without throwing.
- **[Copy] one product story:** `rg -niE "hospital exchange|referral|two-way|exchange" src/App.jsx` shows no user-visible patient-referral/marketplace copy; `APP_TAGLINE` and the Search→Recommend tab label read the volunteer-placement story.
- **[Greenfield] demo row is real:** the rehearsed demo specialty/district expands to ≥1 host clinic with a `facility_id` + a contact channel (not greenfield).

---

## 11. Codex adversarial review — verdict & incorporated findings

Codex (gpt-5.5, xhigh, read-only) reviewed the decisions against the live code. **Verdict: the product spine is right; ship it — with these corrections, all now folded into the sections above.**

**Final answers to the 7 open questions (Codex, singular):**
1. **`gold_pincode`** — use only as the ~36-null coord fallback; build no UX around it. *(→ §3.2, §4.2)*
2. **Travel ledger — KEEP**, stripped to coarse haversine bands + visible assumptions; no custom-hub/route/pincode UI. *(→ scheduler spec; §7.2)*
3. **Ranking — `impact_index` DESC, `priority_tier` as badge only.** *(→ D12, §5.2)*
4. **`dist/` — do NOT commit;** `vite build && node server.js` + prewarm the app before the demo. *(→ §6.2)*
5. **Slice freshness — freeze the verified 17/4/93 counts into generated metadata and add a build assertion.** *(→ §5.5, recommender spec)*
6. **Outreach slot approval — cut from Outreach;** the scheduler is the only confirmation surface. *(→ D23, §7.3)*
7. **Profile — keep `tags` mirrored for P0;** also update `buildDoctorForApi`/display reads to prefer V2 fields. *(→ §7.4)*

**Material findings folded in:**
- **Legacy UI consumers crash on the new facility object** (`FacilityCard`/`EvidenceDrawer`/fallback map read `tier`/`score`/`distanceKm`/`evidence`/`flags`/`map.x`). → new **§7.5** + grep gate. *(Codex's biggest catch.)*
- **Don't seed `facilities` with the fake demo clinics** — they pollute real recommendations and hide empty-state bugs; init from real slice data and guard empty arrays. → revised **§7.1**.
- **`recommend.py` has no `--emit-slice` today** and `_candidate_clinics` emits no `facility_id` (confirmed at `recommend.py:531`). → both are explicit build tasks in the recommender spec.
- **Outreach worktree** maps `facebook: facility.facebookUrl` and `capabilities: []` (`mapFacilityForApi`, outreach `App.jsx:2340-2353`); `approveClinicTime` creates a schedule entry without `requestId` (so idempotency-by-request can't work) and still ships per-slot Approve buttons. → §7.2, §7.3, D9, D23, D24.
- **The top recommendation can be greenfield** (Codex's local cardiology top-1 had `candidate_clinics: []`) → the rehearsed demo row MUST be a specialty/district with a real host clinic carrying `facility_id` + contact. → §9 demo-prep note.
- **Copy still says "Hospital exchange" / "referral" in several places** (`APP_TAGLINE`, `SearchPanel` greeting, `quickPrompts`, etc.) → **sweep all visible copy** to the volunteer-placement story or judges see two products. → acceptance check in §10.
- **Also cut from the demo path:** the manual "Add visit" schedule builder (the Schedule tab's primary surface is the `SchedulerPanel` build-my-week), the teleconsult toggle, district/pincode refinement, and all P1 endpoints.

Codex points that **diverge from the synthesis and win:** "don't commit `dist/`" (the synthesis hedged); "don't union demo facilities" (the synthesis said seed non-empty from any small set — Codex narrows it to *real* slice data only). Both are reflected above.
