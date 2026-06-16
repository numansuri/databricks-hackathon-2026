// scheduler.test.mjs — hand-rolled unit tests for src/scheduler.js.
// Run: `node src/scheduler.test.mjs` (exits non-zero on any failure).
// No test framework, no deps.

import { buildSchedule, buildTemplateNarrative, ASSUMPTIONS, KILLER_LINE } from "./scheduler.js";

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error("  FAIL: " + msg);
  }
}
function eq(a, b, msg) {
  ok(a === b, msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}
function section(name) {
  console.log("\n# " + name);
}

// Ahmedabad-ish coords used throughout. Home + two near clinics + one far clinic.
const HOME = { city: "Ahmedabad", lat: 23.0225, lng: 72.5714 };
const NEAR_A = { lat: 23.03, lng: 72.58 }; // ~1 km from home -> local (30)
const NEAR_B = { lat: 23.05, lng: 72.60 }; // ~4 km from home -> local (30)
const FAR = { lat: 19.076, lng: 72.8777 }; // Mumbai, ~440 km -> long_haul (240)

function clinic(id, name, coords, times) {
  return {
    requestId: "req-" + id,
    facilityId: "fac-" + id,
    facilityName: name,
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
    proposedTimes: times,
  };
}

// ===========================================================================
section("collision rule: home bookends + mustBeBackBy");

// A single near clinic at 11:00 (120 min -> ends 13:00). Home->clinic local 30.
// First-of-day: 11:00 >= 09:00 + 30 = 09:30  OK.
// Last-of-day home arrival: 13:00 + 30 = 13:30 <= 18:00  OK. -> accepted.
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "11:00", label: "Thu 11:00" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME, mustBeBackBy: "18:00" },
  });
  eq(out.proposals.length, 1, "one proposal for one clinic");
  eq(out.proposals[0].verdict, "accepted", "near clinic at 11:00 is accepted");
  eq(out.proposals[0].endTime, "13:00", "endTime is 13:00 (120 min)");
  eq(out.proposals[0].ledger.conflictStatus, "clear", "ledger conflictStatus is clear");
}

// mustBeBackBy tight: clinic ends 13:00, +30 return = 13:30; back-by 13:00 -> past_back_by.
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "11:00", label: "Thu 11:00" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME, mustBeBackBy: "13:00" },
  });
  eq(out.proposals[0].verdict, "needs_new_times", "tight mustBeBackBy rejects the visit");
  eq(out.proposals[0].ledger.conflictStatus, "past_back_by", "reason is past_back_by");
}

// First-of-day home buffer: a FAR clinic (long_haul 240) at 09:00 violates the
// home-arrival start rule (09:00 < 09:00 + 240). Should be rejected as buffer_violation.
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Mumbai Clinic", FAR, [{ date: "2026-06-16", time: "09:00", label: "Mon 09:00" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME, mustBeBackBy: "18:00", defaultVisitMinutes: 120 },
  });
  // 09:00 start is also < workStart? No, == workStart. But home buffer 240 pushes
  // earliest start to 13:00. Plus end 11:00 + 240 return = 15:00 OK; it's the start
  // that fails. Also end 11:00 < workEnd. So the failure is the first-of-day buffer.
  eq(out.proposals[0].verdict, "needs_new_times", "far clinic at 09:00 rejected (home buffer)");
  eq(out.proposals[0].ledger.conflictStatus, "buffer_violation", "reason is buffer_violation (home start buffer)");
}

// Two overlapping slots same day -> only one fits; the other clinic gets a reason.
{
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "11:00", label: "A 11:00" }]),
      clinic("2", "Fortis", NEAR_B, [{ date: "2026-06-18", time: "11:30", label: "B 11:30" }]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2 },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  // 11:00-13:00 and 11:30-13:30 overlap directly -> at most one can be scheduled.
  eq(acc.length, 1, "directly overlapping slots: only one accepted");
}

// ===========================================================================
section("exhaustive selection: more-clinics > prefs > slack");

