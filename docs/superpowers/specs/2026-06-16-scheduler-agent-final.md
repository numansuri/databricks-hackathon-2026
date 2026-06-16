# Scheduler — Build the Doctor's Week (FINAL, build-ready)

**Status:** Build-ready P0, client-only (no backend, no LLM, no Delta). **Supersedes** `2026-06-15-scheduler-agent-spec.md`.
**Adopts** that spec's deterministic engine, Constraint Ledger, and idempotent batched approval **verbatim** (incl. all its Codex #1–#16 fixes) — read it for the exhaustive engine internals. This FINAL doc restates the locked contract compactly and applies the **integration reconciliations** (it is now the app's *single* confirmation writer; facilities are real recommender-sourced rows with real lat/lng).
**Read first:** `2026-06-16-shiftlink-integration-spec.md`. **Merge order:** lands **last** of the three features (integration-spec §6.4). All `App.jsx` line numbers in the old spec are stale (outreach added ~+400 lines) — **re-grep symbols**.
**New module:** extract the engine into `src/scheduler.js` (Codex listed this file). The UI stays in `src/App.jsx`.

> **One line:** a deterministic, fully-explainable engine that selects ≤1 already-proposed slot per replying clinic, fits them around the doctor's fixed commitments, and emits a reviewable week + a per-clinic **Constraint Ledger** — narrated, never decided, by a template layer (LLM is stretch-only). It produces the **best schedule from confirmed clinic replies, not a globally optimal route**; it never invents a time, never assumes a clinic is free, never auto-confirms.

---

## 1. Where it fits
Step 4 of the arc: Onboard → Recommend → Outreach (clinic replies with `proposedTimes`) → **Schedule builds the week.** Its input is `outreachRequests` where `status==='reply_received'`; its output becomes confirmed `schedule` entries via the **one** confirmation writer (§4).

---

## 2. Reconciliations vs the 2026-06-15 spec (what changed)

