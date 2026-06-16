"""
Specialist Placement Recommender (SPR)
======================================
"A specialist just signed up. Where should they go to do the most good?"

Given a specialist's clinical specialty and their onboarding preferences
(which states they'd work in, public vs private, how many options to see),
recommend the top 3-5 DISTRICTS where that specialist closes the biggest
health-need gap -- and name candidate clinics inside each district.

Core idea (simple + transparent):
  * The gold table `gold_demand_supply_gap_v2` already scores, for every
    (district, specialty), how much health need is NOT covered by existing
    specialist supply -> column `unmet_demand` (max when supply is zero).
  * A specialist's IMPACT in a district = that unmet_demand. Higher = more good.
  * PREFERENCES define the FEASIBLE SET (a hard filter). WITHIN that set we
    rank by impact and return the best. If the doctor's preferences box them
    out of the very biggest gaps, we still give them the best feasible option
    AND transparently flag the higher-impact gaps they're passing up.

This module is pure standard-library Python (no pandas/installs) so it runs
anywhere: `python recommend.py --demo`. Data is read from local CSV snapshots
of the gold tables in ./data (swap `load_*` for a live SQL query in prod).
"""
from __future__ import annotations
import argparse, csv, json, os, re, sys
from dataclasses import dataclass, field, asdict

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# ---------------------------------------------------------------------------
# Specialty + state vocabulary
# ---------------------------------------------------------------------------
# Human-friendly specialty names -> canonical specialty in the gold table.
# Only the 17 NFHS-need-driven specialties below carry a demand/gap signal;
# everything else has no need-based gap to recommend on (handled gracefully).
SPECIALTY_ALIASES = {
    "pediatrician": "pediatrics", "paediatrician": "pediatrics",
    "child specialist": "pediatrics", "pediatrics": "pediatrics",
    "ob-gyn": "obstetrics_gynecology", "obgyn": "obstetrics_gynecology",
    "ob gyn": "obstetrics_gynecology",
    "obstetrician": "obstetrics_gynecology", "gynecologist": "obstetrics_gynecology",
    "obstetrician_gynecologist": "obstetrics_gynecology",
    "obstetrician gynecologist": "obstetrics_gynecology",
    "obstetrics gynecology": "obstetrics_gynecology",
    "obstetrics and gynecology": "obstetrics_gynecology",
    "obstetrics & gynecology": "obstetrics_gynecology",
    "obstetrics_gynecology": "obstetrics_gynecology",
    "cardiologist": "cardiology", "cardiology": "cardiology",
    "psychiatrist": "psychiatry", "psychiatry": "psychiatry",
    "nutritionist": "nutrition_dietetics", "dietitian": "nutrition_dietetics",
    "nutrition_dietetics": "nutrition_dietetics",
    "physician": "internal_medicine", "internist": "internal_medicine",
    "internal medicine": "internal_medicine", "internal_medicine": "internal_medicine",
    "preventive medicine": "preventive_medicine", "public health": "preventive_medicine",
    "preventive_medicine": "preventive_medicine",
    "endocrinologist": "endocrinology_diabetes", "diabetologist": "endocrinology_diabetes",
    "endocrinology_diabetes": "endocrinology_diabetes",
    "oncologist": "medical_oncology", "medical_oncology": "medical_oncology",
    "gynecologic_oncology": "gynecologic_oncology",
    "neonatologist": "neonatology", "neonatology": "neonatology",
    "pulmonologist": "pulmonology", "pulmonology": "pulmonology",
    "addiction medicine": "addiction_medicine", "addiction_medicine": "addiction_medicine",
    "adolescent medicine": "adolescent_medicine", "adolescent_medicine": "adolescent_medicine",
    "family planning": "family_planning_contraception",
    "family_planning_contraception": "family_planning_contraception",
    "maternal child health": "maternal_child_health", "maternal_child_health": "maternal_child_health",
    "pediatric emergency": "pediatric_emergency_medicine",
    "pediatric_emergency_medicine": "pediatric_emergency_medicine",
}

# Common state nicknames -> the gold table's state_ut_norm spelling.
STATE_ALIASES = {
    "up": "Uttar Pradesh", "uttar pradesh": "Uttar Pradesh",
    "mp": "Madhya Pradesh", "madhya pradesh": "Madhya Pradesh",
    "ap": "Andhra Pradesh", "andhra pradesh": "Andhra Pradesh",
    "ka": "Karnataka", "karnataka": "Karnataka",
    "kl": "Kerala", "kerala": "Kerala",
    "tg": "Telangana", "ts": "Telangana", "telangana": "Telangana",
    "tn": "Tamil Nadu", "tamil nadu": "Tamil Nadu",
    "wb": "West Bengal", "west bengal": "West Bengal",
    "j&k": "Jammu & Kashmir", "jammu and kashmir": "Jammu & Kashmir",
    "jk": "Jammu & Kashmir",
    "delhi": "Delhi", "nct of delhi": "Delhi",
    "a&n islands": "Andaman & Nicobar Islands",
    "andaman and nicobar": "Andaman & Nicobar Islands",
}