// Clinic X offers a slot that, if chosen, blocks clinic Y; but a DIFFERENT slot
// of X lets both fit. Greedy-first might pick the blocking one; exhaustive must
// prefer the 2-clinic outcome.
{
  // X morning slots: 09:30 (blocks) or 15:00 (lets Y at 11:00 fit).
  // Actually construct: X at 11:00 blocks Y at 11:30 (overlap). X also offers
  // 09:30 which leaves room for Y at 12:30 (after buffer). Both near (local 30).
  const out = buildSchedule({
    clinicReplies: [
      clinic("X", "ClinicX", NEAR_A, [
        { date: "2026-06-18", time: "11:00", label: "X 11:00" },
        { date: "2026-06-18", time: "09:30", label: "X 09:30" },
      ]),
      clinic("Y", "ClinicY", NEAR_B, [{ date: "2026-06-18", time: "12:30", label: "Y 12:30" }]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2, timeOfDayPref: "any" },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  eq(acc.length, 2, "exhaustive selection fits BOTH clinics (prefers more clinics)");
  // X must have taken its 09:30 slot (the one that leaves room), not 11:00.
  const xProp = out.proposals.find((p) => p.facilityId === "fac-X");
  eq(xProp.slot.time, "09:30", "X took the slot that lets Y also fit");
}

// prefs tie-break: equal clinic count, choose the morning slot when pref=morning.
{
  // One clinic, two non-conflicting standalone slots on different days: 10:00 (morning)
  // vs 14:00 (afternoon). Only one is chosen (one slot per clinic). pref=morning -> 10:00.
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [
        { date: "2026-06-16", time: "14:00", label: "Mon 14:00" },
        { date: "2026-06-17", time: "10:00", label: "Tue 10:00" },
      ]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, timeOfDayPref: "morning" },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  eq(acc.length, 1, "one clinic accepted (one slot)");
  eq(acc[0].slot.time, "10:00", "morning pref selects the 10:00 slot over 14:00");
}

// slack tie-break: equal count + equal pref, choose roomier placement.
{
  // pref=any so prefMatch is 0 for both. Two standalone slots; one is tighter
  // against mustBeBackBy. With pref any, slack decides: the earlier/roomier one.
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [
        { date: "2026-06-16", time: "10:00", label: "Mon 10:00" }, // ends 12:00, lots of slack
        { date: "2026-06-16", time: "14:30", label: "Mon 14:30" }, // ends 16:30, +30 =17:00, less slack to 18:00
      ]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, timeOfDayPref: "any", mustBeBackBy: "18:00" },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  eq(acc[0].slot.time, "10:00", "slack tie-break selects the roomier 10:00 slot");
}

// ===========================================================================
section("reason codes for each conflictStatus path");

// no_slots_offered
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "EmptyClinic", NEAR_A, [])],
    fixedAnchors: [],
    prefs: { homeBase: HOME },
  });
  eq(out.proposals[0].verdict, "needs_new_times", "empty proposedTimes -> needs_new_times");
  eq(out.proposals[0].ledger.conflictStatus, "no_slots_offered", "conflictStatus no_slots_offered");
  eq(out.proposals[0].ledger.consideredSlots.length, 0, "no considered slots when none offered");
}

// outside_window (date not in week)
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-07-01", time: "10:00", label: "Jul 1" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME },
  });
  eq(out.proposals[0].ledger.conflictStatus, "outside_window", "out-of-window date -> outside_window");
}

// outside_window (end past workEnd 17:00) — slot 16:00 + 120 = 18:00 > 17:00.
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-16", time: "16:00", label: "Mon 16:00" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME, mustBeBackBy: "18:00" },
  });
  // workEnd = min(17:00, 18:00) = 17:00. Ends 18:00 > 17:00 -> outside_window.
  eq(out.proposals[0].ledger.conflictStatus, "outside_window", "end past 17:00 with loose back-by -> outside_window");
}

