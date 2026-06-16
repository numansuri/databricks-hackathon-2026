# Scheduler Agent — Build the Doctor's Week from Confirmed Clinic Replies

**One-line summary:** A deterministic, fully-explainable engine that selects one already-proposed time slot per replying clinic, fits them around the doctor's fixed commitments, and emits a reviewable week plus a per-clinic Constraint Ledger — narrated, never decided, by an optional template/LLM layer.

**Honest framing:** This produces the **best schedule from confirmed clinic replies, not a globally optimal route.** It never invents a time, never assumes a clinic is free, and never auto-confirms. It optimizes only over the specific slots clinics already offered, and surfaces everything it could not fit as a first-class "needs new times" list with the engine's reason.

---

## 1. Where it fits — the pipeline

This is **step 4 of 4** in the Referral Copilot arc:

1. Doctor searches/shortlists facilities → 2. Outreach drafts go out → 3. Clinics **reply with proposed times** → **4. Scheduler builds the week from those replies.**

> **User story:** *"Three clinics replied with slots. I have one hospital ward round Thursday. Give me a week that fits — mornings, max 2 visits a day, back by 6 — and tell me exactly what didn't fit and why, so I approve each one myself."*

---

## 2. Scope & explicit non-goals

**In scope:** select ≤1 proposed slot per replied clinic; respect doctor's fixed commitments + existing confirmed schedule; coarse banded travel buffers from straight-line distance; a Constraint Ledger over **every** replied clinic; per-item + bulk approval through the app's existing approve path; a deterministic template narrative.

