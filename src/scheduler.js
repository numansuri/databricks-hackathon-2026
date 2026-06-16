// scheduler.js — deterministic "Build the Doctor's Week" engine for Shiftlink.
//
// Pure ES module: no dependencies, no network, no React, no Date-based parsing.
// Same input -> byte-identical output. See:
//   docs/superpowers/specs/2026-06-16-scheduler-agent-final.md   (locked contract)
//   docs/superpowers/specs/2026-06-15-scheduler-agent-spec.md    (engine internals, Codex #1-#16)
//   docs/superpowers/specs/2026-06-16-shiftlink-integration-spec.md §7.2 (handoff shapes)
//
// It produces the BEST schedule from confirmed clinic replies, not a globally
// optimal route. It never invents a time, never assumes a clinic is free, and
// never auto-confirms. All times are bare IST wall-clock 'HH:MM' + 'YYYY-MM-DD'
// strings, parsed manually (split on '-' and ':'). NEVER `new Date('YYYY-MM-DD')`.

// ---------------------------------------------------------------------------
// §5 / §8 assumptions block — attached verbatim to every output.
// ---------------------------------------------------------------------------
export const ASSUMPTIONS = [
  "All times are India Standard Time (IST); no other timezones are considered.",
  "Each visit is assumed to take ~120 minutes (editable default).",
  "Travel time is estimated from straight-line distance only; real road time is longer and is approximated with coarse per-leg buffer bands (30/60/120/240 min).",
  "Clinic working hours are assumed 09:00-17:00 IST - actual hours were not verified.",
  '"Back by" means arriving HOME by that time, including the estimated return-travel buffer.',
  "Clinic availability and consent are NOT verified; every visit still requires doctor approval and clinic confirmation.",
  "The schedule optimizes ONLY over slots clinics already proposed - no new slots are invented or assumed available.",
  "Time-only commitments (no location) are blocked on time only; their travel is not checked.",
];

// The killer line — surfaced in the UI footer and the demo close.
export const KILLER_LINE =
  "This doesn't pretend to know road traffic or clinic availability - it optimizes only over confirmed proposed slots and flags what needs renegotiation.";

// Assumption IDs referenced per-decision in each ledger entry (§5 assumptionApplied).
const ASSUMPTION_IDS = {
  duration: "visit_duration_120m",
  buffer: "road_buffer_band",
  hours: "hours_9_to_5",
  backBy: "mustbeback_home_arrival",
  ist: "ist_only",
};

// ---------------------------------------------------------------------------
// Defaults & fixed constants (§3 / §4).
// ---------------------------------------------------------------------------
const DEFAULTS = {
  maxVisitsPerDay: 2,
  timeOfDayPref: "any", // 'morning' | 'afternoon' | 'any'
  mustBeBackBy: "18:00", // latest HOME arrival incl. return buffer
  defaultVisitMinutes: 120,
};

// Working window is fixed 09:00-17:00 IST; mustBeBackBy wins when tighter.
const WORK_START_MIN = 9 * 60; // 09:00
const WORK_END_MIN = 17 * 60; // 17:00

// The rendered week ribbon: weekdays Mon-Fri 2026-06-15 .. 2026-06-19.
// dateWindow is clamped to exactly this set so engine and UI never disagree.
const WEEK_DAYS = [
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
  "2026-06-18",
  "2026-06-19",
];

// Morning / afternoon split for timeOfDayPref matching (start-time based).
const NOON_MIN = 12 * 60;

// ---------------------------------------------------------------------------
// Step 0 — minute / date helpers. Manual parse, no Date objects.
// ---------------------------------------------------------------------------

// 'HH:MM' -> integer minutes since midnight. Returns NaN on malformed input.
function hhmmToMin(hhmm) {
  if (typeof hhmm !== "string") return NaN;
  const parts = hhmm.split(":");
  if (parts.length < 2) return NaN;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

// integer minutes since midnight -> 'HH:MM' (zero-padded).
function minToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return pad(h) + ":" + pad(m);
}

// 'YYYY-MM-DD' -> comparable integer (yyyymmdd), manual split. No Date parsing.
function dateToInt(dateStr) {
  if (typeof dateStr !== "string") return NaN;
  const parts = dateStr.split("-");
  if (parts.length < 3) return NaN;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
    return NaN;
  return y * 10000 + mo * 100 + d;
}

// ---------------------------------------------------------------------------
// Step 1 — haversine straight-line km. Either point missing coords -> null.
// ---------------------------------------------------------------------------
function hasCoords(p) {
  return (
    p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng)
  );
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Returns km (number) or null if either endpoint lacks coords.
function haversineKm(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

// ---------------------------------------------------------------------------
// Step 2 — km -> banded per-leg buffer (the one and only table, §3).
// km === null (no coords) -> band 'unknown_location', 0 min, "travel not checked".
// ---------------------------------------------------------------------------
function bandForKm(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) {
    return { band: "unknown_location", minutes: 0 };
  }
  if (km < 15) return { band: "local", minutes: 30 };
  if (km <= 60) return { band: "metro", minutes: 60 };
  if (km <= 150) return { band: "regional", minutes: 120 };
  return { band: "long_haul", minutes: 240 };
}

// Per-leg buffer record between two named points. Unknown legs carry the honest
// note 'travel not checked' (never silently zeroed).
function legBuffer(from, fromPt, to, toPt) {
  const km = haversineKm(fromPt, toPt);
  const { band, minutes } = bandForKm(km);
  const rec = { from, to, km: km === null ? null : round1(km), band, minutes };
  if (band === "unknown_location") rec.note = "travel not checked";
  return rec;
}