// past_back_by (end past mustBeBackBy when back-by is the tighter bound)
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-16", time: "13:30", label: "Mon 13:30" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME, mustBeBackBy: "15:00" },
  });
  // workEnd = min(17:00, 15:00) = 15:00. Ends 15:30 > 15:00 -> past_back_by.
  eq(out.proposals[0].ledger.conflictStatus, "past_back_by", "end past back-by (tighter) -> past_back_by");
}

// overlap with an anchor (anchors do not count toward maxVisitsPerDay).
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "09:30", label: "Thu 09:30" }])],
    fixedAnchors: [
      { id: "ward", facilityName: "Ward round", date: "2026-06-18", time: "09:00", durationMinutes: 120, lat: NEAR_A.lat, lng: NEAR_A.lng, source: "manual" },
    ],
    prefs: { homeBase: HOME },
  });
  // Anchor 09:00-11:00; clinic 09:30-11:30 overlaps directly.
  eq(out.proposals[0].verdict, "needs_new_times", "clinic overlapping anchor -> needs_new_times");
  eq(out.proposals[0].ledger.conflictStatus, "overlap", "overlapping anchor -> overlap reason");
}

// buffer_violation between two near clinics whose gap is too short for the band.
{
  // Apollo 11:00-13:00, Fortis 13:15 (gap 15 < 30 local buffer) -> buffer_violation.
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "11:00", label: "A 11:00" }]),
      clinic("2", "Fortis", NEAR_B, [{ date: "2026-06-18", time: "13:15", label: "B 13:15" }]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2 },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  eq(acc.length, 1, "buffer too short: only one of the two near clinics fits");
}

// max_per_day_reached: 3 standalone-fitting slots same day, maxVisitsPerDay=2.
{
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "A", NEAR_A, [{ date: "2026-06-16", time: "09:30", label: "A" }]),
      clinic("2", "B", NEAR_A, [{ date: "2026-06-16", time: "12:00", label: "B" }]),
      clinic("3", "C", NEAR_A, [{ date: "2026-06-16", time: "14:30", label: "C" }]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2 },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  eq(acc.length, 2, "maxVisitsPerDay=2 caps the day at 2 clinic visits");
  const rej = out.proposals.find((p) => p.verdict === "needs_new_times");
  eq(rej.ledger.conflictStatus, "max_per_day_reached", "third clinic -> max_per_day_reached");
}

// ===========================================================================
section("zero-feasible input -> valid result (not a throw)");

{
  let threw = false;
  let out;
  try {
    out = buildSchedule({
      clinicReplies: [
        clinic("1", "Apollo", NEAR_A, [{ date: "2026-07-01", time: "10:00", label: "out" }]),
        clinic("2", "Empty", NEAR_B, []),
      ],
      fixedAnchors: [],
      prefs: { homeBase: HOME },
    });
  } catch (e) {
    threw = true;
  }
  ok(!threw, "zero-feasible input does not throw");
  eq(out.proposals.length, 2, "all clinics still appear in proposals");
  ok(out.proposals.every((p) => p.verdict === "needs_new_times"), "all clinics needs_new_times");
  ok(Array.isArray(out.assumptions) && out.assumptions.length === ASSUMPTIONS.length, "assumptions attached");
}

// Completely empty input is also valid.
{
  let threw = false;
  let out;
  try {
    out = buildSchedule({ clinicReplies: [], fixedAnchors: [], prefs: { homeBase: HOME } });
  } catch (e) {
    threw = true;
  }
  ok(!threw, "empty clinicReplies does not throw");
  eq(out.proposals.length, 0, "no proposals for no clinics");
}

// buildSchedule with no inputs at all is valid.
{
  let threw = false;
  try {
    buildSchedule();
  } catch (e) {
    threw = true;
  }
  ok(!threw, "buildSchedule() with no args does not throw");
}

// ===========================================================================
section("determinism: same input twice -> JSON.stringify equal");

