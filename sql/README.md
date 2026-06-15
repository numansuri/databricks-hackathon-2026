# Facilities enrichment — SQL build

Deterministic SQL that builds the facilities enriched layer. Plan: [`../ideas/01-facilities-enrichment-plan.md`](../ideas/01-facilities-enrichment-plan.md).

**Output schema:** `workspace.virtue_foundation_enriched` (the source catalog
`databricks_virtue_foundation_dataset_dais_2026` is a read-only Delta Share, so we can't write there).

**Built:** 2026-06-15 via the `facilities-enrichment-build` fan-out workflow. All tables verified.

## Run order
| # | File | Table | Grain / rows |
|---|------|-------|--------------|
| 00 | `00_facilities_silver.sql` | `facilities_silver` | 1 row per source facility — **10,000** (9,989 canonical) |
| 01 | `01_beds.sql` | `facilities_enrich_beds` | per `facility_sk` — **9,989** |
| 02 | `02_availability.sql` | `facilities_enrich_availability` | 9,989 |
| 03 | `03_contact.sql` | `facilities_enrich_contact` | 9,989 |
| 04 | `04_freshness.sql` | `facilities_enrich_freshness` | 9,989 |
| 05 | `05_social.sql` | `facilities_enrich_social` | 9,989 |
| 06 | `06_capability.sql` | `facilities_enrich_capability` | 9,989 |
| 07 | `07_geo.sql` | `facilities_enrich_geo` | 9,989 |
| 08 | `08_quality.sql` | `facilities_enrich_quality` | 9,989 |
| 09 | `09_facilities_gold.sql` | `facilities_gold` | **9,989** wide (86 cols), 1:1 joins |

00 must run first (foundation). 01–08 are independent and can run in any order / in parallel. 09 runs last.
All are `CREATE OR REPLACE` → idempotent and safe to re-run.

## Key model facts
- **Identity key** = `facility_sk` = sha2 hash of name+address+pincode+rounded-coords → **9,989 real facilities**.
- `content_table_id` is **NOT** a duplicate key (it's a shared-scraped-source signal; one id can span 27
  different hospitals). Use `WHERE is_canonical` for counts/density.
- **Surface uncertainty, never fabricate:** imputed fields carry `*_source` / `*_confidence`; the gold table
  rolls up `needs_verification` + `*_verification_status` for the frontend to badge facts as
  verified / inferred / stale.

## Verified coverage (on 9,989 canonical facilities)
beds 2,693 (27%; 197 mined from text) · 24x7 service 3,859 · 24x7 emergency 2,271 ·
contact verified 9,631 / unverified 358 · freshness stale 3,051 / fresh 1,836 ·
multispecialty 9,087 · emergency-readiness high 809 · quality signal (NABH/NABL/teaching) 2,016 ·
public facilities 474 · needs_outreach 3,302 · needs_verification 8,810.

## Not in this build (follow-ups)
- WS-1/WS-2 LLM refinement (`ai_query`) for ambiguous bed mentions and hours-scope classification.
- WS-3 live website contact extraction (status framework is in place; actual fetch is a separate simple script).
- WS-7 true `district_normalized` via the pincode→NFHS crosswalk (currently `district_approx` = city).
- `is_digitally_invisible` threshold tuning (≈99% have a Facebook link, so the 0.25 cutoff flags ~none).
