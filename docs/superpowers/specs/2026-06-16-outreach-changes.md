# Outreach — Change Spec (wire to the unified facility contract; one confirmation writer)

**Status:** Build-ready change-delta. Outreach is **already implemented** in the `outreach-implementation` branch and is the **merge substrate** (lands first — integration-spec §6.4). It is production-grade: Express `server.js` + `server/outreach.js`, OpenAI SDK → Databricks `databricks-llama-4-maverick`, deterministic channel pick, template fallback, prompt-injection guards, per-process call cap.
**Read first:** `2026-06-16-shiftlink-integration-spec.md`. This implements its §7.2 (handoff), §7.3 (one confirmation writer), and the copy sweep.
**Target:** `src/App.jsx` (outreach worktree), `databricks.yml`. `server.js`/`server/outreach.js` need **no change** (they already read `facility.facebook`, `facility.capabilities`).

> **What does NOT change:** the whole backend (`/api/outreach`, `/api/health`, channel resolution, LLM provider auto-detect, OAuth M2M, template fallback, call cap). The design in `docs/outreach-flow.md` stays valid. Only the **frontend wiring to the new facility object** and the **confirmation-writer collision** change.

---

## 1. Change 1 — `mapFacilityForApi`: feed the LLM real data (REQUIRED)

The fetch-boundary adapter currently drops the two fields that make the draft specific. In the outreach worktree (`src/App.jsx`, `function mapFacilityForApi`, ~L2340):

```js
// TODAY (broken specificity):
facebook: facility.facebookUrl || null,   // canonical object has `facebook`, not `facebookUrl` → always null
capabilities: [],                         // → the LLM never tailors to the clinic's services
```
```js
// CHANGE TO (canonical facility object — integration-spec §4):
facebook: facility.facebook || null,                 // field is `facebook`
capabilities: facility.specialtiesList || [],        // gold_facilities.specialties_list → the cheapest specificity win
```
Also confirm the other fields read from the canonical object: `id, name, type, city, state, email, phone, website` map straight through. Drop `match` (decoration; the server treats it as optional).

> The server (`server/outreach.js`) already builds WhatsApp from `phone`, prioritizes `email>phone>whatsapp>website>facebook`, and humanizes `capabilities`. With `capabilities` populated, drafts reference the clinic's actual services; with `facebook` populated, Facebook becomes an available channel for the ~contactable-only-by-social facilities.

**Other `facebookUrl` reads** in the outreach worktree are hospital-profile fields (`profile.facebookUrl`, hospital sign-up) — those belong to the **cut hospital role** (integration-spec D2) and are removed with it. The only facility-level `facebookUrl` that must become `facebook` is in `mapFacilityForApi` and `localOutreachDraft` (the client fallback, ~L2454: `ensureUrlClient(facility.facebookUrl)` → `facility.facebook`). Fix both so the offline fallback matches the contract.

---

## 2. Change 2 — ONE confirmation writer (remove per-slot Approve from Outreach) (REQUIRED)

Integration-spec §7.3 / D23/D24. Today `OutreachPanel` renders per-slot **Approve** buttons (`onClick={() => approveClinicTime(request.id, time)}`, outreach worktree ~L1795). This collides with the scheduler's `confirmProposals` (two writers can double-book one clinic) and `approveClinicTime` drops `requestId` (so idempotency-by-request can't work).

**Changes:**
1. **Delete the per-slot Approve buttons** from `OutreachPanel`. A `reply_received` request instead shows: the proposed times (read-only) + a line **"Clinic replied — build your week in Schedule"** with a button that does `setActiveView("schedule")` and opens the `SchedulerPanel` (scheduler spec). Outreach is draft+send only; it never confirms a visit.
2. **Retire `approveClinicTime`.** Remove it and its prop threading (`OutreachPanel` no longer needs it). The single confirmation surface is the scheduler's `confirmProposals` (scheduler spec §6). If a transitional shim is unavoidable, it must delegate to `confirmProposals` and stamp `requestId` + `slotLabel` — but prefer outright removal.
3. `approveOutreach` (the "send" action that simulates the clinic replying with `proposedTimes`) is **unchanged** — it is the demo's clinic-reply generator and the scheduler's input source.

Result: `draft → (approve/send) → reply_received → [Schedule tab builds & confirms]`. Exactly one path mints a confirmed visit.

---

## 3. Change 3 — `buildDoctorForApi` prefers V2 profile fields

`buildDoctorForApi` (outreach worktree ~L2356) reads `profile?.tags?.specialties/regions/experience`. The V2 profile keeps `tags` mirrored (integration-spec §7.4), so this keeps working — but prefer the V2 fields when present:
```js
specialties: profile?.tags?.specialties?.length ? profile.tags.specialties
             : (profile?.primarySpecialtyCanonical ? [profile.primarySpecialtyCanonical] : []),
```
No behavior change for migrated profiles; correct for fresh V2.

---

## 4. Change 4 — copy sweep (part of the one-product story)

Codex: visible "Hospital exchange" / "referral" / two-way wording makes judges see two products. As part of outreach (and the hospital/referral cut), re-word user-visible copy to the **volunteer-placement** story:
- `APP_TAGLINE = "Hospital exchange"` → **"Place specialists where the need is highest."**
- `OutreachPanel` header/eyebrow, the "Draft outreach for approval" CTA, and any "referral"/"exchange" labels → volunteer/outreach phrasing.
- The outreach LLM `SYSTEM_PROMPT` already says "volunteering or referring specialist" — leave the server prompt (it's fine), just align the **UI** copy.

(Broader copy in `SearchPanel`/`quickPrompts`/greeting is handled by the onboarding spec's Recommend-tab rebuild; the gate is the integration-spec §10 copy check.)

---

## 5. Change 5 — `databricks.yml` is authoritative (deploy)

The outreach worktree's `databricks.yml` is the canonical one (integration-spec §6.3): it declares the `outreach_model` serving-endpoint resource (`databricks-llama-4-maverick`, `CAN_QUERY`) and sets `LLM_PROVIDER=databricks` + `OUTREACH_MODEL`. Ensure this version wins the merge (if main's wins, every draft silently degrades to the template). **Remove** the `google_maps_api_key` secret + `VITE_GOOGLE_MAPS_API_KEY` env (Maps is cut, D3). `start` is `vite build && node server.js` (integration-spec §6.2).

---

## 6. Acceptance checks
- `/api/outreach` payload (network tab) carries non-empty `capabilities` (from `specialtiesList`) and a real `facebook` URL when the facility has one; the draft references the clinic's services.
- With the LLM endpoint unreachable (or `OUTREACH_MAX_CALLS=0`), the panel still renders a template draft — UI never hard-fails (`source:"template"`).
- `OutreachPanel` has **no** per-slot Approve buttons; a `reply_received` request routes to the Schedule tab; `approveClinicTime` is gone (grep: `rg -n approveClinicTime src/App.jsx` → 0).
- A clinic reply (`reply_received` with `proposedTimes`) is visible to the scheduler as a `clinicReplies` input (integration-spec §7.2).
- `rg -niE "hospital exchange|facebookUrl" src/App.jsx` → no user-visible "Hospital exchange"; no facility-level `facebookUrl`.
- `databricks.yml` declares `outreach_model`; no Google Maps secret/env; `start` builds then serves.
