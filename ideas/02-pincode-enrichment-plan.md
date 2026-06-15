# Pincode Enrichment — Implementation Doc (enriched pincodes table)

**Date:** 2026-06-15 · **Status:** `building` · codex-reviewed (v2 incorporates the review)
**Source:** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory` (READ-ONLY Delta Share)
**Output:** `workspace.virtue_foundation_enriched.*`
**Companion research:** [`../findings/pincode-deep-dive.md`](../findings/pincode-deep-dive.md)
**SQL:** [`../sql/10_pincode_office_silver.sql`](../sql/10_pincode_office_silver.sql) · [`../sql/11_pincode_gold.sql`](../sql/11_pincode_gold.sql) · [`../sql/12_district_crosswalk.sql`](../sql/12_district_crosswalk.sql)

> Every number in this doc was verified against live data (warehouse `3d472a8f72349193`) before writing — not estimated.

---

## Objective
Turn the raw India Post directory (165,627 office rows, dirty coordinates, "NA" missingness, UPPERCASE postal district names) into a **clean, analytics-ready dimension keyed by pincode** that downstream consumers can trust for:
1. **Geocoding** — one centroid per PIN to resolve "near &lt;place&gt;" and backfill the ~4% of facilities missing coordinates.
2. **Geographic rollups** — every PIN carries a deterministic majority district / state / circle + postal zone.
3. **Health-need linkage** — a verified bridge from PIN → district → **NFHS-5** district health indicators, closing the rename gap that otherwise caps facility→NFHS linkage at 80%.

It mirrors the facilities layer's house pattern: **silver (clean/typed) → gold (wide, analytics-ready)**, idempotent `CREATE OR REPLACE`, literal-`NA`→SQL `NULL`, quality surfaced via explicit flags (never silently dropped), every column commented, deterministic validation buckets.

## Architecture

```
india_post_pincode_directory (raw 165,627 offices, READ-ONLY share)
  └─ 10 pincode_office_silver  (165,625 office rows; typed, NA->NULL, coords bounds-flagged, dedup)
       └─ 11 pincode_gold      (19,586 PIN rows; centroid + majority district/state/circle + quality flags)  ← THE enriched pincodes table
            └─ 12 pincode_nfhs (view: PIN -> NFHS-5 health row, via normalize_district + district_crosswalk)
                 depends on: normalize_district(), normalize_state(), district_crosswalk (103 rows)