**Explicit non-goals (deliberately cut):**
- **No route optimization** (no TSP / nearest-neighbor / clustering / ILP). Clinic-fixed slot times already impose a total order; re-ordering would re-derive an order the clinics fixed.
- **No new slot invention** — only times clinics explicitly proposed are considered.
- **No real road/traffic time, no clinic-hours lookup, no availability/consent check** — all approximated and labeled as assumptions.
- **No backend, no LLM, no Databricks/Delta in the MVP** (see §7 — LLM is a stretch appendix only).
- **No `parsedHints` from free-text notes** — notes parsed-but-not-applied would look dishonest (e.g. "keep Wednesday light" while Wednesday is full). Notes are captured and stored, surfaced verbatim to the doctor, never machine-acted-on. *(Codex #13)*
- **No run history** — only the latest run is persisted.

---

## 3. Inputs

Pure function: `buildSchedule(inputs) → output`. One `inputs` object, three groups. All times are bare **IST wall-clock** `'HH:MM'` (24h) and `'YYYY-MM-DD'` strings. **No `Date('YYYY-MM-DD')` parsing, no browser-local label generation** — date+time are parsed manually and sorted as `(isoDateString, minutesSinceMidnight)`. *(Codex #3)*

### (a) `clinicReplies` — derived, the optimization target

Built by filtering `outreachRequests` to `status === 'reply_received'`, joining each to `facilities.find(f => f.id === req.facilityId)` for coordinates. One entry per replied clinic. `proposedTimes` is copied verbatim from the existing reply shape (App.jsx L577). A clinic with empty/missing `proposedTimes` is still passed in and emerges as `needs_new_times` (`conflictStatus: 'no_slots_offered'`) — never silently dropped.

```js
clinicReplies: [{
  requestId:    'uuid',          // outreachRequest.id — carried for approveClinicTime
  facilityId:   'fac-1',
  facilityName: 'Apollo Clinic, Ahmedabad',
  lat: 23.0225, lng: 72.5714,    // from facility; null → no travel math for this clinic
  proposedTimes: [               // verbatim from outreachRequest.proposedTimes
    { date: '2026-06-18', time: '11:00', label: 'Thu, Jun 18 at 11:00' },
    { date: '2026-06-19', time: '14:30', label: 'Fri, Jun 19 at 14:30' }
  ]
}]
```

### (b) `fixedAnchors` — hard time-blocks (doctor commitments **+ existing confirmed schedule**)

Two sources, merged into one list of immovable blocks the engine schedules *around* (never reschedules): *(Codex #5)*
- **Existing confirmed entries** — every entry already in the `schedule` array (`status === 'confirmed'`) is injected as an anchor by default, enriched with its facility's `lat/lng`, so the engine cannot propose over an existing visit.
- **Manual commitments** — doctor-declared in-person blocks (ward round, etc.), `lat/lng` optional.

```js
fixedAnchors: [{
  id: 'anchor-1',
  facilityName: 'Civil Hospital ward round',  // or free label
  date: '2026-06-18', time: '09:30',
  durationMinutes: 120,                        // optional; defaults to defaultVisitMinutes
  lat: 23.05, lng: 72.60,                      // optional → null = pure time-block
  source: 'manual' | 'existing_schedule', isAnchor: true
}]
```

If `lat/lng` present, the anchor participates in buffer math. If absent it is a **pure time-only block**: collision on time only, and the ledger renders *"time-only block; travel not checked"* — never the misleading "0 min travel." *(Codex #9)* **Anchors do NOT consume `maxVisitsPerDay`** — that cap counts clinic visits only. *(Codex #6)*

### (c) `prefs` — the structured form (+ optional notes)

```js
prefs: {
  homeBase:           { city: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  dateWindow:         { start: '2026-06-15', end: '2026-06-19' }, // inclusive, IST — see §4
  maxVisitsPerDay:    2,
  timeOfDayPref:      'morning',   // 'morning' | 'afternoon' | 'any'
  mustBeBackBy:       '18:00',     // IST — latest HOME ARRIVAL (return buffer included) — see §4
  defaultVisitMinutes: 120,        // editable single default
  notes:              ''           // optional free text — stored & shown verbatim, never machine-acted-on
}
```

Working-hours window is fixed at **09:00–17:00 IST** (assumed, surfaced) — but `mustBeBackBy` always wins as the day's hard end when tighter.

---

## 4. Deterministic engine

Plain JS, synchronous, no solver, no network. Same input → same output.

**Date-window truth (single source).** *(Codex #2)* The MVP renders the existing `weekDays` ribbon (App.jsx L120, Mon–Fri **2026-06-15 … 2026-06-19**). `dateWindow` is **clamped to that rendered week**; the prefs form's date inputs default to and cannot exceed it. Day columns derive from `dateWindow`, so engine and UI never disagree. (The earlier slice's "Jun 16 Mon / Jun 20 Fri" labels were wrong and are dropped.)

**`mustBeBackBy` definition (single rule).** *(Codex #4)* It is the latest **home arrival** — i.e. last visit `end + return-leg buffer ≤ mustBeBackBy`. "Back by 6" means *home* by 6, return travel included. The day's hard end for any visit's *finish* is `workEnd = min(17:00, mustBeBackBy)`; the home-arrival rule adds the return buffer on top.

**Step 0 — minute helpers.** `hhmmToMin('HH:MM') → int`. Work in integer minutes; format back only at output. Group candidates by `date` string.

**Step 1 — haversine.** `haversineKm(a, b)`, R = 6371. Either point missing coords → `null` → zero buffer attributed to that leg (and flagged unknown in the ledger).

**Step 2 — haversine → travel-buffer BANDS (the one and only table).** *(Codex #7 — all `+45m` / `×1.4–1.6` / "TBD" alternatives deleted.)* A blunt, visible lookup. The buffer is reserved **before arriving and after leaving**, attributed **per leg**.

| straight-line km | buffer per leg | band label |
|---|---|---|
| `< 15` | 30 min | `local` |
| `15 – 60` | 60 min | `metro` |
| `60 – 150` | 120 min | `regional` |
| `> 150` | 240 min | `long_haul` |
| `null` (no coords) | 0 min | `unknown_location` |

**Step 3 — seed the timeline.** For each day in `dateWindow`, place that day's `fixedAnchors` as occupied intervals `[start, start+duration]`.

**Step 4 — build candidates.** Expand every clinic's `proposedTimes` into `{ requestId, facilityId, date, start, end = start + defaultVisitMinutes, slot }` where `slot` is the **original proposedTime object including `label`** (carried untouched for approval). Drop candidates outside `dateWindow` or with `end > workEnd`; record the drop reason code. Sort by `(date, start)`.

**Step 5 — exhaustive selection (NOT greedy).** *(Codex #1 — the "single forward pass is exact" claim was false with alternate slots; replaced with a tiny exact search.)* The option space is microscopic: ≤ ~6 clinics × {≤2 slots, or "skip"} ≈ a few hundred combinations over a ≤5-day window. So **enumerate** every assignment of {one slot | skip} per clinic. Reject any combination that violates the **collision rule** (below) on any day or exceeds `maxVisitsPerDay`. Among all *feasible* combinations, pick the best by lexicographic objective:
1. **maximize scheduled clinic count** (fit the most clinics);
2. then maximize total `timeOfDayPref` matches;
3. then maximize total slack (sum of margins to neighbors);
4. then earliest dates, earliest starts (deterministic tie-break).

This is **simpler and provably correct** for this size — no backtracking heuristics, no exactness hand-waving.

> **Collision rule.** For a candidate visit `C = [Cs, Ce]` on a day, with `buf(X,Y) = bandMinutes(haversineKm(X,Y))`:
> - vs an **earlier** placed item `N=[Ns,Ne]`: `Cs ≥ Ne + buf(N,C)`.
> - vs a **later** placed item `N`: `Ce + buf(C,N) ≤ Ns`.
> - **first item of day** vs home: `Cs ≥ workStart + buf(homeBase,C)`.
> - **last item of day** vs home (the `mustBeBackBy` rule): `Ce + buf(C,homeBase) ≤ mustBeBackBy`.
>
> A day's arrangement is legal iff every visit passes against its immediate temporal neighbors **and** both home bookends, **and** clinic-visit count `≤ maxVisitsPerDay`.

**Step 6 — reason codes for skipped clinics.** Any clinic not in the winning combination is `needs_new_times` with the **dominant** machine reason code from its best-attempted slot: `overlap | buffer_violation | max_per_day_reached | outside_window | past_back_by | no_slots_offered`. *(Codex #16 — reason codes are engine-generated, prose only summarizes them.)*

**Output object** *(single canonical shape — see §9 for the run record it becomes):*

```js
{
  proposals: [                     // one per clinic, BOTH accepted and rejected
    {
      id:           '<temp-uuid>', // re-minted on approval
      facilityId:   'fac-1',
      facilityName: 'Apollo Clinic, Ahmedabad',
      requestId:    '<outreachRequest.id>',
      verdict:      'accepted' | 'needs_new_times',
      slot:         { date:'2026-06-18', time:'11:00', label:'Thu, Jun 18 at 11:00' } | null, // original proposedTime, incl label
      endTime:      '13:00' | null,
      purpose:      'Specialist visit — Apollo Clinic, Ahmedabad',
      approvalStatus: 'doctor_approval_required',  // NEVER auto-confirmed
      approved:     false,                          // idempotency flag
      ledger:       { /* ledgerEntry, see §5 */ }
    }
  ],
  assumptions: [ /* literal strings, see §8 */ ]
}
```

**This `proposals[]` is the ONE shape.** *(Codex #11 — `proposedVisits` / `accepted` / `scheduleRun.proposals` are all collapsed into `proposals`.)* The engine never writes to localStorage; approval happens in the app (§6).

**Zero-feasible path:** if no clinic is accepted, that is a **valid, complete result**, not an error. Every clinic appears in `proposals` with `verdict:'needs_new_times'`, and the UI renders the ledger + "Couldn't fit these — here's why."

---

## 5. Constraint Ledger (data structure) — the hero

The engine emits **one `ledger` record per clinic** (accepted and rejected), rich enough to render an honest, evidence-style card. Reason codes, per-slot pass/fail notes, **per-leg buffers**, and assumption IDs are all **engine-generated**; human/LLM prose may only summarize them. *(Codex #8, #16)*

```js
ledgerEntry = {
  facilityId:   'fac-1',
  facilityName: 'Apollo Clinic, Ahmedabad',
  verdict:      'accepted' | 'needs_new_times',
  conflictStatus: 'clear' | 'overlap' | 'buffer_violation'
                | 'max_per_day_reached' | 'outside_window' | 'past_back_by'
                | 'no_slots_offered',

  chosenSlot: { date:'2026-06-18', time:'11:00', endTime:'13:00',
                label:'Thu, Jun 18 at 11:00' } | null,

  consideredSlots: [   // EVERY proposed slot + its fate, with a concrete note
    { label:'Thu, Jun 18 at 11:00', feasible:true,  outcome:'chosen',
      note:'fits morning pref; 95-min slack before next item' },
    { label:'Fri, Jun 19 at 14:30', feasible:false, outcome:'rejected',
      reasonCode:'max_per_day_reached',
      note:'Friday already holds 2 clinic visits (maxVisitsPerDay=2); this would be the 3rd' }
  ],

  legBuffers: [        // PER-LEG, not one band per clinic — home→clinic, clinic→anchor, clinic→home each differ
    { from:'homeBase',     to:'Apollo Clinic', km:7.4,  band:'local', minutes:30 },
    { from:'Apollo Clinic', to:'anchor-1',     km:3.1,  band:'local', minutes:30 },
    { from:'Apollo Clinic', to:'homeBase',     km:7.4,  band:'local', minutes:30 }
  ],

  anchorImpact: { affectedByAnchor:'anchor-1',
    note:'must finish before 09:30 Civil Hospital ward round + buffer' } | null,

  assumptionApplied: [ 'visit_duration_120m', 'road_buffer_band', 'hours_9_to_5', 'mustbeback_home_arrival' ],

  reason: 'Scheduled: best morning fit, no conflicts.'
        // or 'Needs new times: only offered slot collides with the 09:30 anchor once the travel buffer is applied.'
}
```

For unknown-location items, `legBuffers` entries carry `band:'unknown_location', minutes:0, note:'travel not checked'` so the gap is **honest, not silently zeroed.**

---

## 6. App & UX integration

**Entry point.** No new `activeView` tab (stays `"search" | "outreach" | "schedule" | "shortlist"`). The scheduler is a panel on the existing **Schedule** workspace, gated by new state on `DoctorApp`:

```js
const [schedulerOpen, setSchedulerOpen] = useState(false);
const [scheduleRun, setScheduleRun] = useState(() => readJson(getScheduleRunKey(user.id), null));
```

**Wire the dead "Optimize" button** (`MapWorkspace`, App.jsx L1332 — currently no `onClick`): pass `onOptimize` from `DoctorApp`; on the schedule view it reads **"Optimize schedule"** and calls `setActiveView("schedule"); setSchedulerOpen(true)`. (A `<Sparkles/> Build my week` button in `SchedulePanel` wires to the same handler — both already-imported icons.)

**New handlers on `DoctorApp`** (named to match `addSchedule`/`approveClinicTime`/`updateSchedule`):
- `runScheduler(prefs, anchors)` — assembles `clinicReplies` + injects existing-confirmed-schedule anchors, calls `buildSchedule(...)`, runs `buildTemplateNarrative(facts)`, sets+persists `scheduleRun`.
- `closeScheduler()` — `setSchedulerOpen(false)`.
- `approveProposedVisit(proposalId)`, `approveAllProposedVisits()` — see below.

**Components — kept deliberately few** *(Codex #14 — eight-component explosion cut to three):*
- **`SchedulerPanel`** — container rendered by `MapWorkspace` when `activeView==="schedule" && schedulerOpen`, replacing `ScheduleRibbon` in the right pane. It inlines the **prefs form** (reusing `.builderForm`/`.formSplit`), the **assumptions banner** (reusing `.approvalIntro`), and the proposed-week strip (reusing the existing `weekDays` column markup + `.visitBlock` with a new `proposed` / `anchor` modifier).
- **`LedgerCard`** — one per clinic (reusing `.approvalStack`/`.approvalCard`).
- **`ProposalCard`** — one per **accepted** clinic in the review list (reusing `.plannedList`).

No extracted ribbon helper, no separate `AssumptionsNote`/`NoFitNotice`/`ProposedScheduleView`/`SchedulerPrefsForm` components — those are sections inside `SchedulerPanel`.

**Preference capture** (inside `SchedulerPanel`, local `useState` per field, seeded from `scheduleRun?.prefs`):

| Field | Control | Default |
|---|---|---|
| `homeBaseFacilityId` | `<select>` over `facilities` + "Custom hub" | `facilities[0].id` |
| `windowStart` / `windowEnd` | `<input type="date">`, clamped to `weekDays` | `2026-06-15` / `2026-06-19` |
| `maxVisitsPerDay` | `<input type="number" min=1 max=6>` | `2` |
| `timeOfDayPref` | `<select>` any/morning/afternoon | `any` |
| `mustBeBackBy` | `<input type="time">` | `18:00` |
| `defaultVisitMinutes` | `<input type="number" step=30>` | `120` |
| `notes` | `<textarea rows=2>` | `""` |

Notes helper text: *"Optional. Shown to you as-is; it does not change the schedule."*
**Fixed commitments** sub-section: facility `<select>` (with **"No location — time block only"** option) + date + time + label; `<Plus/>` adds, `<Trash2/>` removes. Anchor shape `{ id, facilityId?, date, time, durationMinutes, purpose, kind:'anchor' }`; empty `facilityId` → pure time-block. Footer: `<button className="primaryButton"><Sparkles/> Propose schedule</button>` → `runScheduler(prefsObj, anchors)`.

**Proposed-schedule review.** Header line: **"Best schedule from confirmed clinic replies"** (never "optimal"). A Mon–Fri `weekDays` strip shows accepted proposals as `.visitBlock.proposed` (time, clinic, `<Navigation size={11}/>` buffer chip) and anchors as `.visitBlock.anchor`; empty days show "Open." Below, one `ProposalCard` per accepted clinic: clinic name + chosen slot (`date · time` from `proposedTimes`), the duration + per-leg buffer line, a per-card **Approve** button, status pill *"Needs your approval."*

**Constraint Ledger panel** (the honesty hero, rendered directly under the review header — **unconditionally over every replied clinic**, never gated behind `proposals.length`). *(Codex #15)* Accepted first, then "needs new times," with a count badge ("4 accepted · 2 need new times"). Each `LedgerCard`:
- **Header** — clinic name + verdict pill: `Accepted` (`<ShieldCheck/>`, green) or `Needs new times` (`<AlertCircle/>`, amber).
- **Chosen / considered slot** — `<CalendarCheck size={15}/>` + chosen slot, or "no proposed slot fit."
- **Conflict status** — `<Clock3 size={15}/>` + the engine `conflictStatus` rendered ("No overlap" / "Overlaps anchor at 09:30" / "Home-arrival exceeds 18:00").
- **Per-leg travel buffers** — `<Navigation size={15}/>`, one row per leg ("7.4 km → 30 min local"); unknown-location → "travel not checked."
- **Anchor impact** — one line when a commitment forced/blocked the choice.
- **Assumption applied** — italic caption listing the `assumptionApplied` IDs in plain words.

**Approval flow — idempotent, ONE batched transaction.** *(Codex #10 + final-pass build-breaker)* Proposals are PROPOSALS (`approvalStatus:'doctor_approval_required'`, `approved:false`); they do **not** enter `schedule` until approved.

> **Do NOT loop `approveClinicTime()` for bulk approve.** `approveClinicTime` flips outreach state via `persistOutreachRequests(outreachRequests.map(...))` from the **closed-over** `outreachRequests`. Calling it N times in one render reads the same stale array each time, so only the **last** clinic ends up `appointment_confirmed` and earlier flips are lost. Both single- and bulk-approve must therefore go through one batched helper that applies **one functional state update per slice.**

Single internal helper — `confirmProposals(ids)` — used by both buttons:
1. Resolve `ids` → the not-yet-approved, **accepted** proposals (skip any `approved:true` or `needs_new_times`). If none, no-op (idempotency — re-clicks and double Approve-All are safe).
2. **Schedule** (one call): `updateSchedule(prev => [...newEntries, ...prev])`, where each `newEntry` mirrors the existing clinic-reply shape — `{ facilityId, date: slot.date, time: slot.time, purpose, status:'confirmed', approvalStatus:'doctor_approved', calendarStatus:'calendar_event_created', source:'clinic_reply', requestId }`. `slot` is the full original proposedTime **including `label`**, so nothing is fabricated. (`updateSchedule` is already a functional updater, so this is safe in a batch.)
3. **Outreach** (one *functional* call): build `slotByRequestId = Map(requestId → chosenSlot)` from the confirming proposals, then `setOutreachRequests(prev => prev.map(r => slotByRequestId.has(r.id) ? {...r, status:'appointment_confirmed', schedulingApprovalStatus:'doctor_approved', approvedTime: slotByRequestId.get(r.id)} : r))` and `saveJson` the result — flipping **all** matched requests in a single pass (this is the fix vs looping `approveClinicTime`).
4. **Run** (one call): set `approved:true` on every confirmed proposal in `scheduleRun` and `saveJson` the run once.

- `approveProposedVisit(id)` = `confirmProposals([id])`.
- `approveAllProposedVisits()` = `confirmProposals(allAcceptedUnapprovedIds)`. Button `<button className="primaryButton"><Check/> Approve all {n} visits</button>` in the review footer.

"Needs new times" clinics are **never** approvable. Their card shows an **"Ask for new times"** link calling the existing `createOutreachDraft(facilityId)` — note its dedup guard finds the still-open `reply_received` request and simply **routes to that clinic's existing Outreach thread** (it does not mint a second draft), where the doctor follows up. Closing the scheduler without approving leaves `schedule` untouched.

---

## 7. Evidence & honest-uncertainty wiring (heaviest judging axis)

The **Constraint Ledger is the citation surface.** Every scheduled item cites the **clinic's own proposed slot** (`outreachRequest.proposedTimes[i]`, `source:'clinic_reply'`) as ground truth — the app never fabricates a time, it only *selects among times clinics offered*. Every number that is not ground truth is labeled an **assumption** carried in a persistent block and referenced per-decision via `assumptionApplied` IDs. Clinics that don't fit are a **first-class "needs new times" list** with the engine's machine reason code shown — failure is surfaced, never hidden, never silently dropped. **Per-leg buffers** (not one fuzzy per-clinic band) and **unknown-location honesty** ("travel not checked") mean the evidence is concrete, not invented.

**Product-judgment note:** the same ledger doubles as the trust UI — a non-technical doctor sees *why* each visit landed and approves per-item, so the honesty story and the usability story are the **same surface.** No LLM is ever on the feasibility path: distances, conflicts, and accept/reject are computed deterministically *before* any narration; if the narrator is slow, errors, or returns junk, the schedule is byte-identical — only the prose changes.

---

## 8. Assumptions block

Attached to every output (`output.assumptions`); each ledger entry references the subset it used:

```js
assumptions: [
  'All times are India Standard Time (IST); no other timezones are considered.',
  'Each visit is assumed to take ~120 minutes (editable default).',
  'Travel time is estimated from straight-line distance only; real road time is longer and is approximated with coarse per-leg buffer bands (30/60/120/240 min).',
  'Clinic working hours are assumed 09:00–17:00 IST — actual hours were not verified.',
  '"Back by" means arriving HOME by that time, including the estimated return-travel buffer.',
  'Clinic availability and consent are NOT verified; every visit still requires doctor approval and clinic confirmation.',
  'The schedule optimizes ONLY over slots clinics already proposed — no new slots are invented or assumed available.',
  'Time-only commitments (no location) are blocked on time only; their travel is not checked.'
]
```

**Killer line (UI footer + demo close):** *"This doesn't pretend to know road traffic or clinic availability — it optimizes only over confirmed proposed slots and flags what needs renegotiation."*

---

## 9. Persistence

One new key helper beside `getScheduleKey`/`getOutreachKey` (same `referralCopilot…:${userId}` namespace):

```js
function getScheduleRunKey(userId) { return `referralCopilotScheduleRun:${userId}`; }
```

- **Confirmed visits** keep persisting via the existing `getScheduleKey(user.id)` + `updateSchedule`/`addSchedule` path — approved proposals land there unchanged. No new write path.
- **The latest run** persists as a single record under `getScheduleRunKey(user.id)` via `saveJson`, read on mount with `readJson(getScheduleRunKey(user.id), null)`. Only the most recent run is kept (overwrite each `runScheduler`).

**Run record shape** (the engine output + form context + narrative):
```js
{ id, createdAt, prefs:{…}, anchors:[…],
  proposals:[ /* the §4 canonical proposals[], each with .approved + .ledger */ ],
  narrative:{ daySummaries:[…], tradeoffSummary }, assumptions:[…] }
```
Approving mutates `approved` on the matching `proposals[]` item and re-`saveJson`s the run, so ledger/review reflect approval state across reloads without touching the confirmed-schedule key.

**Later (post-hackathon, not MVP):** write each run to **`workspace.shiftlink_app.schedule_runs`** (the app-owned persistence namespace — the source clinic/NFHS data is a read-only Delta Share and is never written). Columns: `run_id`, `user_id`, `run_inputs` (JSON), `ledger` (JSON), `narrative` (JSON), `narrative_source` (`llm`|`template`), `model_used`, `created_at_ist`.

---

## 10. Build plan

On top of the single-file app. **MVP ≈ 4–4.5 h.**

1. **Prefs form + fixed-commitments sub-section** in `SchedulerPanel` (defaults per §6, clamped to `weekDays`) + notes box — **45 min**.
2. **Deterministic engine** `buildSchedule(inputs)`: manual IST parse, haversine, per-leg banded buffer, existing-confirmed-schedule → anchors injection, **exhaustive {slot|skip} selection** maximizing scheduled-count→prefs→slack, collision rule (home-arrival `mustBeBackBy`), reason codes, per-clinic ledger. Pure JS; unit-test the collision + selection math — **1.5 h**.
3. **Wire the dead "Optimize" button** → `runScheduler` → `buildSchedule` → `buildTemplateNarrative` — **20 min**.
4. **Constraint Ledger UI** (`LedgerCard` over **all** replied clinics, accepted + needs-new-times + assumptions banner) — **1 h**.
5. **`buildTemplateNarrative(facts)`** — pure JS, loops scheduled/rejected by date, emits `{ daySummaries, tradeoffSummary }`, no network — **30 min**.
6. **Approval wiring** — idempotent `approveProposedVisit` / `approveAllProposedVisits` via one batched `confirmProposals` helper (functional state updates per slice — NOT a loop over `approveClinicTime`) + persistence — **30 min**.

**── MVP CUT LINE ──** Ships with: deterministic engine + **template narrative** + Constraint Ledger UI + approval wiring. **NO backend, NO LLM, NO Delta.** Fully demoable. *(Codex #12)*

**Stretch (only if time, post-cut):** the LLM narrator (Appendix A); `schedule_runs` Delta logging; editable per-item duration. *(`parsedHints` is permanently cut, not stretch — Codex #13.)*

---

## 11. Demo script (30–45s — step 4 of the 5-step arc)

1. *"Three clinics replied with proposed times. I add my Thursday ward round and set prefs: mornings, max 2 a day, home by 6."* — fill the form. **(8s)**
2. *"Hit Optimize."* — click the now-live button; the week ribbon fills. **(5s)**
3. *"It picked one already-proposed slot per clinic and built the week around my commitment."* — point at Thu: the 09:30 ward round, then Apollo at 11:00 placed right after it once the travel buffer between them clears. **(8s)**
4. *"Open the Constraint Ledger."* — each visit cites the clinic's own slot, the per-leg travel buffers used, and the assumptions. One clinic sits in **"needs new times"** with its reason. **(10s)**
5. *"Approve all — these become calendar entries through the same path as a manual approval. Nothing was auto-sent or auto-confirmed."* **(6s)**
6. Close on the killer line: **"This doesn't pretend to know road traffic or clinic availability — it optimizes only over confirmed proposed slots and flags what needs renegotiation."** **(6s)**

---

## 12. Open questions / assumptions ledger

- **`mustBeBackBy` = home arrival, return buffer included** (resolved per Codex #4). Open: should a tighter `mustBeBackBy` also pull `workStart` earlier? Assumed **no** — start stays 09:00.
- **Existing confirmed entries are hard anchors by default** (Codex #5). Open: should the doctor be able to opt out per-entry? Assumed **no** for MVP.
- **Buffer bands** (30/60/120/240) are deterministic and shown; the km thresholds are an assumption, not measured.
- **Anchors never count toward `maxVisitsPerDay`** (Codex #6) — cap is clinic visits only.
- **One slot per clinic**, never two; ties broken by scheduled-count→prefs→slack→earliest.
- **Zero feasible clinics** is a valid first-class result, never an error.
- **"Approve all" skips "needs new times" clinics** — only feasible items are approvable (assumed yes).
- **Notes are display-only** (Codex #13) — captured, persisted, shown verbatim, never machine-acted-on.

---

## Appendix A — LLM narrator (STRETCH ONLY, not on the MVP path)

*Cut from the MVP per Codex #12; kept here as a thin stretch wrapper. The engine + template narrative ship and demo with no backend.*

**Model:** Claude Sonnet 4.6 via Databricks Foundation Model API. **Exactly ONE call** per run, `temperature:0`, `max_tokens≈1200`. The LLM **only narrates facts the engine already decided** — it never recomputes, reorders, adds, drops, or invents any item, distance, time, or availability. (`parsedHints` from notes is **not** part of even the stretch — Codex #13.)

**Backend fallback** reuses the exact `/api/transcribe` try/catch pattern (App.jsx ~285–303): `try` POST `/api/schedule-narrative`; on any failure → `buildTemplateNarrative(facts)`. Same `{ daySummaries, tradeoffSummary }` shape either way; **no LLM is ever on the feasibility path.**

```js
async function narrateSchedule(facts) {
  try {
    const res = await fetch("/api/schedule-narrative", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ facts }) });
    if (!res.ok) throw new Error("Narrative failed");
    return await res.json();               // { daySummaries, tradeoffSummary }
  } catch {
    return buildTemplateNarrative(facts);  // deterministic, no network — the MVP default
  }
}
```

**System-prompt intent:** *"You are a scheduling narrator, not a scheduler. Every fact has ALREADY been decided by a deterministic engine and is ground truth. NEVER recompute, reorder, add, drop, or invent anything. Write a warm, factual day-by-day narrative for a busy doctor citing only the facts provided; state assumptions as assumptions; for any rejected clinic, give the engine's reason verbatim. Output STRICT JSON only."*

---

**Source anchors (absolute):** `/Users/khooni-dracula/Workspace/databricks-hackathon/databricks-hackathon-2026/src/App.jsx` — lucide imports incl. `Sparkles, ShieldCheck, AlertCircle, Clock3, Navigation, CalendarCheck, Check, Plus, Trash2` (L2–34, all present); `weekDays` (L120); `readJson`/`saveJson` (L143/L152); `getOutreachKey`/`getScheduleKey` (L164/L168); seed `schedule` (L486, starts 2026-06-16); `updateSchedule` (L512); `addSchedule` (L537); `createOutreachDraft` + `proposedTimes` reply shape (L556/L577); `approveClinicTime(requestId, proposedTime)` reusing `addSchedule` (L606–641); `SchedulePanel` (L1914); `ScheduleRibbon` (L2028) with `visitBlock ${entry.status||"planned"}` (L2042); dead **Optimize** button (L1332); reusable styles `.builderForm` (L1545), `.formSplit` (L1844), `.approvalIntro` (L1538), `.approvalStack`/`.approvalCard` (L1561/L1566), `.plannedList` (L2001).