# PREFER-mode policy (rules only, no ML; impact stays dominant):
#   We DROPPED the old multiplicative soft-boost W_PREFER_STATE entirely -- a
#   tie-break multiplier can never overcome a 100-vs-73 impact gap, so it just
#   hid the tradeoff and surfaced 0 preferred options. Instead PREFER mode now
#   splits the answer into two clearly-labeled sections (see recommend()).
PREFER_SECTION_A_MIN = 2   # min preferred-state slots guaranteed in 'prefer' mode
OUTSIDE_FLAG_RATIO = 0.90  # in 'prefer' mode, fire the transparency note when the
                           # best PREFERRED-only impact index is below this fraction
                           # of the global best (computed from RAW impact, not boosted)
# NOTE: district ranking is PURE impact. The setting (public/private) preference is
# applied ONLY at the candidate-clinic layer (which hosts to name), never as a
# district-score tilt -- an earlier public tilt inverted impact order and perversely
# favored already-served districts (the highest-impact, zero-supply districts have
# n_public=0 by definition, so a public tilt would push them DOWN).

# ---------------------------------------------------------------------------
# Loading the gold snapshots (swap these for live SQL in production)
# ---------------------------------------------------------------------------
def _f(v):
    """parse a CSV cell to float or None ('null'/'' -> None)."""
    if v is None or v == "" or v == "null":
        return None
    try:
        return float(v)
    except ValueError:
        return None

def _b(v):
    return str(v).strip().lower() == "true"

def load_gap(path=None):
    """demand-bearing (district, specialty) gap rows from gold_demand_supply_gap_v2."""
    path = path or os.path.join(DATA_DIR, "gold_demand_supply_gap_v2.csv")
    rows = []
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            pwd = _f(r["pop_weighted_demand"])
            if pwd is None:
                continue  # supply-only row: no demand to recommend on
            rows.append({
                "district": r["district_name_norm"],
                "state": r["state_ut_norm"],
                "specialty": r["specialty_canonical"],
                "unmet_demand": _f(r["unmet_demand"]) or 0.0,
                "pop_weighted_demand": pwd,
                "n_facilities": int(_f(r["n_facilities"]) or 0),
                "n_public": int(_f(r["n_public"]) or 0),
                "specialty_absent": _b(r["specialty_absent"]),
                "is_thin_specialty": _b(r["is_thin_specialty"]),
                "score_basis": r["score_basis"],
                "priority_tier": r["priority_tier"],
                "driving_needs": [n for n in (r["driving_needs"] or "").split("|") if n],
            })
    return rows

def load_facilities(path=None):
    path = path or os.path.join(DATA_DIR, "gold_facility_enriched.csv")
    rows = []
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append({
                "facility_id": r["facility_id"],
                "name": r["facility_name"],
                "type": r["facility_type"],
                "is_public": _b(r["is_public_health_facility"]),
                # Carry the RAW ownership so we never render 'private' for a row that
                # is actually null/unknown. is_public_health_facility=false includes
                # both genuinely-private AND unknown-ownership rows, so it must NOT be
                # used as a private/public label by itself (only for the public gate).
                "ownership": _ownership(r["ownership_sector_final"]),
                "tier": r["facility_complexity_tier"],
                "beds": int(_f(r["bed_count"]) or 0),
                "doctors": int(_f(r["doctor_count"]) or 0),
                "district": r["nfhs_district_name_norm"],
                "state": r["nfhs_state_ut_norm"],
            })
    return rows

def _ownership(raw):
    """Map raw ownership_sector_final -> 'public' | 'private' | 'unknown'.

    The source has 4 values: government_public, private, trust_charitable, null.
    Only an explicit 'private' renders as private; government_public/trust map to
    public; null/blank/anything-else is 'unknown' (never silently called private)."""
    v = (raw or "").strip().lower()
    if v in ("", "null", "none", "unknown"):
        return "unknown"
    if v == "private":
        return "private"
    if v in ("government_public", "government", "public", "trust_charitable"):
        return "public"
    return "unknown"

def load_supply_map(path=None):
    """set of (facility_id, specialty) that already exist -> 'who already offers X'."""
    path = path or os.path.join(DATA_DIR, "fct_facility_specialty.csv")
    have = set()
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            have.add((r["facility_id"], r["specialty_canonical"]))
    return have