```

Three writable objects + two functions + one view, all under `workspace.virtue_foundation_enriched`.

## What changed in v2 (codex review incorporated)
Codex reviewed v1; every fix below was then re-verified against live data:
- **`normalize_district` no longer strips trailing `RURAL`/`URBAN`/`DISTRICT`** — v1 collapsed Bengaluru/Warangal Urban-vs-Rural into one key, risking join fan-out and dropped NFHS rows. Cosmetic suffix cases moved to explicit crosswalk rows. *Re-verified: 0 duplicate crosswalk keys, 0 fan-out, 0 harmful misroutes.*
- **`geo_valid` wrapped in `COALESCE(..., FALSE)`** so `NA`/junk coords are `FALSE`, never `NULL` (v1 returned NULL → `WHERE geo_valid = false` silently skipped them).
- **`pincode_nfhs` provenance is honest on misses:** added `has_nfhs_match`; `nfhs_match_type`/`_confidence` are `NULL` when nothing joined (v1 defaulted to `'exact'`/`'high'` even for the 49 unmatched new districts).
- **Warangal mapping corrected:** `WARANGAL URBAN→HANUMAKONDA`, `WARANGAL RURAL→WARANGAL` (v1 had them reversed).
- **`circ_maj` tie-break fully deterministic** (orders by all of circle/region/division).
- **Counts reconciled to the deduped silver total 165,625** (v1 gold validation expected the raw 165,627; both deduped rows are BO → BO 140,268).
- **Coverage re-measured with state in the join key:** the honest figure is **705/706 NFHS (district,state) tuples**, not the name-only 698/698 — which surfaced a real NFHS data error (Chandel, below).

---

## Step 1 — `pincode_office_silver` (office grain, 165,625 rows)
One clean, typed row per post office. The base the gold rollup aggregates. **SQL:** `sql/10_pincode_office_silver.sql`.

**15 columns:** `pincode` (bigint PK-of-grain w/ officename), `officename` (whitespace-collapsed), `circlename`, `regionname`, `divisionname`, `officetype` (raw), `office_class` (BO→Branch / PO→Sub / HO→Head Office), `is_delivery` (bool), `district_raw` (UPPER/trim), `statename_clean` (literal `NA`→NULL), `lat`/`lon` (DOUBLE, `NA`/junk→NULL), `geo_valid` (bool: in India bbox), `pin_zone` (1–9), `pin_zone_label`.

**Key decisions (verified):**
- **`officetype` decode is BO/PO/HO — Sub Office code is `PO`, not `SO`** (10,926 `PO` rows carry the `S.O` name suffix; 0 carry `B.O`).
- **Coordinates are gated, never dropped.** `geo_valid` flags the 150,999 in-bounds rows; the 12,009 `NA` + 2,611 out-of-bounds + 6 junk stay in the table as `lat/lon NULL` or `geo_valid=false`.
- **Dedup is tiny and safe:** exactly **2 fully-identical office rows** exist (`Bankhedi B.O` 464573, `Talwade B.O` 423101) → `SELECT DISTINCT` over all 11 source columns → 165,625 rows.
- **`officename` whitespace:** 763 rows have internal double-spaces / edge spaces (e.g. `"Kammergaon  B.O"`) → collapsed.

Validation expectations (live): 165,625 rows · 19,586 PINs · geo_valid 150,999 · statename_null 715 · office_class_unmapped 0.

## Step 2 — `pincode_gold` (pincode grain, 19,586 rows) — **the deliverable**
One analytics-ready row per PIN. **SQL:** `sql/11_pincode_gold.sql`.

**42 columns** (26 core + 16 folded-in detail, see "Completeness fold-in" below), each carrying a **persisted column description** (`ALTER COLUMN … COMMENT`, visible in `DESCRIBE` / Catalog Explorer / Genie — the two NFHS join keys `district_majority` + `state_majority` are flagged as such in their descriptions for the gold-NFHS join). **Built & validated live 2026-06-15.** Core-column highlights:
- **Centroid:** `centroid_lat/lon` = `AVG` over `geo_valid` offices only; `n_offices_geocoded`, `geo_coverage`, `has_centroid`, `centroid_quality` (`high`/`medium`/`low`/`none`). **36 PINs (0.18%)** have zero valid coords → `has_centroid=false`, centroid NULL (flagged, not faked).
- **Counts:** `n_offices`, `n_branch_offices`, `n_sub_offices`, `n_head_offices`, `n_delivery_offices`. (BO+PO+HO reconciles exactly to the 165,625 deduped silver rows — no untyped offices.)
- **Majority geography (deterministic, COUNT-desc + name tie-break):** `district_majority`, `state_majority`, `circle`/`region`/`division`, plus `representative_office` (HO→PO→any) as a human-readable anchor.
- **Ambiguity flags (don't pick blindly):** `is_multi_district` (**1,478 PINs**), `is_multi_state` (**52**, clean), `is_multi_circle` (**17**), with `n_districts`/`n_states`/`n_circles`.

**Two findings that corrected the deep-dive:**
1. **`is_multi_state` is truthfully 52, not 290.** The 290 counts the literal `"NA"` statename as a distinct "state". We expose the clean flag (52 real cross-state PINs) and separately flag `state_majority IS NULL` (**105 PINs** where state is genuinely unknown). The 290 is documented as a data-quality artifact, not used as the flag.
2. **17 PINs span >1 India Post Circle — all on the Andhra Pradesh ↔ Telangana border** (PINs 503xxx–531xxx), an artifact of the 2014 state bifurcation that India Post's org-chart never reconciled at border PINs.

Sanity checks pass: 110001→(28.606, 77.220) New Delhi; 400001→(18.936, 72.834) Mumbai GPO; 500001→(17.425, 78.507) Hyderabad GPO.

### Completeness fold-in — does gold carry all the raw base-table info? (v3)
A 4-perspective audit (column-coverage · multi-valued-collapse · analytics-consumer · reconstruction-fidelity) confirmed every raw column *was* represented, but the per-PIN rollup **collapsed multi-valued fields to a single majority** and kept only one office name. **16 columns** were added — non-destructively via `ALTER … ADD COLUMNS` + `MERGE` from silver (the 26 core columns + their descriptions preserved; row count unchanged at **19,586**; all 16 carry persisted comments):

- **Full sets behind the majorities** (`ARRAY<STRING>`, `size = the matching n_* count` — verified **0 mismatches** across all rows): `office_names` (the full roster vs the single `representative_office`, 89% of PINs have >1), `districts_all`, `states_all`, `circles_all`, `regions_all`, `divisions_all`.
- **Region/division parity** (closing the asymmetry where only *circle* had a count + multi-flag): `n_regions`, `is_multi_region` (33 PINs, 16 single-circle), `n_divisions`, `is_multi_division` (129 PINs, 112 single-circle).
- **Geo detail the centroid hid:** `lat_min`/`lat_max`/`lon_min`/`lon_max` (geocoded bounding box), `office_span_km` (spread / centroid-trust scalar), `n_offices_geo_out_of_range` (out-of-bounds bad-coordinate count).

**Deliberately skipped** (derivable or wrong-grain — not folded in): `n_non_delivery_offices` / non-geocoded counts (arithmetic on existing columns), `office_class` aggregates (1:1 relabel of the officetype counts), stddev-based spread (redundant with the bbox), pipe-delimited string variants (arrays chosen), `size(office_names)` as its own column, and **per-office row-level detail** — that lossless fidelity stays in `pincode_office_silver`, the right grain for it.

Net: at PIN grain the gold is now **information-complete** w.r.t. the raw base table — every raw column's per-PIN value-set is recoverable, with true per-office rows one level down in silver.

## Step 3 — NFHS bridge: `normalize_district` + `district_crosswalk` + `pincode_nfhs`
The hardest part: postal district names (modern, UPPERCASE) vs NFHS-5 district names (older, Title-Case, 2019–21). **SQL:** `sql/12_district_crosswalk.sql`.

**Two-tier resolution:**
1. **`normalize_district()`** (pure SQL: case, whitespace, `&`→`AND`, punctuation — deliberately **not** trailing RURAL/URBAN/DISTRICT, per the v2 fix) — closes the **597** exact districts.
2. **`district_crosswalk`** (103 rows) — the renames/transliterations/reorders `normalize` can't fix (`ALLAHABAD`→`PRAYAGRAJ`, `GULBARGA`→`KALABURAGI`, `DAKSHIN DINAJPUR`→`DINAJPUR DAKSHIN`, …). Stored as a `VALUES` table with `match_type` (rename 40 / spelling 56 / punctuation 7) and `confidence` (high 101 / medium 2). Every postal target verified live (0 dangling).

**Result (state-aware): 705 of 706 NFHS (district,state) tuples resolve** (up from 597 exact, 85.5%) — i.e. **100% of reachable districts**. `pincode_nfhs` is a view joining `pincode_gold` → NFHS health rows, **state in the key on both tiers** (disambiguates same-name districts like `AURANGABAD` in Bihar vs Maharashtra; this also caught 2 cross-state false positives — `RAIGARH/MH`→`RAIGAD`, `BIJAPUR/KA`→`VIJAYAPURA`). The view surfaces `has_nfhs_match` + `nfhs_match_type` / `nfhs_match_confidence` as provenance so the UI can be honest about *how* (or whether) a district was linked.

The **1 unresolved NFHS tuple is a data error in NFHS itself**, not a coverage gap: NFHS lists `Chandel` under **both** Manipur (correct — resolves cleanly) and **Mizoram** (wrong — Chandel is a Manipur district). The bogus Mizoram row is an unreachable orphan (no postal `CHANDEL` exists in Mizoram), so it never affects a real lookup. The earlier name-only "698/698" figure masked this; state-in-the-key exposes it.

**Honest limits (documented, not hidden):**
- **49 postal districts (6.5%) have no NFHS row** — all genuinely new districts created *after* NFHS-5 fieldwork (Andhra's 2022 13-district reorg, new TN/Telangana/NE splits). Policy: inherit the parent district's profile where known, else surface "no NFHS coverage."
- **Split caveats:** Bangalore→Bengaluru **Urban** (Rural is separate); Warangal Urban/Rural→Warangal/Hanumakonda; Koriya→Korea (MCB absent, `medium`); **Purba Bardhaman has no NFHS row at all** (NFHS surveyed only Paschim) → optional labeled proxy, else NULL.

**Projected end-to-end facility→NFHS yield: 80.1% → ~95.6%** — the entire ~15.6-pt rename gap recovered; only the PIN-coverage floor remains.

---

## Build order & runtime
Deterministic SQL sequence (cheap, auditable) — no LLM, no external fetch:
```
10_pincode_office_silver.sql  →  11_pincode_gold.sql  →  12_district_crosswalk.sql
```
12 also creates the two functions and the `pincode_nfhs` view. Re-runnable end-to-end (`CREATE OR REPLACE`). Steps 1→2 are a strict dependency; Step 3's functions+crosswalk can be built any time but the `pincode_nfhs` view needs `pincode_gold`.

**Materialized so far (live, validated):** `pincode_office_silver`, `pincode_gold` (**42 columns**, all with persisted descriptions), `normalize_district`, `normalize_state`, `district_crosswalk`. **Not yet built:** the `pincode_nfhs` view. _(Per-column descriptions added to `pincode_gold`; silver + crosswalk can get the same `ALTER COLUMN COMMENT` treatment on request.)_

## Validation (deterministic, not eyeball-only)
Each SQL file ends with a commented validation block carrying **expected counts** (all verified live):
- Silver: 165,625 rows · 19,586 PINs · geo_valid 150,999 · statename_null 715 · 0 leaked literal-missing · 0 residual exact dups.
- Gold: 19,586 PINs (PK unique) · has_centroid_false 36 · multi_district 1,478 · multi_state 52 · multi_circle 17 · typed_offices = total = 165,625 · avg geo_coverage ≈ 0.928 · 3 well-known-PIN sanity rows.
- Crosswalk: 0 dangling postal targets · 0 duplicate crosswalk keys (no fan-out) · 0 harmful misroutes · nfhs_resolved 705/706 (1 = NFHS's Chandel/Mizoram error) · postal_mapped 705/754 tuples (49 unmapped = post-NFHS new districts).

## Downstream usage (Referral Copilot)
- **"near &lt;place&gt;" → geo:** resolve place → PIN (via `representative_office`/`district_majority`), take `centroid_lat/lon`, distance-rank facilities (which carry their own coords). Respect `has_centroid`/`centroid_quality`.
- **Underserved-area flag (ambition extension):** facility → PIN → `pincode_nfhs` → NFHS indicators; tag referrals in low-coverage districts. Surface `nfhs_match_confidence` and the "no NFHS data" cases honestly in the UI (judging axis: communicate uncertainty).

## Open decisions (for codex review / team sign-off)
1. **`is_multi_state` definition** = clean (52) not raw-with-NA (290). Recommend keeping clean; one-line change if the team wants the raw headline.
2. **NFHS row uniqueness — confirmed.** NFHS is already 1 row per (normalized district, state): **706 rows → 706 distinct keys** (698 district names; 8 names appear in 2 states — incl. the bogus Chandel/Manipur + Chandel/Mizoram pair). So the view's defensive dedupe is a verified safety no-op, not silent data loss.
3. **Post-NFHS new districts (49):** default = leave NULL + "no NFHS coverage"; optional parent-inheritance proxy. Pick the default for the demo.
4. **Materialization of `pincode_nfhs`:** view (always fresh, recomputes functions per query) vs `CREATE TABLE` (faster reads for the app). Recommend table once the join is codex-approved.