| # | Change | Why |
|---|---|---|
| S1 | **The scheduler is the app's SINGLE confirmation writer.** Outreach's per-slot Approve buttons are removed and `approveClinicTime` retired (outreach spec §2). All clinic-reply → confirmed-visit goes through `confirmProposals`. | Integration-spec §7.3 / D23: two writers double-book; `approveClinicTime` drops `requestId`. |
| S2 | **`clinicReplies` joins the REAL `facilities` state array** (recommender-sourced canonical objects), which now carry real `lat`/`lng` from `gold_facility_enriched.lat_clean/long_clean` (99.64% present). The ~rare null → `unknown_location` band. | Integration-spec §3.2, §4, §7.2. The old hardcoded 3-clinic array is deleted. |
| S3 | **Travel ledger KEPT, stripped to the coarse 4-band model only.** No "Custom hub" free-entry, no route UI, no pincode UI. `homeBase` is a `<select>` over `facilities` (default the doctor's first confirmed-visit facility or `facilities[0]`). | Codex Q2: keep the honesty hero; cut the machinery around it. |
| S4 | **The `SchedulerPanel` ("Build my week") is the Schedule tab's primary surface.** The old manual "Add visit" builder is cut from the demo path. | Codex "more to cut": the deterministic build-my-week is the story; a manual add competes with it. |
| S5 | **`buildSchedule` lives in `src/scheduler.js`** (pure JS, unit-tested), imported by `App.jsx`. | Codex handoff file list; testability. |
| S6 | `persistOutreachRequests` is **already a functional updater** in the merge substrate (outreach worktree) — `confirmProposals` relies on this; no change needed there. | Verified in the outreach worktree. |

Everything else (the engine math, the ledger structure, the assumptions block, the persistence key) is adopted unchanged.

---

## 3. The deterministic engine (locked contract — `src/scheduler.js`)

Pure function `buildSchedule(inputs) → output`. Synchronous, no network, no solver. Same input → same output. All times are bare **IST wall-clock** `'HH:MM'` + `'YYYY-MM-DD'` strings; parse manually, sort as `(isoDateString, minutesSinceMidnight)`. **No `Date('YYYY-MM-DD')` parsing.**

**Inputs** (one object, three groups — full shapes in the 2026-06-15 spec §3):
- **`clinicReplies`** — `outreachRequests.filter(r => r.status==='reply_received').map(r => ({ requestId:r.id, facilityId, facilityName, lat, lng, proposedTimes }))`, joining `facilities.find(f=>f.id===r.facilityId)` for `lat/lng/facilityName`. Empty/missing `proposedTimes` → still passed in, emerges as `needs_new_times` (`no_slots_offered`); never dropped. `lat/lng` null → `unknown_location` band for that clinic.
- **`fixedAnchors`** — existing **confirmed** `schedule` entries (injected as anchors, enriched with their facility's lat/lng) **+** manual commitments (ward round, etc.; lat/lng optional → pure time-block). Anchors do NOT count toward `maxVisitsPerDay`.
- **`prefs`** — `{ homeBase:{lat,lng}, dateWindow:{start,end} (clamped to weekDays Mon–Fri 2026-06-15..06-19), maxVisitsPerDay (default 2), timeOfDayPref ('morning'|'afternoon'|'any'), mustBeBackBy (default '18:00' = latest HOME arrival incl. return buffer), defaultVisitMinutes (default 120), notes (display-only) }`. Working window fixed 09:00–17:00; `mustBeBackBy` wins when tighter.

**Travel buffer — the one and only table** (straight-line haversine km → per-leg minutes, reserved before arrival and after leaving):

| straight-line km | buffer/leg | band |
|---|---|---|
| `< 15` | 30 | `local` |
| `15–60` | 60 | `metro` |
| `60–150` | 120 | `regional` |
| `> 150` | 240 | `long_haul` |
| `null` (no coords) | 0 | `unknown_location` (ledger: "travel not checked") |

**Selection — exhaustive, not greedy.** Enumerate every assignment of {one slot | skip} per clinic (option space is tiny: ≤~6 clinics × {≤2 slots, skip}). Reject combinations violating the collision rule or `maxVisitsPerDay`. Among feasible combos pick best by lexicographic objective: (1) maximize scheduled clinic count; (2) maximize `timeOfDayPref` matches; (3) maximize total slack; (4) earliest dates/starts.

**Collision rule** (per day, with `buf(X,Y)=bandMinutes(haversineKm(X,Y))`): a candidate `[Cs,Ce]` is legal iff vs each earlier item `Cs ≥ Ne+buf`, vs each later item `Ce+buf ≤ Ns`, first-of-day `Cs ≥ workStart+buf(home,C)`, last-of-day `Ce+buf(C,home) ≤ mustBeBackBy`, and clinic-visit count ≤ `maxVisitsPerDay`.

**Output** — `{ proposals:[…], assumptions:[…] }`, one `proposal` per clinic (accepted AND rejected):
```js
{ id, facilityId, facilityName, requestId,
  verdict: 'accepted' | 'needs_new_times',
  slot: {date,time,label} | null,        // the ORIGINAL proposedTime, incl label (nothing fabricated)
  endTime, purpose,
  approvalStatus: 'doctor_approval_required', approved: false,
  ledger: { /* §3.1 */ } }
```
Zero feasible clinics is a **valid complete result** (all `needs_new_times`), not an error.

### 3.1 Constraint Ledger (the hero) — engine-generated, one per clinic
`{ facilityId, facilityName, verdict, conflictStatus ('clear'|'overlap'|'buffer_violation'|'max_per_day_reached'|'outside_window'|'past_back_by'|'no_slots_offered'), chosenSlot, consideredSlots:[{label,feasible,outcome,reasonCode,note}], legBuffers:[{from,to,km,band,minutes}], anchorImpact, assumptionApplied:[ids], reason }`. Reason codes + per-slot notes + per-leg buffers are **engine-generated**; the template/LLM narrator may only summarize them. Unknown-location legs carry `band:'unknown_location', minutes:0, note:'travel not checked'` — honest, never silently zeroed.

---

## 4. App integration & the ONE confirmation flow

**Entry point.** No new `activeView`. The `SchedulerPanel` is the **Schedule tab's primary surface** (replaces `ScheduleRibbon`/the manual builder in the right pane when `activeView==="schedule"`). Wire the dead **"Optimize"** button (`MapWorkspace`) — re-labeled **"Build my week"** — to open it; a `<Sparkles/> Build my week` button in the panel does the same.

**State on `DoctorApp`:**
```js
const [schedulerOpen, setSchedulerOpen] = useState(false);
const [scheduleRun, setScheduleRun] = useState(() => readJson(getScheduleRunKey(user.id), null));
// getScheduleRunKey(userId) => `referralCopilotScheduleRun:${userId}`  (same namespace)
```

**Handlers:** `runScheduler(prefs, anchors)` (assembles `clinicReplies` from `outreachRequests` + injects confirmed-schedule anchors, calls `buildSchedule`, runs `buildTemplateNarrative(facts)`, persists `scheduleRun`); `closeScheduler()`; `approveProposedVisit(id)=confirmProposals([id])`; `approveAllProposedVisits()=confirmProposals(allAcceptedUnapprovedIds)`.

**`confirmProposals(ids)` — the app's SINGLE confirmation writer (idempotent, ONE batched transaction):**
1. Resolve `ids` → not-yet-approved **accepted** proposals (skip `approved:true` / `needs_new_times`). **No-op if** the matching `outreachRequest.status==='appointment_confirmed'` OR a `schedule` entry with that `requestId` already exists (reuse `acceptHospitalRequest`'s guard). Re-clicks and double Approve-All are safe.
2. **Schedule (one functional call):** `updateSchedule(prev => [...newEntries, ...prev])` where each entry is the §7.2 schedule shape — `{ id, facilityId, requestId, date:slot.date, time:slot.time, purpose, status:'confirmed', approvalStatus:'doctor_approved', calendarStatus:'calendar_event_created', source:'clinic_reply', slotLabel:slot.label }`. **Every entry carries `requestId`+`slotLabel`** (integration-spec D24).
3. **Outreach (one functional call):** build `slotByRequestId` from the confirming proposals, then `setOutreachRequests(prev => prev.map(r => slotByRequestId.has(r.id) ? {...r, status:'appointment_confirmed', schedulingApprovalStatus:'doctor_approved', approvedTime:slotByRequestId.get(r.id)} : r))` and persist. **One pass — never loop `approveClinicTime`** (that read a stale closed-over array). Note: `persistOutreachRequests` is already functional in the merge substrate.
4. **Run (one call):** set `approved:true` on the confirmed proposals in `scheduleRun`; re-persist.

`needs_new_times` clinics are **never** approvable; their card shows an **"Ask for new times"** link → `createOutreachDraft(facilityId)` (its dedup guard routes to the existing open thread, no second draft).

**Components — three only:** `SchedulerPanel` (container: inlines the prefs form + fixed-commitments sub-section + assumptions banner + proposed-week strip), `LedgerCard` (one per clinic), `ProposalCard` (one per accepted clinic). Reuse existing styles (`.builderForm`, `.formSplit`, `.approvalIntro`, `.approvalStack`/`.approvalCard`, `.plannedList`, `weekDays` columns, `.visitBlock` + new `proposed`/`anchor` modifiers). The **Constraint Ledger panel renders unconditionally over every replied clinic** (accepted first, then needs-new-times, with a count badge), never gated behind `proposals.length`.

**Prefs capture** (local `useState`, seeded from `scheduleRun?.prefs`): `homeBase` `<select>` over `facilities` (default doctor's first confirmed-visit facility, else `facilities[0]?` — **guard empty**; **no "Custom hub" free-entry** per S3); `windowStart/End` date inputs clamped to `weekDays`; `maxVisitsPerDay` number (default 2); `timeOfDayPref` select; `mustBeBackBy` time (default 18:00); `defaultVisitMinutes` number (default 120); `notes` textarea (helper: "Optional. Shown to you as-is; it does not change the schedule."). Fixed-commitments sub-section: facility `<select>` (with "No location — time block only") + date + time + label, `<Plus/>`/`<Trash2/>`.

---

## 5. Assumptions block (attached to every output)
IST-only; ~120-min visits (editable); travel estimated from straight-line distance via coarse per-leg bands (30/60/120/240) — real road time is longer; clinic hours assumed 09:00–17:00 (unverified); "back by" = home arrival incl. return buffer; clinic availability/consent NOT verified (every visit still needs doctor approval + clinic confirmation); optimizes ONLY over slots clinics already proposed — no new slots invented; time-only commitments blocked on time only.
**Killer line (footer + demo close):** *"This doesn't pretend to know road traffic or clinic availability — it optimizes only over confirmed proposed slots and flags what needs renegotiation."*

---

## 6. Persistence
- Confirmed visits keep persisting via the existing `getScheduleKey(user.id)` + `updateSchedule` path (approved proposals land there unchanged).
- Latest run persists under `getScheduleRunKey(user.id)` via `saveJson`; read on mount; only the most recent run kept. Approving mutates `approved` on the matching `proposals[]` item and re-persists.
- **P1 (stretch):** write each run to `workspace.referral_copilot.schedule_runs` (writable catalog); + the LLM narrator (one `temperature:0` call that only narrates engine-decided facts, with `buildTemplateNarrative` fallback — never on the feasibility path). Both stretch-only.

---

## 7. Build plan (P0 ≈ 4 h, client-only)
1. `src/scheduler.js`: `buildSchedule(inputs)` — manual IST parse, haversine, per-leg banded buffers, confirmed-schedule→anchors injection, exhaustive {slot|skip} selection, collision rule (home-arrival `mustBeBackBy`), reason codes, per-clinic ledger. **Unit-test the collision + selection math.** — 1.5 h
2. `SchedulerPanel` prefs form + fixed-commitments sub-section (defaults per §4; clamp to `weekDays`; homeBase `<select>`, no custom hub) + notes. — 45 min
3. Wire "Optimize"→"Build my week" → `runScheduler` → `buildSchedule` → `buildTemplateNarrative`. — 20 min
4. Constraint Ledger UI (`LedgerCard` over ALL replied clinics + assumptions banner). — 1 h
5. `buildTemplateNarrative(facts)` — pure JS, `{daySummaries, tradeoffSummary}`, no network. — 30 min
6. `confirmProposals` single batched writer + `approveProposedVisit`/`approveAllProposedVisits` + persistence (§4). — 30 min

**── MVP CUT LINE ──** deterministic engine + template narrative + Constraint Ledger + one-writer approval. **NO backend, NO LLM, NO Delta.** Fully demoable. Stretch: LLM narrator, `schedule_runs` Delta, editable per-item duration. (`parsedHints` from notes is permanently cut.)

---

## 8. Acceptance checks
- `src/scheduler.js` unit tests: collision rule (home bookends + `mustBeBackBy`), exhaustive selection (prefers more-clinics→prefs→slack), reason codes, zero-feasible = valid result.
- The Schedule tab's primary surface is `SchedulerPanel`; the dead "Optimize" button is live ("Build my week"); the manual "Add visit" builder is removed from the demo path.
- `clinicReplies` is built from real recommender-sourced facilities; a clinic with real lat/lng shows concrete per-leg bands; a null-coord clinic shows "travel not checked" (not "0 min").
- **One confirmation path:** `confirmProposals` is the only code that writes a `clinic_reply` schedule entry; `rg -n approveClinicTime src/App.jsx` → 0; every clinic-reply entry has `requestId`+`slotLabel`; re-clicking "Approve all {n}" is a no-op; bulk approve flips ALL matched requests (not just the last).
- The Constraint Ledger renders over every replied clinic (accepted + needs-new-times) even when zero are accepted.
- Same input → byte-identical output (no `Date`/locale/random in the engine).