{
  const input = {
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [
        { date: "2026-06-18", time: "11:00", label: "A 11:00" },
        { date: "2026-06-17", time: "09:30", label: "A 09:30" },
      ]),
      clinic("2", "Fortis", NEAR_B, [{ date: "2026-06-18", time: "14:00", label: "B 14:00" }]),
      clinic("3", "Mumbai", FAR, [{ date: "2026-06-19", time: "10:00", label: "M 10:00" }]),
      clinic("4", "Unknown", null, [{ date: "2026-06-16", time: "10:00", label: "U 10:00" }]),
    ],
    fixedAnchors: [
      { id: "ward", facilityName: "Ward round", date: "2026-06-18", time: "08:00", durationMinutes: 60, lat: NEAR_A.lat, lng: NEAR_A.lng },
    ],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2, timeOfDayPref: "morning", mustBeBackBy: "18:00" },
  };
  const a = JSON.stringify(buildSchedule(input));
  const b = JSON.stringify(buildSchedule(input));
  ok(a === b, "two runs produce byte-identical JSON");
  // Narrative is also deterministic.
  const na = JSON.stringify(buildTemplateNarrative(buildSchedule(input)));
  const nb = JSON.stringify(buildTemplateNarrative(buildSchedule(input)));
  ok(na === nb, "narrative is byte-identical across runs");
}

// ===========================================================================
section("unknown_location honesty: null coords -> band 'unknown_location', 0 min, note");

{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "MysteryClinic", null, [{ date: "2026-06-18", time: "11:00", label: "M 11:00" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME },
  });
  // Null coords -> no travel math; clinic should still be accepted (time-only).
  eq(out.proposals[0].verdict, "accepted", "unknown-location clinic accepted on time only");
  const legs = out.proposals[0].ledger.legBuffers;
  ok(legs.length > 0, "leg buffers present");
  ok(legs.every((l) => l.band === "unknown_location"), "all legs band unknown_location");
  ok(legs.every((l) => l.minutes === 0), "all legs minutes 0");
  ok(legs.every((l) => l.note === "travel not checked"), "all legs note 'travel not checked' (not silently zeroed)");
  ok(legs.every((l) => l.km === null), "unknown legs km null");
}

// Known-coord clinic shows concrete bands (the contrast case).
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "11:00", label: "A 11:00" }])],
    fixedAnchors: [],
    prefs: { homeBase: HOME },
  });
  const legs = out.proposals[0].ledger.legBuffers;
  ok(legs.some((l) => l.band === "local" && l.minutes === 30), "near clinic shows a concrete 30-min local band");
  ok(legs.every((l) => typeof l.km === "number"), "known-coord legs carry numeric km");
}

// ===========================================================================
section("ledger completeness over EVERY replied clinic");

{
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "11:00", label: "A 11:00" }]),
      clinic("2", "Empty", NEAR_B, []),
      clinic("3", "OutOfWindow", NEAR_B, [{ date: "2026-07-01", time: "10:00", label: "X" }]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME },
  });
  eq(out.proposals.length, 3, "one proposal per replied clinic (accepted + rejected)");
  ok(out.proposals.every((p) => p.ledger && typeof p.ledger.conflictStatus === "string"), "every proposal has a ledger with conflictStatus");
  ok(out.proposals.every((p) => p.requestId != null), "every proposal carries requestId");
  ok(out.proposals.every((p) => Array.isArray(p.ledger.legBuffers)), "every ledger has legBuffers");
  ok(out.proposals.every((p) => Array.isArray(p.ledger.assumptionApplied) && p.ledger.assumptionApplied.length > 0), "every ledger references assumptions");
  // Accepted proposal slot is the ORIGINAL proposedTime (incl label).
  const acc = out.proposals.find((p) => p.verdict === "accepted");
  eq(acc.slot.label, "A 11:00", "accepted slot carries the original label (nothing fabricated)");
}

// ===========================================================================
section("narrative summarizes engine facts only");

