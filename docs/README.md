# Virtue Foundation — Gold Layer Docs (DAIS 2026)

Analytics-ready gold tables in **`workspace.virtue_foundation_enriched`**, modeling India's district health **needs** (demand) against facility **specialist** supply. Built from the read-only Delta Share `databricks_virtue_foundation_dataset_dais_2026` (NFHS-5 + facilities).

## Serving tables (start here)

| doc | table | grain | what it answers |
|---|---|---|---|
| [gold_nfhs_district](gold_nfhs_district.md) | `gold_nfhs_district` | 1 row / district (706) | cleaned NFHS-5 indicators **+ needs/persona** — *who needs what* |
| [gold_need_specialist_map](gold_need_specialist_map.md) | `gold_need_specialist_map` | 1 row / (need, specialty) (174) | *which specialist treats which need* (district-independent dictionary) |
| [gold_demand_supply_gap](gold_demand_supply_gap.md) | `gold_demand_supply_gap` | 1 row / (district, specialty) (24,118) | *where the specialist gaps are* (demand vs supply) |

## How they relate

```
gold_nfhs_district.needs ──┐
                           ├─(need_category)─► gold_need_specialist_map ─(specialty)─┐
facilities (specialty supply) ──────────────────────────────────────────────────────┤
                                                                                     ▼
                                                                       gold_demand_supply_gap
                                                                  (demand vs supply, per district×specialty)
```

## Supporting ("silver") tables — plumbing that builds the three above
| table | purpose |
|---|---|
| `dim_nfhs_indicator` | per-indicator metadata + encoded clinical cutoffs + reliability — drives need triggering |
| `gold_district_need_flags` | long per-need detail `(district, need, segment)` with evidence; rolled up into `gold_nfhs_district.needs` |
| `gold_district_needs` | the needs array / persona, pre-denormalization (now folded into `gold_nfhs_district`) |
| `dim_specialty_canonical` | 111 canonical specialties in 14 families |
| `map_specialty_raw_to_canonical` | 2,927 raw facility specialty tokens → canonical |
| `fct_facility_specialty` | facility × canonical specialty supply grain (reuses `gold_facilities`) |
| `dim_district_crosswalk` | postal → NFHS district rename fix (93.6% facility coverage) |

## Build SQL
Every table's DDL is in [`sql/`](sql/) — one file per table (idempotent `CREATE OR REPLACE TABLE … AS SELECT`).
Rebuild order: `gold_nfhs_district.sql` → need_flags → district_needs → `gold_nfhs_district_denormalize.sql`; specialty dims/map/fact + crosswalk independently; then `gold_need_specialist_map.sql` and `gold_demand_supply_gap.sql`.

## Notes
- Source catalog is a **read-only Delta Share**, so all gold tables live in `workspace.virtue_foundation_enriched` (alongside the `facilities_*` enrichment).
- Demand is **prevalence-scaled**, not headcount — NFHS carries no absolute district population.