def build_live_supply_count(facilities, supply):
    """Reconciled CURRENT-SUPPLY count per (district, state, specialty).

    The gap table's `n_facilities` was derived from fct rows keyed on a raw,
    city-level `district_approx` that does NOT align with NFHS districts -- so
    quoting it as a live 'here now' facility count is misleading (e.g. it would
    show fct's per-city slice, not the district total). We instead recompute the
    count from real rows: distinct facilities in gold_facility_enriched (already
    keyed on NFHS district) that the fct supply set says offer this specialty.
    This is the honest, reproducible count the UI shows as 'here now'."""
    # Map each facility to its NFHS (district, state).
    fac_loc = {f["facility_id"]: (f["district"], f["state"]) for f in facilities}
    seen = {}  # (district, state, specialty) -> set of distinct facility_ids
    for (fid, specialty) in supply:
        loc = fac_loc.get(fid)
        if loc is None:
            continue  # supply row for a facility not in the enriched table
        seen.setdefault((loc[0], loc[1], specialty), set()).add(fid)
    return {key: len(ids) for key, ids in seen.items()}

# ---------------------------------------------------------------------------
# Preference profile
# ---------------------------------------------------------------------------
@dataclass
class Profile:
    specialty: str                       # human or canonical name
    preferred_states: list = field(default_factory=list)
    location_mode: str = "open"          # 'open' | 'prefer' | 'fixed'
    avoid_states: list = field(default_factory=list)
    setting: str = "any"                 # 'any' | 'public' | 'private'
    top_k: int = 5
    name: str = ""                       # optional label for demos

def _norm_state(s):
    s = (s or "").strip()
    return STATE_ALIASES.get(s.lower(), s)

def resolve_specialty(raw):
    key = (raw or "").strip().lower()
    return SPECIALTY_ALIASES.get(key, key.replace(" ", "_"))

# ---------------------------------------------------------------------------
# Credible clinical-host gate
# ---------------------------------------------------------------------------
# A "candidate host clinic" must be a place that could plausibly host a CLINICAL
# specialist (a general/multi-specialty hospital, nursing home, CHC/PHC, district/
# civil/general/medical-college hospital) -- NOT a single-specialty dental, eye,
# diagnostic, lab, optical, hearing, ayurved/homeo, IVF, dialysis, etc. facility.
#
# In THIS dataset facility_type is almost useless (5615 'hospital', 3782 'clinic',
# only 1 'nursing_home', no 'chc'/'phc' rows) and bed/doctor counts are ~all 0 and
# facility_complexity_tier is miscalibrated (~60% 'tertiary', incl. dental/labs).
# So the gate keys off is_public + facility_type in {hospital,nursing_home} + the
# facility NAME, and the disqualify list dominates (a single-specialty signal in the
# name drops the row even if it is literally called an "...Eye Hospital").

# Positive host-type signal in the facility NAME (works for clinic-typed PHCs etc.)
HOST_NAME = re.compile(
    r"\bhospital\b|medical college|medical sciences|institute of medical|"
    r"community health|\bchc\b|\bphc\b|primary health|district hospital|"
    r"civil hospital|general hospital|referral hospital|sub.?district|area health|"
    r"sadar hospital|rural hospital|urban health|maternity|nursing home|"
    r"health cent(?:re|er)",
    re.IGNORECASE,
)
# Facility types that qualify on their own (general clinical hosts).
HOST_FACILITY_TYPES = {"hospital", "nursing_home"}

# Single-specialty / diagnostic / non-allopathic signal -> DISQUALIFY. This is a
# HARD block: it overrides any positive signal above (incl. the word "hospital"
# and is_public). A single-specialty eye/dental/IVF hospital genuinely cannot host
# a pediatrician or OB-GYN, so we do not exempt it just because it says "hospital".
NON_CLINICAL_HOST = re.compile(
    r"dental|dentist|orthodont|patholog|laborator|\blabs?\b|diagnostic|"
    r"collection cent(?:re|er)|optical|hearing|physiotherap|chiropract|"
    r"homoeopath|homeopath|\bhomeo\b|\bayurved|unani|siddha|naturopath|nature ?cure|vaidya|dispensar|"
    r"imaging|\bscan\b|\bx[\- ]?ray\b|eye care|eye clinic|eye hospital|"
    r"eye speciality|eye specialty|\bskin\b|dermat|cosmet|laser|\bent\b|"
    r"\bivf\b|fertilit|dialysis|blood bank|medical store|elder care|home health|"
    r"\bpiles\b|pharmac|farmac|chemist|veterinary|rehabilitation|"
    r"early intervention|de.?addiction|slimming|weight loss|hair\b",
    re.IGNORECASE,
)

# Strength ranking of the host name (district/civil/govt/medical-college > generic).
STRONG_HOST_NAME = re.compile(
    r"all india institute|medical college|medical sciences|institute of medical|"
    r"district hospital|civil hospital|general hospital|government|govt\b|"
    r"sadar hospital|referral hospital|community health|primary health|"
    r"\bchc\b|\bphc\b|rural hospital|sub.?district",
    re.IGNORECASE,
)

def _facility_type_key(raw):
    return " ".join((raw or "").strip().lower().replace("_", " ").replace("-", " ").split()).replace(" ", "_")