// buf(X, Y) = band minutes only (the collision-math helper).
function bufMinutes(a, b) {
  return bandForKm(haversineKm(a, b)).minutes;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Input normalization.
// ---------------------------------------------------------------------------

// Clamp a dateWindow to the rendered weekdays Mon-Fri 2026-06-15..06-19.
function clampDateWindow(dateWindow) {
  const startInt = dateWindow ? dateToInt(dateWindow.start) : NaN;
  const endInt = dateWindow ? dateToInt(dateWindow.end) : NaN;
  // Default to the full week if absent/malformed.
  const lo = Number.isFinite(startInt) ? startInt : dateToInt(WEEK_DAYS[0]);
  const hi = Number.isFinite(endInt)
    ? endInt
    : dateToInt(WEEK_DAYS[WEEK_DAYS.length - 1]);
  return WEEK_DAYS.filter((d) => {
    const di = dateToInt(d);
    return di >= lo && di <= hi;
  });
}

function normalizePrefs(prefs) {
  const p = prefs || {};
  const homeBase = hasCoords(p.homeBase)
    ? { lat: p.homeBase.lat, lng: p.homeBase.lng, city: p.homeBase.city }
    : { lat: null, lng: null, city: p.homeBase && p.homeBase.city };
  const mustBeBackBy =
    typeof p.mustBeBackBy === "string" && Number.isFinite(hhmmToMin(p.mustBeBackBy))
      ? p.mustBeBackBy
      : DEFAULTS.mustBeBackBy;
  const maxVisitsPerDay = Number.isFinite(p.maxVisitsPerDay)
    ? p.maxVisitsPerDay
    : DEFAULTS.maxVisitsPerDay;
  const defaultVisitMinutes = Number.isFinite(p.defaultVisitMinutes)
    ? p.defaultVisitMinutes
    : DEFAULTS.defaultVisitMinutes;
  const timeOfDayPref =
    p.timeOfDayPref === "morning" || p.timeOfDayPref === "afternoon"
      ? p.timeOfDayPref
      : DEFAULTS.timeOfDayPref;
  return {
    homeBase,
    days: clampDateWindow(p.dateWindow),
    maxVisitsPerDay,
    timeOfDayPref,
    mustBeBackBy,
    mustBeBackByMin: hhmmToMin(mustBeBackBy),
    defaultVisitMinutes,
    notes: typeof p.notes === "string" ? p.notes : "",
  };
}

// Anchors: confirmed-schedule entries + manual commitments. lat/lng optional.
function normalizeAnchors(fixedAnchors, prefs) {
  const list = Array.isArray(fixedAnchors) ? fixedAnchors : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i] || {};
    const startMin = hhmmToMin(a.time);
    if (!Number.isFinite(dateToInt(a.date)) || !Number.isFinite(startMin)) {
      continue; // skip malformed anchors (no date/time)
    }
    const duration = Number.isFinite(a.durationMinutes)
      ? a.durationMinutes
      : prefs.defaultVisitMinutes;
    out.push({
      id: a.id != null ? String(a.id) : "anchor-" + i,
      facilityName: a.facilityName || a.purpose || "Commitment",
      date: a.date,
      startMin,
      endMin: startMin + duration,
      lat: hasCoords(a) ? a.lat : null,
      lng: hasCoords(a) ? a.lng : null,
      source: a.source === "existing_schedule" ? "existing_schedule" : "manual",
      isAnchor: true,
    });
  }
  return out;
}

// clinicReplies -> internal clinic records. Empty/missing proposedTimes is kept
// (emerges as needs_new_times / no_slots_offered). Never dropped.
function normalizeClinics(clinicReplies) {
  const list = Array.isArray(clinicReplies) ? clinicReplies : [];
  return list.map((r, idx) => {
    const proposed = Array.isArray(r.proposedTimes) ? r.proposedTimes : [];
    return {
      requestId: r.requestId != null ? r.requestId : null,
      facilityId: r.facilityId != null ? r.facilityId : null,
      facilityName: r.facilityName || "Clinic",
      lat: hasCoords(r) ? r.lat : null,
      lng: hasCoords(r) ? r.lng : null,
      proposedTimes: proposed,
      _order: idx, // stable original index for deterministic tie-breaks
    };
  });
}