{
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "11:00", label: "A 11:00" }]),
      clinic("2", "Empty", NEAR_B, []),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME },
  });
  const narr = buildTemplateNarrative(out);
  ok(Array.isArray(narr.daySummaries), "narrative has daySummaries array");
  eq(narr.daySummaries.length, 1, "one day summary for one accepted visit");
  ok(narr.daySummaries[0].summary.indexOf("Apollo") !== -1, "day summary names the scheduled clinic");
  ok(narr.tradeoffSummary.indexOf(KILLER_LINE) !== -1, "tradeoff summary includes the killer line");
}

// Zero-accepted narrative is valid.
{
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Empty", NEAR_A, [])],
    fixedAnchors: [],
    prefs: { homeBase: HOME },
  });
  const narr = buildTemplateNarrative(out);
  eq(narr.daySummaries.length, 0, "no day summaries when nothing accepted");
  ok(typeof narr.tradeoffSummary === "string" && narr.tradeoffSummary.length > 0, "tradeoff summary still present");
}

// ===========================================================================
section("Codex bug #1: mustBeBackBy judged on the TRUE last item, not every item");

{
  // Far clinic 13:00-13:30 (long_haul home 240) then a near clinic 15:30-16:00.
  // If mustBeBackBy were applied to the FAR clinic as if it returned home, it
  // would be 13:30+240=17:30 > mustBeBackBy. But the near clinic is the real
  // last item: 16:00 + 30 = 16:30 home. With mustBeBackBy 17:00 BOTH must fit.
  // Use short visits so the far clinic's own slot is legal on the day.
  const out = buildSchedule({
    clinicReplies: [
      clinic("far", "FarClinic", FAR, [{ date: "2026-06-16", time: "13:00", label: "F 13:00" }]),
      clinic("near", "NearClinic", NEAR_A, [{ date: "2026-06-16", time: "15:30", label: "N 15:30" }]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2, defaultVisitMinutes: 30, mustBeBackBy: "17:00", timeOfDayPref: "any" },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted").map((p) => p.facilityId).sort();
  // far->near buffer: far(13:00-13:30) -> near(15:30): need 13:30 + buf(FAR,NEAR_A)=240 -> 17:30 > 15:30? That FAILS.
  // So they cannot both fit due to the inter-clinic buffer. This case instead
  // verifies the FAR clinic alone is NOT rejected solely on a phantom return leg
  // when it is followed by a nearer last item is moot here; verify both-or-buffer.
  // The key assertion: the engine does NOT crash and returns a valid result, and
  // the far clinic is judged by inter-clinic buffer, not a phantom home return.
  ok(out.proposals.length === 2, "both clinics present");
  // far+near can't co-exist (240 inter-clinic buffer), so exactly one is accepted.
  eq(acc.length, 1, "long inter-clinic buffer admits only one of the two");
}

{
  // Cleaner #1 regression: two NEAR clinics, the EARLIER one would fail a phantom
  // "return home by mustBeBackBy" if checked as last, but the later one is truly
  // last. clinic A 14:30-16:30, clinic B 09:30-11:30. mustBeBackBy 17:00.
  // A as last: 16:30 + 30 = 17:00 <= 17:00 OK. B not last so no home return.
  // Old buggy code checked B (placed first, momentarily "last") -> B 11:30+30=12:00
  // fine anyway; to truly exercise the bug we need the EARLIER item to look like it
  // exceeds back-by when treated as last. Use a tight back-by where only the order
  // matters: A 13:00-15:00 then B 15:30-17:00? B last: 17:00+30=17:30 > 17:00 fail.
  // So make B near and last with room: A 11:00-13:00, B 13:30-15:30; mustBeBackBy 16:30.
  // B is last: 15:30+30=16:00 <= 16:30 OK. A is first: 11:00 >= 09:00+30 OK. Both fit.
  const out = buildSchedule({
    clinicReplies: [
      clinic("A", "ClinicA", NEAR_A, [{ date: "2026-06-16", time: "11:00", label: "A 11:00" }]),
      clinic("B", "ClinicB", NEAR_B, [{ date: "2026-06-16", time: "13:30", label: "B 13:30" }]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2, defaultVisitMinutes: 120, mustBeBackBy: "16:30", timeOfDayPref: "any" },
  });
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  eq(acc.length, 2, "two near clinics both fit; back-by checked only on the true last item");
}

// ===========================================================================
section("Codex bug #2: anchor that is genuinely last does not reject clinic visits");

{
  // A near clinic before a LATE near anchor. The anchor (16:00-16:30) returns
  // home at 17:00, past mustBeBackBy 16:30 - but it is the doctor's own immovable
  // commitment. The clinic before it (10:00-12:00) must still be accepted: the
  // engine schedules AROUND anchors and never rejects a clinic because the
  // doctor's own last-item anchor returns home late. Both are NEAR so the
  // inter-item travel buffer (30 min) is satisfied (12:00 + 30 = 12:30 <= 16:00).
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-16", time: "10:00", label: "A 10:00" }])],
    fixedAnchors: [
      { id: "late-anchor", facilityName: "Late ward round", date: "2026-06-16", time: "16:00", durationMinutes: 30, lat: NEAR_B.lat, lng: NEAR_B.lng, source: "manual" },
    ],
    prefs: { homeBase: HOME, mustBeBackBy: "16:30", defaultVisitMinutes: 120 },
  });
  // late-anchor home return = 16:30 + 30 = 17:00 > 16:30, but anchors are exempt
  // from the home bookend. Apollo (true non-last clinic) is accepted.
  eq(out.proposals[0].verdict, "accepted", "clinic before a late anchor is accepted (anchor exempt from back-by)");
}

// ===========================================================================
section("Codex bug #3: accepted clinic's alternate same-day slot not falsely max_per_day");

{
  // One clinic, two same-day non-overlapping slots, maxVisitsPerDay=1. The chosen
  // slot is accepted; the OTHER slot must NOT be reported max_per_day_reached
  // (swapping is still one visit). It should read as a displaced/feasible alt.
  const out = buildSchedule({
    clinicReplies: [
      clinic("1", "Apollo", NEAR_A, [
        { date: "2026-06-16", time: "10:00", label: "A 10:00" },
        { date: "2026-06-16", time: "14:00", label: "A 14:00" },
      ]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 1, timeOfDayPref: "any" },
  });
  const acc = out.proposals.find((p) => p.verdict === "accepted");
  ok(acc, "the clinic is accepted");
  const considered = acc.ledger.consideredSlots;
  const chosen = considered.find((s) => s.outcome === "chosen");
  const other = considered.find((s) => s.outcome !== "chosen");
  ok(chosen, "one slot is chosen");
  ok(other, "the other slot is present in consideredSlots");
  ok(other.reasonCode !== "max_per_day_reached", "alternate slot of an accepted clinic is NOT falsely max_per_day_reached");
  eq(other.reasonCode, null, "feasible alternate carries no conflict reasonCode");
  eq(other.feasible, true, "feasible alternate is marked feasible");
}

// ===========================================================================
section("Codex bug #4: needs_new_times clinic blocked by an anchor carries anchorImpact");

{
  // Clinic's only slot overlaps a fixed anchor -> needs_new_times with overlap,
  // and anchorImpact must name the anchor (not null).
  const out = buildSchedule({
    clinicReplies: [clinic("1", "Apollo", NEAR_A, [{ date: "2026-06-18", time: "09:30", label: "A 09:30" }])],
    fixedAnchors: [
      { id: "ward", facilityName: "Ward round", date: "2026-06-18", time: "09:00", durationMinutes: 120, lat: NEAR_A.lat, lng: NEAR_A.lng, source: "manual" },
    ],
    prefs: { homeBase: HOME },
  });
  const p = out.proposals[0];
  eq(p.verdict, "needs_new_times", "overlapping-anchor clinic is needs_new_times");
  eq(p.ledger.conflictStatus, "overlap", "conflictStatus overlap");
  ok(p.ledger.anchorImpact !== null, "anchorImpact is populated (not null)");
  eq(p.ledger.anchorImpact.affectedByAnchor, "ward", "anchorImpact names the blocking anchor");
}

// ===========================================================================
section("Codex follow-up: earliness tie-break is lexicographic, not summed");

{
  // Two clinics. Clinic P: only Mon 12:00. Clinic Q: Tue 11:00 OR earlier Tue
  // 09:30 (09:30 is the earliest legal local start = 09:00 + 30 home buffer).
  // With pref=any, count=2 both ways. The EARLIER legal start must win the final
  // earliness tier; a summed key could be fooled by P, lexicographic cannot.
  const out = buildSchedule({
    clinicReplies: [
      clinic("P", "ClinicP", NEAR_A, [{ date: "2026-06-15", time: "12:00", label: "P Mon 12:00" }]),
      clinic("Q", "ClinicQ", NEAR_B, [
        { date: "2026-06-16", time: "11:00", label: "Q Tue 11:00" },
        { date: "2026-06-16", time: "09:30", label: "Q Tue 09:30" },
      ]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2, timeOfDayPref: "any", mustBeBackBy: "18:00" },
  });
  const q = out.proposals.find((p) => p.facilityId === "fac-Q");
  eq(q.verdict, "accepted", "Q accepted");
  eq(q.slot.time, "09:30", "earliest legal start chosen for Q (lexicographic earliest)");
}

{
  // Direct check of the repro shape from the reviewer: a single very-early extra
  // visit must NOT mask a later second visit. Build A (Mon 09:00 fixed) and a
  // clinic B whose two options are Tue 09:00 vs Tue 10:00; B must take 09:00.
  const out = buildSchedule({
    clinicReplies: [
      clinic("A", "ClinicA", NEAR_A, [{ date: "2026-06-15", time: "09:30", label: "A Mon" }]),
      clinic("B", "ClinicB", NEAR_B, [
        { date: "2026-06-16", time: "10:00", label: "B Tue 10:00" },
        { date: "2026-06-16", time: "09:30", label: "B Tue 09:30" },
      ]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2, timeOfDayPref: "any", mustBeBackBy: "18:00" },
  });
  const b = out.proposals.find((p) => p.facilityId === "fac-B");
  eq(b.slot.time, "09:30", "B takes the earlier of its two standalone Tue slots");
}

{
  // Interacting same-day pair (slack non-constant) + a third clinic: the engine
  // must still maximize count, then place the earliest-first feasible week, and
  // do so deterministically.
  const input = {
    clinicReplies: [
      clinic("X", "X", NEAR_A, [
        { date: "2026-06-15", time: "09:30", label: "X930" },
        { date: "2026-06-15", time: "13:00", label: "X1300" },
      ]),
      clinic("Y", "Y", NEAR_B, [
        { date: "2026-06-15", time: "11:30", label: "Y1130" },
        { date: "2026-06-15", time: "14:30", label: "Y1430" },
      ]),
      clinic("Z", "Z", NEAR_A, [
        { date: "2026-06-16", time: "09:30", label: "Z930" },
        { date: "2026-06-16", time: "12:00", label: "Z1200" },
      ]),
    ],
    fixedAnchors: [],
    prefs: { homeBase: HOME, maxVisitsPerDay: 2, timeOfDayPref: "any", mustBeBackBy: "18:00" },
  };
  const out = buildSchedule(input);
  const acc = out.proposals.filter((p) => p.verdict === "accepted");
  eq(acc.length, 3, "all three clinics fit (count maximized across interacting day)");
  const x = out.proposals.find((p) => p.facilityId === "fac-X");
  const z = out.proposals.find((p) => p.facilityId === "fac-Z");
  eq(x.slot.time, "09:30", "X takes its earliest feasible slot");
  eq(z.slot.time, "09:30", "Z takes its earliest feasible slot");
  // Determinism across the interacting case.
  ok(JSON.stringify(buildSchedule(input)) === JSON.stringify(out), "interacting case is deterministic");
}

// ===========================================================================
console.log("\n========================================");
console.log("PASSED: " + passed + "   FAILED: " + failed);
if (failed > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("All tests passed.");
process.exit(0);