def credible_host_filter(f):
    """True iff `f` can plausibly host a (different) clinical specialist."""
    name = f.get("name") or ""
    # HARD disqualify first -- a single-specialty/diagnostic name is never a host.
    if NON_CLINICAL_HOST.search(name):
        return False
    ftype = _facility_type_key(f.get("type"))
    return bool(
        f.get("is_public")
        or ftype in HOST_FACILITY_TYPES
        or HOST_NAME.search(name)
    )

def _host_strength(f):
    """Higher = more credible/general host. Used only to ORDER survivors."""
    name = f.get("name") or ""
    ftype = _facility_type_key(f.get("type"))
    return (
        1 if f.get("is_public") else 0,             # public first (district/CHC/PHC)
        1 if STRONG_HOST_NAME.search(name) else 0,  # named district/civil/college
        1 if ftype == "hospital" else 0,            # general hospital over clinic
    )

def _impact_index(unmet_demand, max_for_specialty):
    if not max_for_specialty:
        return 0.0
    return max(0.0, min(100.0, (unmet_demand / max_for_specialty) * 100.0))

# ---------------------------------------------------------------------------
# The recommender
# ---------------------------------------------------------------------------
def recommend(profile: Profile, gap=None, facilities=None, supply=None):
    gap = gap if gap is not None else load_gap()
    canonical = resolve_specialty(profile.specialty)

    pool = [
        g for g in gap
        if g["specialty"] == canonical and g.get("pop_weighted_demand") is not None
    ]
    if not pool:
        return {
            "specialist": profile.name, "specialty_input": profile.specialty,
            "specialty_canonical": canonical, "recommendations": [],
            "status": "no_gap_signal",
            "message": (f"'{profile.specialty}' has no NFHS need-based gap signal "
                        "(not one of the 17 need-driven specialties). No district "
                        "recommendation can be made from health-need gaps."),
        }

    # global best impact for this specialty (anywhere, ignoring preferences)
    global_max = max(g["unmet_demand"] for g in pool) or 1.0
    global_best = max(pool, key=lambda g: g["unmet_demand"])
    thin = any(g["is_thin_specialty"] for g in pool)

    pref = {_norm_state(s) for s in profile.preferred_states}
    avoid = {_norm_state(s) for s in profile.avoid_states}

    # 'fixed' means "ONLY these states" -- with no states it would silently behave
    # like 'open' (unconstrained national results), which is the opposite of what a
    # geographically-constrained doctor asked for. Make that contradiction explicit.
    if profile.location_mode == "fixed" and not pref:
        return {
            "specialist": profile.name, "specialty_input": profile.specialty,
            "specialty_canonical": canonical, "recommendations": [],
            "status": "no_feasible_district",
            "message": ("location_mode='fixed' requires at least one preferred_state, "
                        "but none were given -- no geographically-constrained result "
                        "can be produced. Provide states, or use location_mode='open'."),
        }

    # ---- hard constraints define the FEASIBLE SET --------------------------
    feasible = [g for g in pool if g["state"] not in avoid]
    if profile.location_mode == "fixed" and pref:
        feasible = [g for g in feasible if g["state"] in pref]

    note = None
    if not feasible:
        return {
            "specialist": profile.name, "specialty_input": profile.specialty,
            "specialty_canonical": canonical, "recommendations": [],
            "status": "no_feasible_district",
            "message": ("No district matched the stated location constraints for "
                        f"{canonical}. Relax 'preferred_states' or location_mode."),
        }

    # ---- score WITHIN the feasible set -------------------------------------
    # impact_index (0-100, within this specialty) is the ONLY ranking signal. The
    # setting preference is handled at the clinic layer, not here; in 'prefer' mode
    # the two-section policy below carries the location preference.
    scored = []
    for g in feasible:
        impact_index = _impact_index(g["unmet_demand"], global_max)
        # Pure-impact ranking: final == impact_index. setting shapes WHICH clinics we
        # name (see _candidate_clinics), never which DISTRICT outranks another.
        scored.append((impact_index, impact_index, g))

    scored.sort(key=lambda t: (-t[0], -t[2]["unmet_demand"], t[2]["district"]))
    ranked = [(overall_rank, final, impact_index, g)
              for overall_rank, (final, impact_index, g) in enumerate(scored, 1)]
    top_n = max(profile.top_k, 0)

    if profile.location_mode == "prefer" and pref:
        # TWO-SECTION policy. Section A = highest-impact districts WITHIN the
        # doctor's preferred states (no boost, true impact shown), guaranteeing
        # they always see their stated preference represented. Section B = the
        # highest-impact options overall, to surface the max-impact gaps they
        # might be passing up. This honors the preference without ever letting a
        # tie-break multiplier silently bury a 100/100 gap.
        in_pref = [c for c in ranked if c[3]["state"] in pref]
        section_a_n = min(len(in_pref),
                          max(PREFER_SECTION_A_MIN, (top_n + 1) // 2))  # ceil(k/2)
        section_a = in_pref[:section_a_n]
        a_ids = {id(c) for c in section_a}
        section_b = [c for c in ranked if id(c) not in a_ids][:max(top_n - len(section_a), 0)]
        # Keep B in true impact order, then prepend the guaranteed preferred slots.
        chosen = section_a + section_b
        chosen_section = ({id(c): "A" for c in section_a}
                          | {id(c): "B" for c in section_b})
    else:
        chosen = ranked[:top_n]
        chosen_section = {}

    # ---- transparency: are we leaving big impact on the table? -------------
    # In 'prefer' mode compute the flag from the RAW preferred-only best (NOT a
    # boosted value), so it actually fires when the preferred region is materially
    # weaker than the global best. Name the specific district being passed up.
    if profile.location_mode == "prefer" and pref:
        in_pref_rows = [c for c in ranked if c[3]["state"] in pref]
        global_best_ii = ranked[0][2] if ranked else 0.0
        if not in_pref_rows:
            # No preferred state has a need-gap for this specialty -> Section A is
            # EMPTY. Say so honestly instead of claiming the preference was honored.
            note = (f"None of your preferred states ({', '.join(sorted(pref))}) have a "
                    f"recorded {canonical} need-gap, so every option below is a "
                    "highest-impact district nationally. Consider widening your "
                    "preferred locations.")
        else:
            # Fire whenever the best PREFERRED option is materially weaker than the
            # global best. We name the gap explicitly even if Section B already shows
            # it, so the tradeoff is always stated, never just implied.
            pref_best = max(c[2] for c in in_pref_rows)
            if pref_best < OUTSIDE_FLAG_RATIO * global_best_ii:
                note = (f"Your preferred states are honored above (Section A). Note: the "
                        f"highest-impact {canonical} gap is {global_best['district']}, "
                        f"{global_best['state']} at {round(_impact_index(global_best['unmet_demand'], global_max))}/100 "
                        f"(vs {round(pref_best)}/100 best in your preferred states) -- "
                        "consider widening your locations if you're open to it.")

    facilities = facilities if facilities is not None else load_facilities()
    supply = supply if supply is not None else load_supply_map()
    # Reconciled current-supply count (distinct facilities offering the specialty in
    # the NFHS district), used instead of the gap table's raw n_facilities so the
    # 'here now' number is derived from real facility rows, not a city-level proxy.
    live_supply = build_live_supply_count(facilities, supply)

    recs = []
    # In two-section ('prefer') mode the single `recommendations` array is NOT a
    # globally-monotone impact ranking: Section A (the doctor's preferred region)
    # is intentionally pinned ahead of Section B (the highest-impact options
    # overall), so a Section B item can have strictly higher raw impact than the
    # Section A items above it. To make that explicit and avoid a misleading
    # global `rank`, we expose:
    #   * group_order  -> 1 for Section A, 2 for Section B (display ordering)
    #   * section_rank -> rank WITHIN that section (monotone by impact, per section)
    #   * rank         -> the section-local rank (same as section_rank); it is NOT
    #                     a global impact rank in prefer mode
    #   * overall_rank -> true global impact position (always monotone by impact)
    # Consumers that want a single strictly-impact-ordered list should sort by
    # `overall_rank` (or `impact_index`); the array order here is display order.
    section_counter = {}
    for c in chosen:
        overall_rank, final, ii, g = c
        sec = chosen_section.get(id(c)) if chosen_section else None
        group_order = 1 if sec in (None, "A") else 2
        section_counter[group_order] = section_counter.get(group_order, 0) + 1
        section_rank = section_counter[group_order]
        rank_note = ""
        if chosen_section:  # 'prefer' mode two-section labeling
            if sec == "A":
                rank_note = (f"[Your preferred region - #{section_rank} in your "
                             f"states; impact {round(ii)}/100, rank #{overall_rank} overall]")
            else:
                rank_note = (f"[Highest-impact overall - #{section_rank} nationally, "
                             f"rank #{overall_rank}; consider widening]")
        recs.append({
            "rank": section_rank,
            "section_rank": section_rank,
            "group_order": group_order,
            "overall_rank": overall_rank,
            "section": sec,
            "rank_note": rank_note,
            "district": g["district"], "state": g["state"],
            "impact_index": round(ii),                       # 0-100, within specialty
            "unmet_demand": round(g["unmet_demand"], 2),
            "priority_tier": g["priority_tier"],             # global severity badge
            # Reconciled live count (distinct facilities offering this specialty in
            # the NFHS district); falls back to the gap proxy only if absent.
            "current_supply": live_supply.get(
                (g["district"], g["state"], canonical), g["n_facilities"]),
            "gap_table_supply_proxy": g["n_facilities"],     # raw gap-table column, for audit
            "specialty_absent": g["specialty_absent"],
            "driving_needs": g["driving_needs"][:6],         # the "why"
            "score_basis": ("need-driven (supply data sparse)"
                            if g["is_thin_specialty"] else "demand vs supply"),
            "in_preferred_state": g["state"] in pref,
            "candidate_clinics": _candidate_clinics(
                g["district"], g["state"], canonical, profile.setting,
                facilities, supply),
        })

    return {
        "specialist": profile.name, "specialty_input": profile.specialty,
        "specialty_canonical": canonical, "status": "ok",
        "is_thin_specialty": thin,
        "preferences": {
            "preferred_states": sorted(pref), "location_mode": profile.location_mode,
            "avoid_states": sorted(avoid), "setting": profile.setting, "top_k": profile.top_k,
        },
        "note": note,
        "recommendations": recs,
    }

def _candidate_clinics(district, state, specialty, setting, facilities, supply, limit=3):
    """Up to `limit` CREDIBLE clinical hosts in the district for this specialist.

    Gate: must pass credible_host_filter() (general clinical host, not a single-
    specialty dental/eye/diagnostic/lab/ayurved/etc. facility) and not already
    offer the specialty. We do NOT rank by facility_complexity_tier or bed/doctor
    counts (both unreliable in the data); we rank by _host_strength (public &
    named district/civil/college/CHC/PHC hospitals first). If nothing survives
    the gate, callers emit the honest greenfield string."""
    cands = [f for f in facilities if f["district"] == district and f["state"] == state]
    cands = [f for f in cands if credible_host_filter(f)]
    cands = [f for f in cands if (f["facility_id"], specialty) not in supply]
    if setting == "public":
        # STRICT: a public-setting doctor must only see public hosts. No fallback to
        # private -- if no public host survives, the caller emits greenfield.
        cands = [f for f in cands if f["is_public"]]
    elif setting == "private":
        # STRICT mirror: only explicitly-private hosts (unknown ownership does NOT
        # count as private, so it is excluded here rather than mislabeled).
        cands = [f for f in cands if f["ownership"] == "private"]

    cands.sort(key=_host_strength, reverse=True)
    return [{
        "facility": f["name"], "type": f["type"],
        "ownership": f["ownership"],          # 'public' | 'private' | 'unknown' (never guessed)
        "tier": f["tier"] or "unknown", "beds": f["beds"], "doctors": f["doctors"],
    } for f in cands[:limit]]

# ---------------------------------------------------------------------------
# Presentation + CLI
# ---------------------------------------------------------------------------
def render(result):
    out = []
    who = result.get("specialist") or result["specialty_input"]
    out.append(f"\n=== Recommendations for {who} "
               f"({result['specialty_canonical']}) ===")
    if result["status"] != "ok":
        out.append(f"  [{result['status']}] {result.get('message','')}")
        return "\n".join(out)
    p = result["preferences"]
    out.append(f"  preferences: locations={p['preferred_states'] or 'open'} "
               f"mode={p['location_mode']} setting={p['setting']}")
    if result.get("note"):
        out.append(f"  ! {result['note']}")
    seen_group = None
    for r in result["recommendations"]:
        # Section header when the display group changes (prefer-mode two-section).
        group = r.get("group_order")
        sec = r.get("section")
        if sec and group != seen_group:
            if sec == "A":
                out.append("\n  -- Section A: best options in your preferred states --")
            else:
                out.append("\n  -- Section B: highest-impact options nationally (consider widening) --")
            seen_group = group
        absent = "NO specialist here today" if r["specialty_absent"] else f"{r['current_supply']} here now"
        rank_note = f"  {r['rank_note']}" if r.get("rank_note") else ""
        out.append(f"\n  #{r['rank']}  {r['district']}, {r['state']}   "
                   f"impact {r['impact_index']}/100  [{r['priority_tier']}]  ({absent})"
                   f"{rank_note}")
        out.append(f"      needs: {', '.join(r['driving_needs'])}")
        out.append(f"      basis: {r['score_basis']}")
        for c in r["candidate_clinics"]:
            out.append(f"      -> host: {c['facility']} ({c['ownership']}, {c['tier']}, "
                       f"{c['beds']} beds, {c['doctors']} drs)")
        if not r["candidate_clinics"]:
            if p["setting"] == "public":
                out.append("      -> host: greenfield (no suitable PUBLIC host facility in dataset)")
            elif p["setting"] == "private":
                out.append("      -> host: greenfield (no suitable private host facility in dataset)")
            else:
                out.append("      -> host: greenfield (no suitable host facility in dataset)")
    return "\n".join(out)

PERSONAS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "personas.json")

def load_personas():
    if not os.path.exists(PERSONAS_PATH):
        return []
    with open(PERSONAS_PATH) as fh:
        return [Profile(**p) for p in json.load(fh)]

class _JsonArgParser(argparse.ArgumentParser):
    """ArgumentParser that, when --json is present anywhere on the command line,
    emits a machine-readable JSON error object on stderr (instead of raw argparse
    text) and exits 2. This keeps `--json` callers always parsing a JSON payload,
    even when the CLI itself rejected the arguments."""

    def error(self, message):
        argv = sys.argv[1:]
        if "--json" in argv:
            payload = {
                "status": "cli_error",
                "error": message,
                "usage": self.format_usage().strip(),
                "hint": ("To exclude states use the 'avoid' location mode, e.g. "
                         "--mode avoid --states Maharashtra (equivalent to "
                         "--mode open --avoid Maharashtra)."),
            }
            sys.stderr.write(json.dumps(payload, indent=2) + "\n")
            self.exit(2)
        super().error(message)


def _build_argparser():
    ap = _JsonArgParser(description="Specialist Placement Recommender")
    # nargs='+' so unquoted multi-word values work: `--specialty plastic surgeon`
    # and `--states Karnataka,Tamil Nadu` collect every following token instead of
    # crashing on the trailing word ("surgeon"/"Nadu") as an unknown positional.
    # We re-join the tokens with spaces, then comma-split states ourselves.
    ap.add_argument("--specialty", nargs="+")
    ap.add_argument("--states", nargs="*", default=None,
                    help="comma-separated preferred states (multi-word names ok unquoted)")
    ap.add_argument("--mode", default="open", choices=["open", "prefer", "fixed", "avoid"],
                    help=("location handling: open=anywhere, prefer=soft (two-section), "
                          "fixed=hard filter to --states, avoid=exclude --states "
                          "(sugar for --mode open --avoid <states>)"))
    ap.add_argument("--setting", default="any", choices=["any", "public", "private"])
    ap.add_argument("--avoid", nargs="*", default=None)
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--demo", action="store_true", help="run all personas in personas.json")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    ap.add_argument("--selftest", action="store_true",
                    help="run built-in CLI/data regression checks and exit")
    return ap

