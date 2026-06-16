# Recommender — Change Spec (become the app's single ranking brain + slice emitter)

**Status:** Build-ready change-delta. The recommender already exists, is Codex-hardened, and passes a 13-check selftest.
**Target:** `recommender/recommend.py` (pure-stdlib Python 3) and a new build step that emits the app's bundled JSON.
**Read first:** `2026-06-16-shiftlink-integration-spec.md` (the backbone). This spec implements its **§5** (single recommendation engine) and **§4.1** (facility slice SQL).
**Authority:** `recommend.py` is the **single source of truth** for district ranking. The onboarding spec's hand-written `rankDistricts`/`facilitiesForDistrict` JS ranker is **deleted**; the React app does **zero** ranking — it filters pre-ranked JSON this tool emits.

> **What does NOT change:** the ranking logic, the honesty behaviors (`no_gap_signal`, thin-specialty, greenfield), the credible-host gate, the `prefer` two-section policy, and the 13-check selftest all stay exactly as they are (`recommender/EVAL.md`). This spec only (a) adds a `--emit-slice` build command, (b) makes `_candidate_clinics` carry `facility_id`, and (c) locks the one sort tuple. Everything else is preserved.

---

## 1. Why these changes

Two implementations of "rank districts for a specialty" exist and disagree: `recommend.py` (17 demand-bearing specialties, `impact_index`, modes, credible hosts) and the onboarding spec's JS `rankDistricts` (110 specialties, `priority_tier`-first). Per integration-spec §5 we collapse to **one engine = `recommend.py`**, and have it **emit the bundled slice** the React app reads. This kills the drift, keeps the honesty guarantees in one audited place, and means the app cannot fabricate a ranking for a specialty that has no signal.

---

## 2. Change 1 — `_candidate_clinics` must emit `facility_id` (REQUIRED)

**Today** (`recommend.py` ~L531) each candidate clinic dict is:
```python
{ "facility": f["name"], "type": f["type"], "ownership": f["ownership"],
  "tier": f["tier"] or "unknown", "beds": f["beds"], "doctors": f["doctors"] }
```
It carries **no id**, so the React app cannot enrich the clinic with contacts/coords from `facilities_slice.json`. `load_facilities()` already keeps `facility_id` internally — just surface it.

**Change:** add `"facility_id": f["facility_id"]` as the first key:
```python
{ "facility_id": f["facility_id"],            # NEW — the join key into facilities_slice.json
  "facility": f["name"], "type": f["type"], "ownership": f["ownership"],
  "tier": f["tier"] or "unknown", "beds": f["beds"], "doctors": f["doctors"] }
```
`recommend.py` stays pure-stdlib and does **not** gain a contacts/coords table — the app does the enrichment by `facility_id`. *(Confirmed gap: `recommend.py:531` emits no id today — Codex.)*

---

## 3. Change 2 — lock the one sort tuple (impact_index DESC, then pop_weighted_demand DESC)