// ---------------------------------------------------------------------------
// Candidate expansion (Step 4).
// Each proposedTime -> a candidate {date,start,end,slot,...} or a drop record
// with a window/back-by reason code (so the ledger can explain it).
// ---------------------------------------------------------------------------
function buildCandidates(clinic, prefs) {
  const candidates = [];
  for (let i = 0; i < clinic.proposedTimes.length; i++) {
    const slot = clinic.proposedTimes[i];
    const startMin = hhmmToMin(slot && slot.time);
    const dateOk =
      slot && prefs.days.indexOf(slot.date) !== -1 && Number.isFinite(dateToInt(slot.date));
    const label = (slot && slot.label) || (slot ? slot.date + " " + slot.time : "slot");
    if (!dateOk || !Number.isFinite(startMin)) {
      candidates.push({
        clinic,
        slot,
        slotIndex: i,
        label,
        feasibleStatically: false,
        reasonCode: "outside_window",
        note: dateOk
          ? "proposed time is unreadable"
          : "proposed date is outside the planning window (" +
            prefs.days[0] +
            " to " +
            prefs.days[prefs.days.length - 1] +
            ")",
      });
      continue;
    }
    const endMin = startMin + prefs.defaultVisitMinutes;
    // Day's hard finish = min(workEnd, mustBeBackBy). The return-buffer rule is
    // applied separately in the collision check (home arrival incl. buffer).
    const workEnd = Math.min(WORK_END_MIN, prefs.mustBeBackByMin);
    if (startMin < WORK_START_MIN) {
      candidates.push({
        clinic,
        slot,
        slotIndex: i,
        date: slot.date,
        startMin,
        endMin,
        label,
        feasibleStatically: false,
        reasonCode: "outside_window",
        note:
          "starts " +
          slot.time +
          ", before the 09:00 working-window open",
      });
      continue;
    }
    if (endMin > workEnd) {
      const isBackBy = prefs.mustBeBackByMin < WORK_END_MIN;
      candidates.push({
        clinic,
        slot,
        slotIndex: i,
        date: slot.date,
        startMin,
        endMin,
        label,
        feasibleStatically: false,
        reasonCode: isBackBy ? "past_back_by" : "outside_window",
        note:
          "ends " +
          minToHHMM(endMin) +
          ", past the day's finish (" +
          minToHHMM(workEnd) +
          ")",
      });
      continue;
    }
    candidates.push({
      clinic,
      slot,
      slotIndex: i,
      date: slot.date,
      startMin,
      endMin,
      label,
      feasibleStatically: true,
      reasonCode: null,
      note: null,
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// A day point is the {lat,lng} of an item, or null for a coords-less time block
// (anchors with no location buffer to 0 against their neighbors).
// ---------------------------------------------------------------------------
function dayPointFor(item) {
  return hasCoords(item) ? { lat: item.lat, lng: item.lng } : null;
}

// ---------------------------------------------------------------------------
// Validate a fully-assembled day arrangement at once (Codex bug #1/#2 fix).
// `items` = ALL items on the day (anchors + chosen clinics). We check each item
// against its TRUE immediate neighbors, and the home bookends against the day's
// TRUE first and last items — never against a partially-built day, so a far
// early visit followed by a nearer late one is judged by the real last item's
// return leg, and an anchor that is genuinely last gets its return checked too.
// Returns { ok:true } or { ok:false, reasonCode, note }.
// ---------------------------------------------------------------------------
function validateDayArrangement(items, prefs) {
  const home = hasCoords(prefs.homeBase) ? prefs.homeBase : null;
  const ordered = items
    .slice()
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  for (let i = 0; i < ordered.length; i++) {
    const it = ordered[i];
    const itPt = dayPointFor(it);

    // vs the immediately-previous item: gap >= buf(prev, it). Also catch overlap.
    if (i > 0) {
      const prev = ordered[i - 1];
      if (it.startMin < prev.endMin) {
        return {
          ok: false,
          reasonCode: "overlap",
          note:
            it.facilityName +
            " overlaps " +
            prev.facilityName +
            " (" +
            minToHHMM(prev.startMin) +
            "-" +
            minToHHMM(prev.endMin) +
            ")",
        };
      }
      const buf = bufMinutes(dayPointFor(prev), itPt);
      if (it.startMin < prev.endMin + buf) {
        return {
          ok: false,
          reasonCode: "buffer_violation",
          note:
            it.facilityName +
            " needs a " +
            buf +
            " min travel buffer after " +
            prev.facilityName +
            " (" +
            minToHHMM(prev.startMin) +
            "-" +
            minToHHMM(prev.endMin) +
            "); the gap is too short",
        };
      }
    }

    // First item of day vs home: Cs >= workStart + buf(home, C).
    // Anchors are immovable doctor-declared commitments — the engine schedules
    // AROUND them and never rejects the day because the doctor's own anchor
    // sits outside the working window. The home bookends therefore gate only
    // clinic visits (the items the engine actually chooses to place).
    if (i === 0 && !it.isAnchor) {
      const hb = bufMinutes(home, itPt);
      if (it.startMin < WORK_START_MIN + hb) {
        return {
          ok: false,
          reasonCode: "buffer_violation",
          note:
            "first visit of the day (" +
            it.facilityName +
            "): needs to start no earlier than " +
            minToHHMM(WORK_START_MIN + hb) +
            " (09:00 + " +
            hb +
            " min home-travel buffer), but starts " +
            minToHHMM(it.startMin),
        };
      }
    }

    // Last item of day vs home: Ce + buf(C, home) <= mustBeBackBy.
    // Same anchor exemption as the first-of-day rule.
    if (i === ordered.length - 1 && !it.isAnchor) {
      const hb = bufMinutes(itPt, home);
      if (it.endMin + hb > prefs.mustBeBackByMin) {
        return {
          ok: false,
          reasonCode: "past_back_by",
          note:
            "home arrival after " +
            it.facilityName +
            " would be " +
            minToHHMM(it.endMin + hb) +
            " (ends " +
            minToHHMM(it.endMin) +
            " + " +
            hb +
            " min return buffer), past back-by " +
            prefs.mustBeBackBy,
        };
      }
    }
  }
  return { ok: true, reasonCode: null, note: null };
}

// ---------------------------------------------------------------------------
// Feasibility of a full combination (one chosen candidate per clinic, or skip),
// across all days. The combination is feasible iff every assembled day passes
// validateDayArrangement AND no day exceeds maxVisitsPerDay (clinic visits only;
// anchors never count toward the cap).
// ---------------------------------------------------------------------------
function evaluateCombination(chosen, anchorsByDate, prefs) {
  // chosen = array of candidate objects (already statically feasible).
  const byDate = new Map();
  for (const c of chosen) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date).push(c);
  }

  // maxVisitsPerDay check (clinic visits only).
  for (const [, list] of byDate) {
    if (list.length > prefs.maxVisitsPerDay) {
      return { ok: false };
    }
  }

  // Validate each day as a fully-assembled arrangement (anchors + clinics).
  // Days that hold only anchors are also validated, so an anchor that lands
  // outside the home bookends fails fast.
  const allDates = new Set();
  for (const d of byDate.keys()) allDates.add(d);
  for (const d of anchorsByDate.keys()) allDates.add(d);

  for (const date of allDates) {
    const anchors = anchorsByDate.get(date) || [];
    const list = byDate.get(date) || [];
    const items = anchors
      .map((a) => ({
        startMin: a.startMin,
        endMin: a.endMin,
        lat: a.lat,
        lng: a.lng,
        facilityName: a.facilityName,
        isAnchor: true,
      }))
      .concat(
        list.map((c) => ({
          startMin: c.startMin,
          endMin: c.endMin,
          lat: c.clinic.lat,
          lng: c.clinic.lng,
          facilityName: c.clinic.facilityName,
          isAnchor: false,
        }))
      );
    if (items.length === 0) continue;
    const res = validateDayArrangement(items, prefs);
    if (!res.ok) return { ok: false };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Objective scoring for a feasible combination (§3 lexicographic):
//  (1) maximize scheduled clinic count
//  (2) maximize timeOfDayPref matches
//  (3) maximize total slack (sum of margins to neighbors + home bookends)
//  (4) earliest dates / earliest starts
// We return a comparable tuple; higher is better for 1-3, "earlier" handled by
// negating an ordering key.
// ---------------------------------------------------------------------------
function prefMatches(chosen, prefs) {
  if (prefs.timeOfDayPref === "any") return 0;
  let n = 0;
  for (const c of chosen) {
    const isMorning = c.startMin < NOON_MIN;
    if (prefs.timeOfDayPref === "morning" && isMorning) n++;
    if (prefs.timeOfDayPref === "afternoon" && !isMorning) n++;
  }
  return n;
}

// Total slack: sum over each chosen item of the margin to its nearest temporal
// neighbor (or home bookends) beyond the required buffer. Larger = roomier.
function totalSlack(chosen, anchorsByDate, prefs) {
  const home = hasCoords(prefs.homeBase) ? prefs.homeBase : null;
  const byDate = new Map();
  for (const c of chosen) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date).push(c);
  }
  let slack = 0;
  for (const [date, list] of byDate) {
    const anchors = anchorsByDate.get(date) || [];
    const items = anchors
      .map((a) => ({ startMin: a.startMin, endMin: a.endMin, lat: a.lat, lng: a.lng, isAnchor: true }))
      .concat(
        list.map((c) => ({
          startMin: c.startMin,
          endMin: c.endMin,
          lat: c.clinic.lat,
          lng: c.clinic.lng,
          isAnchor: false,
        }))
      )
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.isAnchor) continue; // slack measured for clinic visits
      const itPt = hasCoords(it) ? { lat: it.lat, lng: it.lng } : null;
      // gap before (vs previous item or home)
      if (i === 0) {
        const hb = bufMinutes(home, itPt);
        slack += it.startMin - (WORK_START_MIN + hb);
      } else {
        const prev = items[i - 1];
        const prevPt = hasCoords(prev) ? { lat: prev.lat, lng: prev.lng } : null;
        slack += it.startMin - (prev.endMin + bufMinutes(prevPt, itPt));
      }
      // gap after (vs next item or home)
      if (i === items.length - 1) {
        const hb = bufMinutes(itPt, home);
        slack += prefs.mustBeBackByMin - (it.endMin + hb);
      } else {
        const next = items[i + 1];
        const nextPt = hasCoords(next) ? { lat: next.lat, lng: next.lng } : null;
        slack += next.startMin - (it.endMin + bufMinutes(itPt, nextPt));
      }
    }
  }
  return slack;
}