def _profile_from_args(a):
    """Turn parsed args into a Profile. nargs='+' yields token lists; re-join then
    comma-split so both `--states Karnataka,"Tamil Nadu"` and the unquoted
    `--states Karnataka,Tamil Nadu` resolve to ['Karnataka', 'Tamil Nadu'], and
    `--specialty plastic surgeon` resolves to 'plastic surgeon'."""
    specialty = " ".join(a.specialty).strip()
    states_raw = " ".join(a.states) if a.states else ""
    avoid_raw = " ".join(a.avoid) if a.avoid else ""
    states = [s.strip() for s in states_raw.split(",") if s.strip()]
    avoid = [s.strip() for s in avoid_raw.split(",") if s.strip()]
    mode = a.mode
    if mode == "avoid":
        # 'avoid' is sugar: the states named in --states (and/or --avoid) are
        # EXCLUDED, and ranking is otherwise open. Fold --states into avoid_states
        # and run as an open-mode profile (no preferred states).
        avoid = sorted(set(avoid) | set(states))
        states = []
        mode = "open"
    return Profile(
        specialty=specialty,
        preferred_states=states,
        location_mode=mode, setting=a.setting,
        avoid_states=avoid,
        top_k=a.top_k,
    )

def _selftest():
    """Lightweight stdlib regression checks for the bugs fixed in this module.

    Returns the number of failures (0 = all green). Exercises the REAL CLI
    parsing path so it guards the exact crashes reported."""
    ap = _build_argparser()
    fails = []

    def check(name, cond):
        print(("  PASS " if cond else "  FAIL ") + name)
        if not cond:
            fails.append(name)

    # 1+2. Unquoted multi-word --states (Tamil Nadu) and --specialty (plastic surgeon)
    #      must parse without argparse raising 'unrecognized arguments'.
    a = ap.parse_args(["--specialty", "cardiologist",
                       "--states", "Karnataka,Tamil", "Nadu", "--mode", "prefer"])
    prof = _profile_from_args(a)
    check("unquoted '--states Karnataka,Tamil Nadu' -> ['Karnataka', 'Tamil Nadu']",
          prof.preferred_states == ["Karnataka", "Tamil Nadu"])

    a = ap.parse_args(["--specialty", "plastic", "surgeon"])
    prof = _profile_from_args(a)
    check("unquoted '--specialty plastic surgeon' -> 'plastic surgeon'",
          prof.specialty == "plastic surgeon")
    res = recommend(prof, load_gap(), load_facilities(), load_supply_map())
    check("plastic surgeon reaches no_gap_signal (no crash)",
          res["status"] == "no_gap_signal")

    gap, facilities, supply = load_gap(), load_facilities(), load_supply_map()

    # 3. setting='public' must never surface a private/unknown host.
    res = recommend(Profile(specialty="obgyn", preferred_states=["Kerala"],
                            location_mode="prefer", setting="public", top_k=5),
                    gap, facilities, supply)
    bad = [c["facility"] for r in res["recommendations"]
           for c in r["candidate_clinics"] if c["ownership"] != "public"]
    check("setting=public hosts are all public (no private/unknown leak)", not bad)

    # 4. null ownership must render as 'unknown', never 'private'.
    null_owned = {f["name"] for f in facilities if f["ownership"] == "unknown"}
    mislabeled = []
    for f in facilities:
        if f["name"] in ("JPS Children Hospital", "Bhavna Hospital", "Sarayu Childrens Hospital"):
            mislabeled.append((f["name"], f["ownership"]))
    check("known null-ownership facilities render 'unknown' (not 'private')",
          all(o == "unknown" for _, o in mislabeled) and len(mislabeled) > 0)

    # 5. 'here now' count is the reconciled live count, not the raw gap proxy when
    #    they could differ. For Wayanad/internal_medicine both equal 4 here, but the
    #    value must come from the facility-table reconciliation.
    live = build_live_supply_count(facilities, supply)
    check("Wayanad internal_medicine reconciled current_supply == 4",
          live.get(("Wayanad", "Kerala", "internal_medicine")) == 4)

    # 6. prefer-mode rank monotonicity: the flat `rank` must be section-local
    #    (monotone by impact WITHIN each group_order), never a global rank that a
    #    higher-impact Section B item violates. Also `overall_rank` must be a true
    #    global impact order, and Section A always comes before Section B.
    res = recommend(Profile(specialty="cardiologist",
                            preferred_states=["Karnataka", "Tamil Nadu"],
                            location_mode="prefer", top_k=5),
                    gap, facilities, supply)
    recs = res["recommendations"]
    by_group = {}
    for r in recs:
        by_group.setdefault(r["group_order"], []).append(r)
    mono_ok = all(
        all(grp[i]["impact_index"] >= grp[i + 1]["impact_index"]
            for i in range(len(grp) - 1))
        for grp in by_group.values()
    )
    check("prefer-mode rank is section-local & monotone by impact within each group",
          mono_ok and [r["rank"] for r in by_group.get(1, [])] == list(range(1, len(by_group.get(1, [])) + 1)))
    check("prefer-mode Section A (group_order=1) is displayed before Section B (2)",
          [r["group_order"] for r in recs] == sorted(r["group_order"] for r in recs))

    # 7. 'avoid' location mode: --mode avoid folds --states into avoid_states,
    #    runs open-mode, and never returns an avoided state.
    ap2 = _build_argparser()
    a = ap2.parse_args(["--specialty", "cardiologist", "--states", "Maharashtra",
                        "--mode", "avoid"])
    prof = _profile_from_args(a)
    check("--mode avoid folds --states into avoid_states (Maharashtra excluded)",
          prof.location_mode == "open" and prof.avoid_states == ["Maharashtra"]
          and prof.preferred_states == [])
    res = recommend(prof, gap, facilities, supply)
    check("--mode avoid never recommends an avoided state",
          res["status"] == "ok"
          and all(r["state"] != "Maharashtra" for r in res["recommendations"]))

    # 8. District ranking is PURE impact: setting='public' must NOT re-order
    #    districts (an earlier public tilt inverted impact, favoring served
    #    districts). Open-mode impact_index must be monotone non-increasing.
    res = recommend(Profile(specialty="psychiatry", location_mode="open",
                            setting="public", top_k=15), gap, facilities, supply)
    imp = [r["impact_index"] for r in res["recommendations"]]
    check("setting=public does not invert district impact order (pure-impact rank)",
          all(imp[i] >= imp[i + 1] for i in range(len(imp) - 1)))

    # 9. location_mode='fixed' with empty/bare --states must NOT silently fall back
    #    to national results -- returns no_feasible_district. Covers both the bare
    #    '--states' (nargs='*' -> []) and quoted-empty '--states ""' CLI paths.
    for argv in (["--specialty", "cardiologist", "--mode", "fixed", "--states"],
                 ["--specialty", "cardiologist", "--mode", "fixed", "--states", ""]):
        a = ap.parse_args(argv)
        res = recommend(_profile_from_args(a), gap, facilities, supply)
        check(f"fixed mode with empty states ({' '.join(argv[-2:])!r}) -> no_feasible_district",
              res["status"] == "no_feasible_district")

    print(f"\n{'ALL GREEN' if not fails else str(len(fails)) + ' FAILED'}: selftest")
    return len(fails)

def main(argv=None):
    ap = _build_argparser()
    a = ap.parse_args(argv)

    if a.selftest:
        sys.exit(1 if _selftest() else 0)

    gap, facilities, supply = load_gap(), load_facilities(), load_supply_map()

    if a.demo:
        results = []
        for prof in load_personas():
            res = recommend(prof, gap, facilities, supply)
            results.append(res)
            if not a.json:
                print(render(res))
        if a.json:
            print(json.dumps(results, indent=2))
        return

    if not a.specialty:
        ap.error("provide --specialty or --demo")
    prof = _profile_from_args(a)
    res = recommend(prof, gap, facilities, supply)
    print(json.dumps(res, indent=2) if a.json else render(res))

if __name__ == "__main__":
    main()