Integration-spec **D12 / §5.2**: rank by **`impact_index` DESC, tie-break `pop_weighted_demand` DESC**; `priority_tier` is a displayed badge, not a sort key. `recommend.py` already ranks by `impact_index` (pure-impact, after EVAL finding #9 removed tier/setting tilts). **Add `pop_weighted_demand` as the explicit secondary tie-break** in the sort key so ordering is deterministic and population-aware, and assert it in the selftest.

In `recommend()` the scored sort becomes (keep the existing district final tiebreak last):
```python
scored.sort(key=lambda t: (-t[0],                                   # impact_index DESC
                           -(t[2].get("pop_weighted_demand") or 0), # NEW tie-break
                           -t[2]["unmet_demand"],                    # existing
                           t[2]["district"]))                       # deterministic
```
Add `pop_weighted_demand` to the row loader (`load_gap`) if not already parsed. Do **not** introduce a `priority_tier`-first order — that re-creates the impact inversions EVAL #9 removed.

---

## 4. Change 3 — `--emit-slice`: produce the app's bundled JSON (NEW build command)

Add a CLI subcommand `python3 recommend.py --emit-slice [--out public/gold] [--top-n 20]` that writes three files the React app consumes (integration-spec §5.5). It must run **offline against the gold tables** (live SQL or a fresh export — NOT the reduced CSV snapshots in `recommender/data/`, which lack contacts/coords; see §5).

### 4.1 `demand_supply_slice.json`
The pre-ranked district lists the app filters by specialty.
```jsonc
{
  "generatedAtNote": "offline build; not a runtime artifact",
  "meta": {                                  // Codex Q5: freeze verified counts + assert at build
    "totalSpecialties": 110,
    "demandBearingSpecialties": 17,
    "thinSpecialties": 4,
    "noSignalSpecialties": 93,
    "topNPerSpecialty": 20
  },
  "demandBearing": {                         // one entry per ranked specialty (17)
    "pediatrics": [
      { "districtKey": "bihar::araria", "state_ut_norm": "bihar", "district_name_norm": "araria",
        "rank": 1, "impact_index": 100, "priority_tier": "critical",
        "pop_weighted_demand": 1234.5, "unmet_demand": 0.98,
        "specialty_absent": true, "is_thin_specialty": false,
        "score_basis": "demand vs supply",
        "driving_needs": ["anaemia","child illness","child malnutrition","child immunization","infant feeding"],
        "candidate_clinics": [ { "facility_id": "<unique_id>", "facility": "...", "type": "...",
                                 "ownership": "public", "tier": "secondary", "beds": 0, "doctors": 0 } ] },
      // … top-N districts, impact-ranked …
    ],
    "cardiology": [ /* … */ ]
    // … 17 total …
  },
  "noSignal": [ "dermatology", "ophthalmology", /* … 93 specialty_canonical values … */ ]
}
```
- Use **open mode, top-N** per the 17 demand-bearing specialties (`recommend(Profile(specialty=s, location_mode="open", top_k=N))`).
- `candidate_clinics` includes `facility_id` (Change 1).
- The `noSignal` array is every `specialty_canonical` whose `recommend(...)` returns `status == "no_gap_signal"` (the 93). The picker lists all 110; selecting a `noSignal` one shows the honest refusal + browse fallback.
- **`driving_needs` is an array** in the gold table — pass it through as an array.

### 4.2 `facilities_slice.json`
The canonical facility objects (integration-spec §4) for every district appearing in `demand_supply_slice.json`. Produced by the §4.1 SQL of the integration spec (joins `gold_facility_enriched` ⋈ `gold_facilities` ⋈ `gold_pincode`, filtered to the bundled `districtKey`s). Each row is exactly the §4 camelCase object. Also emit **`facilities_seed.json`** — a small first-page subset (e.g. 20 rows) used to initialize React state synchronously (integration-spec §7.1).

### 4.3 `specialty_aliases.json`
ONE shared alias map: `{ "<alias or typed text>": "<specialty_canonical>" , … }`, merging `recommend.py`'s `SPECIALTY_ALIASES` with the onboarding spec's Step-1a table. The picker typeahead and any resolver use this so typing resolves identically to the recommender. Ambiguous heads ("oncology", "maternity") resolve to the single most-common canonical with a "subspecialties arrive with live data" note (integration-spec / onboarding spec) — keep P0 simple.

### 4.4 Build assertion (Codex Q5)
`--emit-slice` asserts the live counts match `meta` (110 total, 17 demand-bearing, 4 thin, 93 no-signal) and **fails loudly** if the gold table has drifted, so a refreshed gold layer can't silently change the demo. Print a one-line summary.

---

## 5. Data source for `--emit-slice` (do NOT use the bundled CSV snapshots)

`recommender/data/*.csv` are **reduced projections** — `gold_facility_enriched.csv` there has **no lat/lng and no contacts** (the live table does have `lat_clean`/`long_clean`; contacts live in `gold_facilities`). Codex flagged this: building `facilities_slice.json` from the local CSVs would lose coords+contacts. So `--emit-slice` must read from the **live gold tables** (or a fresh full export), via either:
- the Databricks SQL connector (preferred; one `SELECT` per the integration-spec §4.1 SQL), or
- a fresh CSV export of `gold_facility_enriched` (with `lat_clean`/`long_clean`/`pincode_clean`), `gold_facilities` (contacts), `gold_pincode` (centroids).

The **ranking** half (`demand_supply_slice.json`) can use the existing `gold_demand_supply_gap_v2` snapshot (it has all ranking columns); only the **facility** half needs the live join. Keep the demo's `data/` CSVs for `--demo`/`--selftest`; `--emit-slice` uses live/full data.

---

## 6. What stays CLI-only (not in the app)

The 4 location modes (`open/prefer/fixed/avoid`), the two-section A/B `prefer` policy, `--setting public/private`, `group_order/section_rank/overall_rank`, and the transparency note remain **CLI features** of standalone `recommend.py` (great for the EVAL story and a "deep mode" if asked). The **app** path uses only open-mode national ranking + a client-side "Add my state" filter (integration-spec §5.4). Do not port the modes into the React app.

---

## 7. Acceptance checks

- `python3 recommend.py --selftest` → 13/13 green (add 1 check locking the `pop_weighted_demand` tie-break; total 14).
- `python3 recommend.py --emit-slice --out public/gold` writes `demand_supply_slice.json`, `facilities_slice.json`, `facilities_seed.json`, `specialty_aliases.json`; prints `meta` counts; **asserts** 110/17/4/93.
- Every `candidate_clinics[]` entry has a `facility_id` that exists as an `id` in `facilities_slice.json`.
- `demandBearing` has exactly 17 keys; `noSignal` has exactly 93 entries; the 4 thin specialties carry `is_thin_specialty: true`.
- `facilities_slice.json` rows match the integration-spec §4 object (camelCase, `facebook` not `facebookUrl`, `specialtiesList` present, `lat`/`lng` populated ~99.6%).
- Total `public/gold/*.json` < 1 MB.