// Earliness key: the SORTED list of (dateInt*1440 + startMin) absolute-minute
// timestamps over the chosen visits. Compared LEXICOGRAPHICALLY (not summed), so
// "earliest dates/starts" means the earliest first visit, then the earliest
// second visit, and so on — a single very-late visit can't be masked by another
// very-early one (Codex follow-up fix).
function earlinessKey(chosen) {
  return chosen
    .map((c) => dateToInt(c.date) * 1440 + c.startMin)
    .sort((x, y) => x - y);
}

// Lexicographic compare of two sorted number arrays: <0 if a<b, >0 if a>b, 0 eq.
// A shorter array that is a prefix of the longer sorts first (earlier).
function cmpEarliness(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// Compare two scored combos; returns true if A is strictly better than B.
function comboBetter(a, b) {
  if (a.count !== b.count) return a.count > b.count;
  if (a.prefMatch !== b.prefMatch) return a.prefMatch > b.prefMatch;
  if (a.slack !== b.slack) return a.slack > b.slack;
  const earl = cmpEarliness(a.earliness, b.earliness);
  if (earl !== 0) return earl < 0; // lexicographically earlier wins
  // Final fully-deterministic tie-break: lexicographic on chosen slot identity.
  return a.tieKey < b.tieKey;
}

function comboTieKey(chosen) {
  // Stable string of (clinicOrder:date:start) tuples, sorted.
  return chosen
    .map((c) => c.clinic._order + ":" + c.date + ":" + c.startMin)
    .sort()
    .join("|");
}

// ---------------------------------------------------------------------------
// Exhaustive selection (Step 5). Enumerate {one feasible candidate | skip} per
// clinic. The option space is tiny (~6 clinics x {<=2 slots, skip}).
// ---------------------------------------------------------------------------
function selectBestCombination(clinics, candidatesByClinic, anchorsByDate, prefs) {
  // Per-clinic option list: each statically-feasible candidate, plus "skip" (null).
  const optionLists = clinics.map((clinic) => {
    const feas = (candidatesByClinic.get(clinic._order) || []).filter(
      (c) => c.feasibleStatically
    );
    return feas.concat([null]); // null === skip
  });

  let best = null;

  // Iterative cartesian product over optionLists (deterministic order: each
  // clinic's feasible candidates in slot order, then skip last).
  const idx = new Array(optionLists.length).fill(0);
  const total = optionLists.reduce((acc, l) => acc * l.length, 1);

  for (let n = 0; n < total; n++) {
    // Decode n -> idx (mixed-radix).
    let rem = n;
    for (let i = optionLists.length - 1; i >= 0; i--) {
      const len = optionLists[i].length;
      idx[i] = rem % len;
      rem = Math.floor(rem / len);
    }
    const chosen = [];
    for (let i = 0; i < optionLists.length; i++) {
      const opt = optionLists[i][idx[i]];
      if (opt) chosen.push(opt);
    }
    const feas = evaluateCombination(chosen, anchorsByDate, prefs);
    if (!feas.ok) continue;
    const scored = {
      chosen,
      count: chosen.length,
      prefMatch: prefMatches(chosen, prefs),
      slack: totalSlack(chosen, anchorsByDate, prefs),
      earliness: earlinessKey(chosen),
      tieKey: comboTieKey(chosen),
    };
    if (best === null || comboBetter(scored, best)) {
      best = scored;
    }
  }

  // The empty combination is always feasible, so `best` is never null.
  return best || { chosen: [], count: 0, prefMatch: 0, slack: 0, earliness: 0, tieKey: "" };
}

// ---------------------------------------------------------------------------
// Per-clinic ledger + reason-code derivation (Step 6).
// For a clinic NOT in the winning combination, derive the DOMINANT reason from
// its best-attempted slot: probe each statically-feasible slot against the
// winning placement; if all collide, take the most-informative reasonCode.
// ---------------------------------------------------------------------------

// Severity ordering for picking the dominant reason among a clinic's slots.
const REASON_SEVERITY = {
  no_slots_offered: 0,
  outside_window: 1,
  past_back_by: 2,
  max_per_day_reached: 3,
  overlap: 4,
  buffer_violation: 5,
};

// Build the placed-items map for the winning combination, by date.
function placedItemsByDate(winningChosen, anchorsByDate) {
  const map = new Map();
  // anchors
  for (const [date, anchors] of anchorsByDate) {
    map.set(
      date,
      anchors.map((a) => ({
        startMin: a.startMin,
        endMin: a.endMin,
        lat: a.lat,
        lng: a.lng,
        facilityName: a.facilityName,
        isAnchor: true,
      }))
    );
  }
  for (const c of winningChosen) {
    if (!map.has(c.date)) map.set(c.date, []);
    map.get(c.date).push({
      startMin: c.startMin,
      endMin: c.endMin,
      lat: c.clinic.lat,
      lng: c.clinic.lng,
      facilityName: c.clinic.facilityName,
      isAnchor: false,
      _order: c.clinic._order,
    });
  }
  return map;
}

// Count clinic visits per day in the winning combination (for max_per_day check).
function clinicCountByDate(winningChosen) {
  const m = new Map();
  for (const c of winningChosen) {
    m.set(c.date, (m.get(c.date) || 0) + 1);
  }
  return m;
}

// Probe a single rejected/non-chosen slot against the winning placement and
// explain it. `ownerOrder` is the clinic._order that owns this slot; its own
// winning slot (if any) is EXCLUDED from the day so an accepted clinic's
// alternate slot isn't falsely counted against itself (Codex bug #3).
function probeRejectedSlot(cand, winningChosen, anchorsByDate, prefs, ownerOrder) {
  // Static drops first (already have a reasonCode/note).
  if (!cand.feasibleStatically) {
    return { reasonCode: cand.reasonCode, note: cand.note };
  }
  // The winning items on this slot's day, EXCLUDING the owning clinic's own
  // winning slot (replacing one of its slots with another is still one visit).
  const placed = placedItemsByDate(winningChosen, anchorsByDate);
  const dayItemsAll = placed.get(cand.date) || [];
  const dayItemsOthers = dayItemsAll.filter(
    (it) => !(!it.isAnchor && it._order === ownerOrder)
  );

  // Would adding this slot push the day over maxVisitsPerDay? Count only OTHER
  // clinics' visits on that day (anchors never count).
  const otherClinicCount = dayItemsOthers.filter((it) => !it.isAnchor).length;
  if (otherClinicCount + 1 > prefs.maxVisitsPerDay) {
    return {
      reasonCode: "max_per_day_reached",
      note:
        cand.date +
        " already holds " +
        otherClinicCount +
        " other clinic visit(s) (maxVisitsPerDay=" +
        prefs.maxVisitsPerDay +
        "); adding this would exceed it",
    };
  }
  // Otherwise check the collision rule with this slot inserted into the day
  // (alongside the other winning items), validated as a whole arrangement.
  const items = dayItemsOthers
    .map((it) => ({
      startMin: it.startMin,
      endMin: it.endMin,
      lat: it.lat,
      lng: it.lng,
      facilityName: it.facilityName,
      isAnchor: it.isAnchor,
    }))
    .concat([
      {
        startMin: cand.startMin,
        endMin: cand.endMin,
        lat: cand.clinic.lat,
        lng: cand.clinic.lng,
        facilityName: cand.clinic.facilityName,
        isAnchor: false,
      },
    ]);
  const res = validateDayArrangement(items, prefs);
  if (!res.ok) return { reasonCode: res.reasonCode, note: res.note };
  // Statically feasible AND fits the winning placement, yet not chosen: the
  // exhaustive optimizer found a strictly better global combo. This slot is a
  // feasible alternative, NOT a conflict, so it carries no conflict reasonCode.
  return {
    reasonCode: null,
    note:
      "this slot is feasible on its own, but the chosen slot scored better for the overall week",
    _displaced: true,
  };
}

// Per-leg buffers for an accepted clinic at its chosen slot: home->clinic,
// clinic->each adjacent placed item, clinic->home (when first/last of day).
function buildLegBuffers(chosenCand, winningChosen, anchorsByDate, prefs) {
  const legs = [];
  const home = prefs.homeBase;
  const clinicName = chosenCand.clinic.facilityName;
  const clinicPt = { lat: chosenCand.clinic.lat, lng: chosenCand.clinic.lng };

  // Items on the same day (anchors + other chosen clinics), sorted.
  const placed = placedItemsByDate(winningChosen, anchorsByDate).get(chosenCand.date) || [];
  const sameDay = placed
    .filter(
      (it) =>
        !(
          !it.isAnchor &&
          it._order === chosenCand.clinic._order &&
          it.startMin === chosenCand.startMin
        )
    )
    .slice()
    .sort((a, b) => a.startMin - b.startMin);

  const earlier = sameDay.filter((it) => it.endMin <= chosenCand.startMin);
  const later = sameDay.filter((it) => it.startMin >= chosenCand.endMin);

  if (earlier.length === 0) {
    // first of day: home -> clinic
    legs.push(legBuffer("homeBase", home, clinicName, clinicPt));
  } else {
    const prev = earlier[earlier.length - 1];
    const prevPt = hasCoords(prev) ? { lat: prev.lat, lng: prev.lng } : null;
    legs.push(legBuffer(prev.facilityName, prevPt, clinicName, clinicPt));
  }
  if (later.length === 0) {
    // last of day: clinic -> home
    legs.push(legBuffer(clinicName, clinicPt, "homeBase", home));
  } else {
    const next = later[0];
    const nextPt = hasCoords(next) ? { lat: next.lat, lng: next.lng } : null;
    legs.push(legBuffer(clinicName, clinicPt, next.facilityName, nextPt));
  }
  return legs;
}

// Map a conflictStatus -> the assumption IDs it applied.
function assumptionsFor(conflictStatus, clinic) {
  const ids = [ASSUMPTION_IDS.ist, ASSUMPTION_IDS.duration, ASSUMPTION_IDS.hours];
  // Buffer assumption applies whenever travel math could matter (known coords).
  if (hasCoords(clinic)) ids.push(ASSUMPTION_IDS.buffer);
  if (
    conflictStatus === "clear" ||
    conflictStatus === "past_back_by" ||
    conflictStatus === "buffer_violation"
  ) {
    ids.push(ASSUMPTION_IDS.backBy);
  }
  return ids;
}

// Find any anchor that constrains a chosen clinic on its day (adjacent in time).
function anchorImpactFor(chosenCand, anchorsByDate) {
  const anchors = anchorsByDate.get(chosenCand.date) || [];
  if (anchors.length === 0) return null;
  // The nearest anchor by time gap.
  let nearest = null;
  let nearestGap = Infinity;
  for (const a of anchors) {
    const gap =
      a.startMin >= chosenCand.endMin
        ? a.startMin - chosenCand.endMin
        : chosenCand.startMin >= a.endMin
        ? chosenCand.startMin - a.endMin
        : 0;
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = a;
    }
  }
  if (!nearest) return null;
  return {
    affectedByAnchor: nearest.id,
    note:
      "scheduled around " +
      nearest.facilityName +
      " at " +
      minToHHMM(nearest.startMin) +
      (hasCoords(nearest) ? " (+ travel buffer)" : " (time-only block)"),
  };
}

