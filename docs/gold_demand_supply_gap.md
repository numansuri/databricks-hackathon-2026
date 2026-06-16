# gold_demand_supply_gap

**FQN:** `workspace.virtue_foundation_enriched.gold_demand_supply_gap` · **Grain:** one row per `(district_name_norm, state_ut_norm, specialty_canonical)` · **Rows:** 24,118 (10 cols)

## What it is

The payoff mart of the gold layer: where each district's health *needs* (demand, from NFHS-5 indicators) meet the *supply* of facility specialists serving that need. A `FULL OUTER JOIN` keeps both sides, so the table surfaces under-served specialties per district — most pointedly the 8,098 rows where a district has real demand for a specialty but **zero** facilities offer it (`specialty_absent = TRUE`).

## Columns

| column | type | meaning |
|---|---|---|
| `district_name_norm` | string | NFHS district key (normalized). Part of grain. |
| `state_ut_norm` | string | NFHS state/UT key (normalized). Part of grain. |
| `specialty_canonical` | string | Canonical specialty (from the 111-value taxonomy). Part of grain. |
| `demand_score` | double | Severity-weighted demand for this specialty in this district. `NULL` on supply-only rows. Range 1–42. |
| `pop_weighted_demand` | double | `demand_score` scaled by prevalence (share of population affected). `NULL` on supply-only rows. Range 0.005–21.44. |
| `driving_needs` | array<string> | The need categories that generated the demand (e.g. `["anaemia","child_malnutrition","child_immunization"]`). `NULL` on supply-only rows. |
| `n_facilities` | int | Distinct facilities in the district offering this specialty (0 = absent). Range 0–282. |
| `n_public` | int | Of those, how many are public-health facilities. Range 0–21. |
| `specialty_absent` | boolean | `TRUE` when there is demand but `n_facilities = 0`. 8,098 rows. |
| `unmet_intensity` | double | `pop_weighted_demand / n_facilities` — demand per facility (high = stretched/underserved). `NULL` when 0 facilities. |

## How the scores are computed

This is the heart of the table. Demand is built from the need flags, supply from the facility bridge, then joined.

**1. Per-need severity score.** Each need flag (in `gold_district_need_flags`) already carries a severity score:

```
need.score = 2 * (# high-severity driver signals) + 1 * (# med-severity driver signals)
```

**2. Multi-segment dedup.** A single need can fire across several population segments (e.g. anaemia in women *and* children). Before scoring, needs are collapsed to one row per `(district, need_category)`, keeping the **MAX** score and prevalence — so a need does not double-count by segment.

**3. Demand score (per specialty).** Each need maps to one or more specialists via `gold_need_specialist_map` (relation `primary`, weight `1.0`). Summing over the primary needs that point at a specialty:

```
demand_score = SUM( need.score * weight )    over PRIMARY-relation needs for that specialty
```

(Several needs can map to the same specialty; the per-specialty `SUM` rolls them up correctly.)

**4. Population weighting.** Severity alone ignores how many people a need touches. `pop_weighted_demand` scales each term by the prevalence (`affected_share_pct`), clamped to 0–100 and defaulting to 50 when unknown:

```
pop_weighted_demand = SUM( need.score * weight * clamp(affected_share_pct, 0, 100) / 100 )
```

**5. Supply.** `n_facilities` / `n_public` come from `fct_facility_specialty`, aggregated per district × specialty. Facilities carry a postal district, mapped to the NFHS district via `dim_district_crosswalk`. The crosswalk is unique on `(postal_district, state)`, so there is no fan-out; counts use `COUNT(DISTINCT facility_id)`.

**6. Gap signals.**

```
specialty_absent = (n_facilities is NULL or = 0)         -- demand exists but no supply
unmet_intensity  = pop_weighted_demand / n_facilities    -- demand pressure per facility
```

## Lineage

```
DEMAND  gold_district_need_flags  (dedup per district×need, MAX score)
          ⋈  gold_need_specialist_map  (relation = 'primary', weight 1.0)
        ──► per (district, specialty): demand_score, pop_weighted_demand, driving_needs

SUPPLY  fct_facility_specialty
          ⋈  dim_district_crosswalk  (postal_district + state → NFHS district)
        ──► per (district, specialty): n_facilities, n_public

DEMAND  ──FULL OUTER JOIN──  SUPPLY   on (district, state, specialty)
```

Demand-only rows are the true gaps (`specialty_absent = TRUE`); supply-only rows are specialties present without a flagged need (`demand_score IS NULL`). Build SQL: [`docs/sql/gold_demand_supply_gap.sql`](sql/gold_demand_supply_gap.sql).

## Caveats

- **Demand is prevalence-scaled, not headcount.** NFHS-5 has no absolute district population, so `pop_weighted_demand` weights by *share* of population affected, not number of people. Cross-district magnitudes are comparable only in relative terms.
- **Supply join is ~93.6% complete.** The pincode→NFHS-district crosswalk lifts coverage from ~65% (exact-name only) to 93.6% by fixing post-2014 district renames. Its `fuzzy` tier (631 pairs, avg confidence ~0.89) carries a `confidence` column — filter on it for high-precision use. ~6.5% of facility rows (small-town long tail with no NFHS-vintage district) remain unmatched and contribute no supply.
- **Three social-determinant needs produce no demand** here — `female_education`, `health_insurance_access`, `maternal_oop_financial_protection` have no primary clinical specialist, so they never raise `demand_score` (they still appear in `gold_district_needs`).
- **Supply-only rows have NULL demand.** 13,118 of 24,118 rows are supply-only (a specialty is present but no matching need fired); treat `demand_score IS NULL` as "no flagged demand," not zero need.

## Sample — top absent-specialty gaps

Highest-demand specialties with **zero** facilities in the district (`specialty_absent = TRUE`, ordered by `pop_weighted_demand`):

| district | state | specialty | demand_score | pop_weighted_demand | driving_needs |
|---|---|---|--:|--:|---|
| Araria | Bihar | pediatrics | 42 | 20.00 | anaemia, child_illness_care, child_malnutrition, child_immunization, infant_young_child_feeding |
| Kanpur Dehat | Uttar Pradesh | pediatrics | 39 | 19.74 | anaemia, infant_young_child_feeding, child_immunization, child_illness_care, child_malnutrition |
| Kannauj | Uttar Pradesh | pediatrics | 42 | 19.71 | anaemia, child_immunization, child_illness_care, child_malnutrition, infant_young_child_feeding |
| Chitrakoot | Uttar Pradesh | pediatrics | 39 | 19.46 | child_immunization, infant_young_child_feeding, anaemia, child_illness_care, child_malnutrition |
| Budaun | Uttar Pradesh | pediatrics | 41 | 19.20 | child_illness_care, anaemia, child_immunization, child_malnutrition, infant_young_child_feeding |

These are exactly the headline output: rural high-burden districts with severe child-health needs and no facility offering pediatrics.
