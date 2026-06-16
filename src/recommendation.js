// Thin reader/filter over the bundled, PRE-RANKED recommender slices
// (integration-spec §5, onboarding §3). The app does ZERO ranking — recommend.py
// is the single ranking brain. This module only filters/looks up by specialty,
// state, and districtKey. No sort by demand columns ever happens here.
import slice from "../public/gold/demand_supply_slice.json";
import facilitiesSlice from "../public/gold/facilities_slice.json";
import districtCards from "../public/gold/district_cards.json";

export const sliceMeta = slice.meta;

// Signal badge per canonical specialty, computed once from the pre-ranked slice
// (onboarding §1 Step-1): "high" = demand-bearing with >=1 critical/high district;
// "best_available" = demand-bearing but only moderate/low (pulmonology, neonatology);
// "none" = one of the 93 no-signal specialties (honest refusal).
const SIGNAL = (() => {
  const map = {};
  for (const [specialty, districts] of Object.entries(slice.demandBearing || {})) {
    const hasCritHigh = districts.some((d) => d.priority_tier === "critical" || d.priority_tier === "high");
    map[specialty] = hasCritHigh ? "high" : "best_available";
  }
  for (const specialty of slice.noSignal || []) map[specialty] = "none";
  return map;
})();

export function signalFor(specialtyCanonical) {
  return SIGNAL[specialtyCanonical] || "none";
}

// The first recommendation. status: 'ok' | 'no_gap_signal'. Districts are already
// impact-ranked by recommend.py; we return them as-is (no re-sort).
export function recommendationFor(specialtyCanonical) {
  if (!specialtyCanonical) return { status: "no_gap_signal", districts: [] };
  if ((slice.noSignal || []).includes(specialtyCanonical)) {
    return { status: "no_gap_signal", districts: [] };
  }
  const districts = slice.demandBearing?.[specialtyCanonical] || [];
  return { status: districts.length ? "ok" : "no_gap_signal", districts };
}

// Narrows the national top-N to chosen states — NOT a re-rank (the slice is the
// national top-N). If the state has no district in the slice, keep the national
// list and let the UI show an honest note (onboarding §3 state-filter edge).
export function applyStateFilter(districts, preferredStatesNorm = []) {
  if (!preferredStatesNorm || !preferredStatesNorm.length) return districts;
  const inState = districts.filter((d) => preferredStatesNorm.includes(d.state_ut_norm));
  return inState.length ? inState : districts;
}

// Host clinics for a district from the canonical facility slice, filtered by
// districtKey (the pre-baked order is kept; optional client-side facility filters
// never change the district need score). onboarding §3.
export function facilitiesForDistrict(districtKey, prefs = {}) {
  return facilitiesSlice
    .filter((f) => f.districtKey === districtKey)
    .filter((f) => !prefs.facilityComplexityTiers?.length || prefs.facilityComplexityTiers.includes(f.complexityTier))
    .filter((f) => !prefs.ownershipSectorFinal?.length || prefs.ownershipSectorFinal.includes(f.ownership))
    .filter((f) => !prefs.publicHealthOnly || f.isPublic === true)
    .filter((f) => !prefs.requireSpecialistEvidence || f.hasSpecialistEvidence === true);
}

// District-context block from gold_district_card (bundled). May be undefined for
// a district with no card — the UI renders the block only when present.
export function districtContext(districtKey) {
  return districtCards[districtKey] || null;
}

// The controlled set of states present in the bundled slice (for the "Add my
// state" chip). Title-Case state_ut_norm values.
export const bundledStates = (() => {
  const set = new Set();
  for (const districts of Object.values(slice.demandBearing || {})) {
    for (const d of districts) if (d.state_ut_norm) set.add(d.state_ut_norm);
  }
  return Array.from(set).sort();
})();