// Bug #4: for a needs_new_times clinic, find an anchor that DIRECTLY blocked one
// of its statically-feasible slots (overlap or travel-buffer violation), so the
// ledger's anchorImpact is populated instead of always null. Returns null when
// no anchor was the cause (e.g. window/back-by/max-per-day rejections).
function anchorImpactForRejected(clinic, cands, anchorsByDate, prefs) {
  const clinicPt = hasCoords(clinic) ? { lat: clinic.lat, lng: clinic.lng } : null;
  for (const cd of cands) {
    if (!cd.feasibleStatically) continue;
    const anchors = anchorsByDate.get(cd.date) || [];
    for (const a of anchors) {
      // Direct time overlap?
      const overlaps = cd.startMin < a.endMin && cd.endMin > a.startMin;
      if (overlaps) {
        return {
          affectedByAnchor: a.id,
          note:
            "the offered slot at " +
            minToHHMM(cd.startMin) +
            " overlaps " +
            a.facilityName +
            " (" +
            minToHHMM(a.startMin) +
            "-" +
            minToHHMM(a.endMin) +
            ")",
        };
      }
      // Travel-buffer violation against the anchor?
      const aPt = hasCoords(a) ? { lat: a.lat, lng: a.lng } : null;
      if (a.endMin <= cd.startMin) {
        const buf = bufMinutes(aPt, clinicPt);
        if (cd.startMin < a.endMin + buf) {
          return {
            affectedByAnchor: a.id,
            note:
              "the offered slot needs a " +
              buf +
              " min travel buffer after " +
              a.facilityName +
              "; the gap is too short",
          };
        }
      } else if (cd.endMin <= a.startMin) {
        const buf = bufMinutes(clinicPt, aPt);
        if (cd.endMin + buf > a.startMin) {
          return {
            affectedByAnchor: a.id,
            note:
              "the offered slot needs a " +
              buf +
              " min travel buffer before " +
              a.facilityName +
              "; the gap is too short",
          };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// MAIN ENTRY: buildSchedule(inputs) -> { proposals, assumptions }.
// ---------------------------------------------------------------------------
export function buildSchedule(inputs) {
  const raw = inputs || {};
  const prefs = normalizePrefs(raw.prefs);
  const anchors = normalizeAnchors(raw.fixedAnchors, prefs);
  const clinics = normalizeClinics(raw.clinicReplies);

  // Anchors grouped by date (only dates within the window matter for placement,
  // but we keep all so anchor impact narration is faithful).
  const anchorsByDate = new Map();
  for (const a of anchors) {
    if (!anchorsByDate.has(a.date)) anchorsByDate.set(a.date, []);
    anchorsByDate.get(a.date).push(a);
  }

  // Candidates per clinic.
  const candidatesByClinic = new Map();
  for (const clinic of clinics) {
    candidatesByClinic.set(clinic._order, buildCandidates(clinic, prefs));
  }

  // Exhaustive selection.
  const best = selectBestCombination(clinics, candidatesByClinic, anchorsByDate, prefs);
  const winningChosen = best.chosen;

  // Map: clinic._order -> its chosen candidate (if accepted).
  const chosenByClinic = new Map();
  for (const c of winningChosen) chosenByClinic.set(c.clinic._order, c);

  // Build one proposal per clinic.
  const proposals = clinics.map((clinic) => {
    const chosen = chosenByClinic.get(clinic._order) || null;
    const cands = candidatesByClinic.get(clinic._order) || [];
    const hasAnySlot = clinic.proposedTimes.length > 0;

    if (chosen) {
      // ACCEPTED.
      const legBuffers = buildLegBuffers(chosen, winningChosen, anchorsByDate, prefs);
      const consideredSlots = cands.map((cd) => {
        if (cd.slotIndex === chosen.slotIndex) {
          return {
            label: cd.label,
            feasible: true,
            outcome: "chosen",
            note:
              "fits" +
              (prefs.timeOfDayPref !== "any"
                ? prefMatchNote(chosen, prefs)
                : "") +
              "; placed at " +
              chosen.slot.time,
          };
        }
        // A non-chosen slot for an accepted clinic. Exclude this clinic's own
        // chosen slot from the day so it isn't counted against itself.
        const probe = probeRejectedSlot(cd, winningChosen, anchorsByDate, prefs, clinic._order);
        return {
          label: cd.label,
          feasible: cd.feasibleStatically && probe._displaced === true,
          outcome: "not_chosen",
          reasonCode: probe.reasonCode,
          note:
            probe._displaced === true
              ? "feasible alternative; the chosen slot scored better"
              : probe.note,
        };
      });
      const conflictStatus = "clear";
      const ledger = {
        facilityId: clinic.facilityId,
        facilityName: clinic.facilityName,
        verdict: "accepted",
        conflictStatus,
        chosenSlot: {
          date: chosen.slot.date,
          time: chosen.slot.time,
          endTime: minToHHMM(chosen.endMin),
          label: chosen.label,
        },
        consideredSlots,
        legBuffers,
        anchorImpact: anchorImpactFor(chosen, anchorsByDate),
        assumptionApplied: assumptionsFor(conflictStatus, clinic),
        reason:
          "Scheduled: best fit among the clinic's proposed slots, no conflicts after travel buffers.",
      };
      return {
        id: proposalId(clinic, chosen),
        facilityId: clinic.facilityId,
        facilityName: clinic.facilityName,
        requestId: clinic.requestId,
        verdict: "accepted",
        slot: { date: chosen.slot.date, time: chosen.slot.time, label: chosen.label },
        endTime: minToHHMM(chosen.endMin),
        purpose: "Specialist visit - " + clinic.facilityName,
        approvalStatus: "doctor_approval_required",
        approved: false,
        ledger,
      };
    }

    // NEEDS NEW TIMES.
    if (!hasAnySlot) {
      const ledger = {
        facilityId: clinic.facilityId,
        facilityName: clinic.facilityName,
        verdict: "needs_new_times",
        conflictStatus: "no_slots_offered",
        chosenSlot: null,
        consideredSlots: [],
        legBuffers: clinicHomeLegs(clinic, prefs),
        anchorImpact: null,
        assumptionApplied: assumptionsFor("no_slots_offered", clinic),
        reason:
          "Needs new times: the clinic replied without proposing any specific slot.",
      };
      return makeRejectedProposal(clinic, ledger);
    }

    // Probe each slot to determine fate + dominant reason. (This clinic is NOT
    // in the winning combination, so it owns no winning slot to exclude.)
    const consideredSlots = cands.map((cd) => {
      const probe = probeRejectedSlot(cd, winningChosen, anchorsByDate, prefs, clinic._order);
      return {
        label: cd.label,
        feasible: false,
        outcome: "rejected",
        reasonCode: probe.reasonCode,
        note: probe.note,
      };
    });
    // Dominant reason = the highest-severity reasonCode across slots.
    let dominant = "overlap";
    let dominantSeverity = -1;
    for (const s of consideredSlots) {
      const sev = REASON_SEVERITY[s.reasonCode] != null ? REASON_SEVERITY[s.reasonCode] : 0;
      if (sev > dominantSeverity) {
        dominantSeverity = sev;
        dominant = s.reasonCode;
      }
    }
    const ledger = {
      facilityId: clinic.facilityId,
      facilityName: clinic.facilityName,
      verdict: "needs_new_times",
      conflictStatus: dominant,
      chosenSlot: null,
      consideredSlots,
      legBuffers: clinicHomeLegs(clinic, prefs),
      // Bug #4: surface the anchor when an anchor is what blocked every slot.
      anchorImpact: anchorImpactForRejected(clinic, cands, anchorsByDate, prefs),
      assumptionApplied: assumptionsFor(dominant, clinic),
      reason: reasonProse(dominant, clinic),
    };
    return makeRejectedProposal(clinic, ledger);
  });

  return { proposals, assumptions: ASSUMPTIONS.slice() };
}

// A small, deterministic per-leg buffer list for needs_new_times clinics:
// home->clinic and clinic->home (so the card still shows concrete bands, or
// "travel not checked" for unknown-location clinics).
function clinicHomeLegs(clinic, prefs) {
  const clinicPt = hasCoords(clinic) ? { lat: clinic.lat, lng: clinic.lng } : null;
  return [
    legBuffer("homeBase", prefs.homeBase, clinic.facilityName, clinicPt),
    legBuffer(clinic.facilityName, clinicPt, "homeBase", prefs.homeBase),
  ];
}

function makeRejectedProposal(clinic, ledger) {
  return {
    id: proposalId(clinic, null),
    facilityId: clinic.facilityId,
    facilityName: clinic.facilityName,
    requestId: clinic.requestId,
    verdict: "needs_new_times",
    slot: null,
    endTime: null,
    purpose: "Specialist visit - " + clinic.facilityName,
    approvalStatus: "doctor_approval_required",
    approved: false,
    ledger,
  };
}

// Deterministic temp id (re-minted on approval in the app). No randomness.
function proposalId(clinic, chosen) {
  const base = "prop-" + (clinic.requestId != null ? clinic.requestId : clinic._order);
  if (chosen) return base + "-" + chosen.slot.date + "-" + chosen.slot.time;
  return base + "-nnt";
}

function prefMatchNote(chosen, prefs) {
  const isMorning = chosen.startMin < NOON_MIN;
  if (prefs.timeOfDayPref === "morning" && isMorning) return " the morning preference";
  if (prefs.timeOfDayPref === "afternoon" && !isMorning) return " the afternoon preference";
  return "";
}

function reasonProse(reasonCode, clinic) {
  switch (reasonCode) {
    case "no_slots_offered":
      return "Needs new times: the clinic replied without proposing any specific slot.";
    case "outside_window":
      return "Needs new times: every proposed slot falls outside the planning window or working hours.";
    case "past_back_by":
      return "Needs new times: every proposed slot ends too late to get home by the back-by time (return buffer included).";
    case "max_per_day_reached":
      return "Needs new times: fitting this clinic would exceed the max visits per day or displace a higher-value combination.";
    case "overlap":
      return "Needs new times: every proposed slot overlaps an existing commitment or another visit.";
    case "buffer_violation":
      return "Needs new times: every proposed slot collides once the straight-line travel buffer is applied.";
    default:
      return "Needs new times: no proposed slot could be fit.";
  }
}

// ---------------------------------------------------------------------------
// buildTemplateNarrative(facts) -> { daySummaries, tradeoffSummary }.
// Pure JS, no network. Summarizes engine-decided facts ONLY. `facts` is the
// buildSchedule output (or { proposals, assumptions }).
// ---------------------------------------------------------------------------
export function buildTemplateNarrative(facts) {
  const proposals = (facts && Array.isArray(facts.proposals)) ? facts.proposals : [];
  const accepted = proposals.filter((p) => p.verdict === "accepted");
  const needs = proposals.filter((p) => p.verdict === "needs_new_times");

  // Group accepted by date.
  const byDate = new Map();
  for (const p of accepted) {
    const d = p.slot.date;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(p);
  }
  // Stable date order.
  const dates = Array.from(byDate.keys()).sort();
  const daySummaries = dates.map((date) => {
    const items = byDate
      .get(date)
      .slice()
      .sort((a, b) => hhmmToMin(a.slot.time) - hhmmToMin(b.slot.time));
    const parts = items.map(
      (p) => p.facilityName + " at " + p.slot.time + "-" + p.endTime
    );
    return {
      date,
      visitCount: items.length,
      summary:
        date +
        ": " +
        (parts.length === 1
          ? parts[0]
          : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]) +
        ".",
    };
  });

  let tradeoffSummary;
  if (accepted.length === 0 && needs.length === 0) {
    tradeoffSummary = "No clinics replied yet, so there is nothing to schedule.";
  } else if (accepted.length === 0) {
    tradeoffSummary =
      "None of the " +
      needs.length +
      " replied clinic(s) could be fit into this week from the slots they proposed - each needs new times. " +
      KILLER_LINE;
  } else {
    tradeoffSummary =
      "Scheduled " +
      accepted.length +
      " visit(s) across " +
      daySummaries.length +
      " day(s) from the clinics' own proposed slots" +
      (needs.length > 0
        ? "; " + needs.length + " clinic(s) need new times (see the Constraint Ledger). "
        : ". ") +
      KILLER_LINE;
  }

  return { daySummaries, tradeoffSummary };
}
