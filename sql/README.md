# Facilities enrichment — SQL build

Deterministic SQL that builds the facilities enriched layer. Plan: [`../ideas/01-facilities-enrichment-plan.md`](../ideas/01-facilities-enrichment-plan.md).

**Output schema:** `workspace.virtue_foundation_enriched` (the source catalog
`databricks_virtue_foundation_dataset_dais_2026` is a read-only Delta Share, so we can't write there).

**Built:** 2026-06-15 via the `facilities-enrichment-build` fan-out workflow, then **rebuilt/expanded**
(expanded silver, expanded capability, five new enrich tables, two new bridges, wider gold + column comments,
plus three bug fixes and one dedup on `04`/`06`/`08`). All tables verified.

## Run order
| # | File | Table(s) | Grain / rows |
|---|------|----------|--------------|
| 00 | `00_facilities_silver.sql` | `facilities_silver` (**expanded**: arrays, social, affiliation, source-url passthroughs) | 1 row per source facility — **10,000** (9,989 canonical) |
| 01 | `01_beds.sql` | `facilities_enrich_beds` | per `facility_sk` — **9,989** |
| 02 | `02_availability.sql` | `facilities_enrich_availability` | 9,989 |
| 03 | `03_contact.sql` | `facilities_enrich_contact` | 9,989 |
| 04 | `04_freshness.sql` | `facilities_enrich_freshness` (**bug-fixed**: clamp future page/post dates to NULL) | 9,989 |
| 05 | `05_social.sql` | `facilities_enrich_social` | 9,989 |
| 06 | `06_capability.sql` | `facilities_enrich_capability` (**bug-fixed**: dropped duplicated free-text clinical flags) + bridges `facilities_specialties`, `facilities_equipment` | enrich 9,989; bridges many-per-`facility_sk` |
| 07 | `07_geo.sql` | `facilities_enrich_geo` | 9,989 |
| 08 | `08_quality.sql` | `facilities_enrich_quality` (**bug-fixed**: tighter `is_teaching_hospital` / `is_medical_college_attached`) | 9,989 |
| 10 | `10_clinical_facts.sql` | `facilities_enrich_clinical_facts` + bridge `facilities_clinical_facts` | enrich 9,989; bridge **399,572** |
| 11 | `11_profile.sql` | `facilities_enrich_profile` (year/age, doctor count, description, full address) | 9,989 |
| 12 | `12_trust.sql` | `facilities_enrich_trust` (digital legitimacy, org/social/source counts, completeness score) | 9,989 |
| 13 | `13_staff.sql` | `facilities_enrich_staff` (**new**: named-doctor count, 18 specialist-title flags — 17 counted, generic `has_physician` excluded) + bridge `facilities_doctors` (**new**) | enrich 9,989; bridge **13,469** |
| 14 | `14_description.sql` | `facilities_enrich_description` (**new**: text metrics, ownership sector, founding year, opening-hours, accreditation/24x7 signals) | 9,989 |
| 09 | `09_gold_facilities.sql` | `gold_facilities` (**rebuilt**) | **9,989** wide (**177 cols**), 1:1 joins |
| 09b | `09b_gold_comments.sql` | column comments on every `gold_facilities` column | 177 comments |
| 15 | `15_data_dictionary.sql` | `facilities_data_dictionary` (one row per gold column) | **177** |
| 16 | `16_validate_grain.sql` | `assert_true` 1:1-grain checks for all 13 enrich tables + `gold_facilities` (fails the run on any fan-out) | 14 asserts |

00 must run first (foundation). 01–08, 10–14 are independent and can run in any order / in parallel.
09 runs last (joins all enrich tables 1:1), then 09b stamps comments, then `15_data_dictionary.sql`
materializes `facilities_data_dictionary` from `information_schema.columns`. All are `CREATE OR REPLACE`
→ idempotent and safe to re-run.

`20_shiftlink_app_user_database.sql` is not part of the facility enrichment pipeline. It is a planned
Databricks Lakebase Postgres schema/seed artifact for app-owned user and profile persistence under the
`shiftlink_app` schema. The current live app still uses browser `localStorage` for prototype users,
profiles, and scheduling state.

**Bug fixes (this revision):** `04` now clamps any page/post date parsed *after* the scrape anchor
(`2025-12-21`) to NULL (a page can't be updated after it was scraped). `06` removed eight free-text
clinical flags + two mined counts that exactly **duplicated** `facilities_enrich_clinical_facts`
(the canonical home for free-text clinical signals) — dedup, single source of truth. `08` tightened
`is_teaching_hospital` (213→263, now precise) and `is_medical_college_attached` (433→236; ~197
staff-bio false positives like "MBBS from <x> Medical College" removed) to require a name-anchored
or explicit teaching/affiliation phrase rather than a bare generic token.

## New bridge tables (many rows per `facility_sk`)
Long tables for fan-out queries (counts/density at value grain, not 1-row-per-facility):
| Table | Built by | Grain | Rows |
|-------|----------|-------|------|
| `facilities_specialties` | 06 | one row per (facility, specialty) | **118,222** |
| `facilities_equipment` | 06 | one row per (facility, equipment item) | **60,075** |
| `facilities_clinical_facts` | 10 | one row per (facility, capability/procedure fact) tagged `fact_source` | **399,572** |
| `facilities_doctors` | 13 | one row per (facility, distinct named doctor) mined from text | **13,456** |

## Documentation table
`facilities_data_dictionary` — `column_name, ordinal_position, data_type, description` for every
`gold_facilities` column. Materialized by `15_data_dictionary.sql` from `workspace.information_schema.columns`
after 09b stamps the comments. **177 rows = 177 gold columns; 0 rows have a NULL/empty `description`** (full coverage).

## Key model facts
- **Identity key** = `facility_sk` = sha2 hash of name+address+pincode+rounded-coords → **9,989 real facilities**.
- `content_table_id` is **NOT** a duplicate key (it's a shared-scraped-source signal; one id can span 27
  different hospitals). Use `WHERE is_canonical` for counts/density.
- **Surface uncertainty, never fabricate:** imputed fields carry `*_source` / `*_confidence`; mined numerics
  clamp to NULL when implausible; the gold table rolls up `needs_verification` + `*_verification_status` for
  the frontend to badge facts as verified / inferred / stale.

## Verified coverage (on 9,989 canonical facilities)
beds 2,693 (27%; 197 mined from text) · 24x7 service 3,859 · 24x7 emergency 2,271 ·
contact verified 9,631 / unverified 358 · freshness stale 3,051 / fresh 1,836 ·
multispecialty 9,087 · emergency-readiness high 809 · quality signal (NABH/NABL/teaching) 2,016 ·
public facilities 474 · needs_outreach 3,302 · needs_verification 8,810.

**New gold fields (rebuilt 177-col table) — key additions:**
21 specialty/clinical flags (`has_ophthalmology`, `has_dentistry`, `has_ent`, `has_transplant`,
`has_robotic_surgery`, `has_chemotherapy`, `has_radiotherapy`, `is_jci_accredited`, `has_trauma_center`,
`has_telemedicine`, `has_ambulance`, …) now mining **`procedure`** (richest clinical source, previously
dropped) · `specialties_list` / `equipment_list` array passthroughs · mined `operating_theatre_count`,
`doctor_count` (structured + text, with `*_source`/`*_confidence`) · `year_established` / `facility_age_tier`
/ `staffing_tier` · clinical-facts roll-up (`clinical_facts_count`, `cf_*`/`offers_*` flags, `ot_count_text`) ·
trust block (`has_affiliated_staff`, `has_custom_logo`, `org_facts_count`, `social_post_count`,
`source_url_count`, `source_urls_list`, `affiliation_type_ids`, `has_affiliation`, `data_completeness_score`) ·
`description` / `area` / `address_full` for frontend display.

**Latest additions (147 → 176 → 177 cols) — clinical staff + description:**
Clinical-staff block from `13_staff.sql` — `named_doctor_count` / `has_named_doctors`, `has_department_lead`,
18 specialist-title flags (`has_cardiologist`, `has_oncologist`, `has_neurologist`, `has_nephrologist`,
`has_pediatrician`, `has_obgyn`, `has_orthopedic_surgeon`, `has_urologist`, `has_dermatologist`,
`has_ophthalmologist`, `has_psychiatrist`, `has_pulmonologist`, `has_gastroenterologist`, `has_radiologist`,
`has_pathologist`, `has_anesthesiologist`, `has_general_surgeon`, `has_physician`), `specialist_domain_count`,
`has_specialist_evidence`, `staff_evidence_source` (these answer "which doctors/specialists are on staff?",
with the bridge `facilities_doctors` listing each distinct mined doctor name). Description block from
`14_description.sql` — `description_length`, `description_word_count`, `has_rich_description`, `ownership_sector`
(+`_source`), `desc_founding_year`, `desc_has_opening_hours` / `desc_opening_hours_raw`,
`desc_accreditation_signal`, `desc_mentions_24x7`. Plus refreshed cross-WS derived fields
(`emergency_readiness_score`/`_tier`, `needs_outreach`, `is_digitally_active`, `needs_verification`,
`is_contactable_direct`, `ownership_sector_final`/`_source` (operator_type + description reconciled),
`year_established_final`/`_source`, `opd_hours_final`, `has_operating_hours`).
Both new enrich tables follow "surface uncertainty, never fabricate": signals are INFERRED from scraped
free-text (`capability` + `procedure` + `description`), companion `*_source` columns document provenance,
and unknowns stay NULL rather than guessed.

## Codex review fixes (2026-06-15)
The layer was reviewed by Codex; the following were fixed in this build (live-verified, all 14 grain asserts pass):
- **`is_contactable` was misleading** (true for 358 facilities with no phone/email) → added **`is_contactable_direct`** (`email_final` OR `phone_final` present; 9,631 vs 9,989). `is_contactable` kept for "any channel incl. website/Facebook" with a clarified comment.
- **Future-dated freshness** → `04_freshness.sql` clamps any page/post date after the `2025-12-21` scrape anchor to NULL (6 rows tagged `fresh` with negative age → now **0**).
- **`is_teaching_hospital` over-broad** → `08_quality.sql` tightened to name-anchored colleges or explicit teaching/DNB-seat phrases; dental-clinic false positives removed.
- **Duplicate clinical flags** → the 11 capability-derived flags duplicating `facilities_enrich_clinical_facts` were removed; the clinical-facts table is canonical.
- **`is_digitally_active`** returns FALSE (not NULL) when `social_post_date` is missing.
- **`has_operating_hours`** now also true on a description hours mention or the WS-2 `hours_signal_present` flag, not only an extracted snippet.
- **`clinical_signal_source`** corrected to `capability_procedure_description_text` (the blob includes `description`).
- **`ownership_sector_source`** is NULL when no sector was inferred (no provenance for a non-classification).
- **Two ownership models reconciled** → governed **`ownership_sector_final`** = `operator_type` (93% filled) coalesced with description/name text evidence → **93% classified** (private 8,638 / government_public 499 / trust_charitable 199) vs 14% from description alone.
- **`ownership_sector` / `desc_founding_year` tightened** to drop free-text false positives (bare `mission`/`trust`/`since`); **`desc_bed_count` dropped** (+34 net-new vs capacity; unit-count risk).
- **Named-doctor regex** excludes institution names (`Dr X Hospital/College/University/…`); **`has_physician`** excluded from `specialist_domain_count` as too generic.
- **Grain hardening** → `16_validate_grain.sql` asserts every enrich table + gold is exactly 1:1 on `facility_sk`.

## Raw → gold coverage
All **51** raw source columns of
`databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities`, marked **ENCODED**
(where the value lands in silver/gold/bridge) or **DROPPED** (with a one-line reason).

| # | Raw column | Status | Lands in / reason |
|---|------------|--------|-------------------|
| 0 | `unique_id` | ENCODED | `silver.unique_id` → `gold.unique_id` (source row id) |
| 1 | `source_types` | DROPPED | scrape-pipeline metadata, not a facility attribute |
| 2 | `source_ids` | DROPPED | internal scrape ids; no analytic value |
| 3 | `source_content_id` | ENCODED | `silver.source_content_id` / `shares_source_content` |
| 4 | `name` | ENCODED | `gold.name` (+ part of `facility_sk`) |
| 5 | `organization_type` | DROPPED | used as the load filter (`='facility'`); constant afterward |
| 6 | `content_table_id` | ENCODED | `silver.source_content_id` + `shares_source_content` flag |
| 7 | `phone_numbers` | ENCODED | parsed to `silver.phone_numbers_arr` |
| 8 | `officialPhone` | ENCODED | `gold.official_phone` / `phone_final` |
| 9 | `email` | ENCODED | `gold.email` / `email_final` |
| 10 | `websites` | ENCODED | parsed to `silver.websites_arr` |
| 11 | `officialWebsite` | ENCODED | `gold.official_website` / `has_website` |
| 12 | `yearEstablished` | ENCODED | `gold.year_established` / `facility_age_years` / `facility_age_tier` |
| 13 | `acceptsVolunteers` | DROPPED | volunteer-recruitment field, off-scope and near-empty |
| 14 | `facebookLink` | ENCODED | `gold.facebook_link` / `has_facebook` / `contact_followup_link` |
| 15 | `address_line1` | ENCODED | part of `facility_sk` + `gold.address_full` |
| 16 | `address_line2` | ENCODED | `gold.address_full` |
| 17 | `address_line3` | ENCODED | `gold.address_full` |
| 18 | `address_city` | ENCODED | `gold.address_city` / `district_approx` |
| 19 | `address_stateOrRegion` | ENCODED | `gold.address_state` |
| 20 | `address_zipOrPostcode` | ENCODED | `gold.pincode_clean` (first 6-digit run) |
| 21 | `address_country` | DROPPED | constant (India); no variance |
| 22 | `address_countryCode` | DROPPED | constant (IN); no variance |
| 23 | `countries` | DROPPED | constant / redundant with country |
| 24 | `facilityTypeId` | ENCODED | `gold.facility_type` |
| 25 | `operatorTypeId` | ENCODED | `gold.operator_type` / `ownership_clean` |
| 26 | `affiliationTypeIds` | ENCODED | `gold.affiliation_type_ids` / `has_affiliation` |
| 27 | `description` | ENCODED | `gold.description` + many mined flags (ownership, clinical, quality) |
| 28 | `area` | ENCODED | `gold.area` |
| 29 | `numberDoctors` | ENCODED | `gold.doctor_count_structured` / `doctor_count` |
| 30 | `capacity` | ENCODED | `gold.capacity_structured` / `bed_count` |
| 31 | `specialties` | ENCODED | `gold.specialties_list` + bridge `facilities_specialties` + `has_*` flags |
| 32 | `procedure` | ENCODED | clinical flags (`has_transplant`, …) + bridge `facilities_clinical_facts` |
| 33 | `equipment` | ENCODED | `gold.equipment_list` + bridge `facilities_equipment` + `has_ct`/`has_mri`/… |
| 34 | `capability` | ENCODED | clinical/quality flags + bridge `facilities_clinical_facts` |
| 35 | `recency_of_page_update` | ENCODED | `gold.page_update_date` / `days_since_page_update` / `freshness_tier` |
| 36 | `distinct_social_media_presence_count` | ENCODED | `gold.social_presence_count` / `digital_presence_score` |
| 37 | `affiliated_staff_presence` | ENCODED | `gold.has_affiliated_staff` |
| 38 | `custom_logo_presence` | ENCODED | `gold.has_custom_logo` |
| 39 | `number_of_facts_about_the_organization` | ENCODED | `gold.org_facts_count` |
| 40 | `post_metrics_most_recent_social_media_post_date` | ENCODED | `gold.social_post_date` |
| 41 | `post_metrics_post_count` | ENCODED | `gold.social_post_count` |
| 42 | `engagement_metrics_n_followers` | ENCODED | `gold.followers_clean` / `social_activity_tier` |
| 43 | `engagement_metrics_n_likes` | ENCODED | `gold.likes_clean` |
| 44 | `engagement_metrics_n_engagements` | ENCODED | `gold.engagements_clean` |
| 45 | `source` | DROPPED | scrape-provenance label, not a facility attribute |
| 46 | `coordinates` | DROPPED | redundant with the typed `latitude` / `longitude` doubles |
| 47 | `latitude` | ENCODED | `gold.latitude` / `lat_clean` / `geo_valid_enrich` |
| 48 | `longitude` | ENCODED | `gold.longitude` / `long_clean` / `geo_valid_enrich` |
| 49 | `cluster_id` | DROPPED | internal clustering id; no analytic meaning |
| 50 | `source_urls` | ENCODED | `gold.source_urls_list` / `source_url_count` |

### Coverage, two ways

**(i) Raw-column coverage = encoded / 51.** Of the 51 raw columns, **41 are ENCODED** →
**raw coverage = 41 / 51 = 80.4%.** This is the literal "what fraction of source columns did we touch"
number; it is held down by 10 columns that carry **no facility information to encode**.

**(ii) INFORMATION coverage = encoded / (51 − non-informative columns).** The 10 dropped columns are
each either a constant, the load filter, internal scrape provenance, or redundant with a typed column we
already encoded — none adds a *new* analytic fact about a facility. Excluding them from the denominator:

| Excluded column | Why it carries no new facility information |
|-----------------|--------------------------------------------|
| `source_types` | scrape-pipeline metadata, not a facility attribute |
| `source_ids` | internal scrape ids; no analytic value |
| `organization_type` | the load filter (`='facility'`); constant for every retained row |
| `acceptsVolunteers` | volunteer-recruitment field; off-scope and near-empty |
| `address_country` | constant (India); zero variance |
| `address_countryCode` | constant (IN); zero variance |
| `countries` | constant / redundant with country |
| `source` | scrape-provenance label, not a facility attribute |
| `coordinates` | redundant with the typed `latitude` / `longitude` doubles (already encoded) |
| `cluster_id` | internal clustering id; no analytic meaning |

**Information coverage = 41 / (51 − 10) = 41 / 41 = 100.0%.** Every raw column that actually carries a
facility-level fact is encoded into silver, gold, or a bridge table. The 10 excluded columns are dropped
*on purpose*, with the one-line reasons above — they are constant, the load filter, off-scope, internal
scrape metadata, or redundant with a column already encoded.

> Note: the latest clinical-staff (`13`) and description (`14`) enrichments mine columns that were already
> ENCODED (`capability`, `procedure`, `description`), so they deepen the *information* extracted without
> changing the raw 41/51 count. The 147 → 176 → 177 gold-column growth is all derived signal, not newly-touched
> raw columns.

## Not in this build (follow-ups)
- WS-1/WS-2 LLM refinement (`ai_query`) for ambiguous bed mentions and hours-scope classification.
- WS-3 live website contact extraction (status framework is in place; actual fetch is a separate simple script).
- WS-7 true `district_normalized` via the pincode→NFHS crosswalk (currently `district_approx` = city).
- `is_digitally_invisible` threshold tuning (≈99% have a Facebook link, so the 0.25 cutoff flags ~none).
- Deferred Codex items: weight `emergency_readiness_score` (currently an unweighted 6-signal average); parse a `service_24x7_scope` (emergency vs OPD vs pharmacy — current flags are unparsed signals); parse day-month social-post dates ("12 February"); enrich `facilities_doctors` with extracted title/specialty + evidence snippet; rename/deprecate `is_contactable` → `has_any_contact_channel` and `contact_verification_status='verified'` → `source_present` (held back to avoid breaking the existing frontend prototype).
