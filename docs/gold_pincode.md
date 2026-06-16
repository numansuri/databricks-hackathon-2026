# `gold_pincode` — Gold Layer Doc

**Table:** `workspace.virtue_foundation_enriched.gold_pincode` · **Grain:** one row per India Post pincode (**19,586**) · **42 columns**, all with persisted descriptions (`DESCRIBE TABLE …`).

The analytics-ready **geographic dimension** for India: each pincode carries a centroid for distance ranking, a majority district/state for joining to district health data (NFHS-5), office composition, data-quality flags, and the full folded-in detail behind every majority. Raw-data background: [`../findings/pincode-deep-dive.md`](../findings/pincode-deep-dive.md).

## Lineage
```
india_post_pincode_directory   →   pincode_office_silver   →   gold_pincode
  (raw, 165,627 offices,             (cleaned, 1 row/office,      (THIS TABLE,
   read-only Delta Share)             165,625 rows)               1 row/pincode)
                                                              ↘ pincode_nfhs (view → NFHS-5 health rows)
```
The source catalog is a **read-only Delta Share**, so everything is written to `workspace.virtue_foundation_enriched`.

## How it was created
Three idempotent SQL steps (`CREATE OR REPLACE`, re-runnable in order). The runnable code with inline comments + validation lives in `sql/`.

1. **Silver — clean the raw directory** (`sql/10_pincode_office_silver.sql`): one typed row per post office.
   - Literal-string missingness (`'NA'`/`'null'`/`''`) → real SQL `NULL`.
   - Coordinates `TRY_CAST` to `DOUBLE` and **flagged** in-India-bounds (`geo_valid`) — bad/`NA` coords are kept, never silently dropped.
   - `officetype` decoded: `BO`→Branch, **`PO`→Sub** (the "S.O", code is `PO` not `SO`), `HO`→Head Office. Postal zone derived from the first PIN digit.
   - 2 exact-duplicate office rows removed → **165,625 rows**.

2. **Gold — roll up to one row per pincode** (`sql/11_gold_pincode.sql`): `GROUP BY pincode` over silver.
   - **Centroid** = `AVG` of `geo_valid` coords only (`NULL` for the 36 PINs with no usable coordinate; `centroid_quality` tiers the rest).
   - **Majorities** (district / state / circle / region / division) = most-frequent value by office count, with a deterministic name tie-break. A PIN spanning several values keeps the **full set** in a `*_all` array alongside the majority.
   - **Counts & flags**: office-type and delivery counts; `n_*` cardinalities and `is_multi_*` flags per admin level.
   - **Folded-in detail** so the rollup loses no information at PIN grain: `office_names` + `*_all` sets (array `size` = the matching `n_*` count), geocoded bounding box (`lat/lon min/max`), `office_span_km`, `n_offices_geo_out_of_range`.

3. **NFHS bridge** (`sql/12_district_crosswalk.sql`): `normalize_district` / `normalize_state` SQL UDFs + a 103-row `district_crosswalk` resolve postal district spellings to NFHS-5's older names. The `pincode_nfhs` **view** joins `gold_pincode` → NFHS health rows on `(district_majority, state_majority)`, resolving **705/706** district tuples (state-aware; the 1 gap is a known NFHS mislabel).

## Columns at a glance (42)
| group | columns |
|---|---|
| Key & zone | `pincode` (PK), `pin_zone`, `pin_zone_label` |
| Office composition | `n_offices`, `n_branch_offices`, `n_sub_offices`, `n_head_offices`, `n_delivery_offices`, `representative_office`, `office_names` |
| Centroid & geo quality | `centroid_lat`, `centroid_lon`, `n_offices_geocoded`, `geo_coverage`, `has_centroid`, `centroid_quality`, `lat_min/lat_max/lon_min/lon_max`, `office_span_km`, `n_offices_geo_out_of_range` |
| District (NFHS key) | `district_majority`, `n_districts`, `is_multi_district`, `districts_all` |
| State (NFHS key) | `state_majority`, `n_states`, `is_multi_state`, `states_all` |
| Circle / region / division | `circle`/`region`/`division`, `n_circles`/`is_multi_circle`/`circles_all`, `n_regions`/`is_multi_region`/`regions_all`, `n_divisions`/`is_multi_division`/`divisions_all` |

**NFHS join keys** are `district_majority` + `state_majority` (resolve via the crosswalk / `pincode_nfhs` view). Every column's full description is on the table itself — `DESCRIBE TABLE workspace.virtue_foundation_enriched.gold_pincode`.

## Validation (verified live)
19,586 PINs (PK unique) · centroid `NULL` for exactly 36 PINs · every `*_all` array `size` = its `n_*` count (0 mismatches) · office counts reconcile to 165,625 · centroids land in the right cities (110001→New Delhi, 400001→Mumbai, 500001→Hyderabad).

## Reproduce
```sql
-- run in order against workspace.virtue_foundation_enriched
sql/10_pincode_office_silver.sql   -- silver base
sql/11_gold_pincode.sql            -- this table (+ its column descriptions)
sql/12_district_crosswalk.sql      -- normalize UDFs, crosswalk, pincode_nfhs view
```
