# Facilities Enrichment Plan v2 — Virtue Foundation (DAIS 2026)

**Date:** 2026-06-15 · **Status:** `built` (deterministic core; LLM/scrape follow-ups pending) · codex-reviewed
**Build:** all tables live in `workspace.virtue_foundation_enriched`; `facilities_gold` = 9,989 facilities × 86 cols. See [`../sql/README.md`](../sql/README.md).
**Source table:** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities`
**Output location:** `workspace.virtue_foundation_enriched.*` (see note below)
**Companion:** [`../findings/dataset-deep-dive.md`](../findings/dataset-deep-dive.md)

## Decisions locked (2026-06-15)
1. **Output schema.** Intent was "same schema as the source," but the source catalog
   `databricks_virtue_foundation_dataset_dais_2026` is a **read-only Delta Sharing catalog** — tables
   cannot be created there. Closest viable home = **`workspace.virtue_foundation_enriched`** (the
   writable UC catalog), holding `facilities_silver`, `facilities_gold`, `facilities_enrich_*`.
2. **Contact backfill (WS-3) stays dead-simple & best-effort.** One lightweight website-only pass; if a value
   can't be extracted *reliably*, we do **not** guess — we leave it NULL and **surface the uncertainty to the
   frontend** via confidence/verification fields. No Facebook scraping, no spike gating, no over-engineering.
   (Open decision #2 — resolved.)

## Objective
Build an **enriched analytics layer** for facilities: take the 10k clean rows and derive as many
high-confidence, analytics-ready fields as possible — beds, service availability, backfilled
contacts, data freshness, digital presence, capability, quality/accreditation, and geo-density —
without silently overwriting good source data, and **without the risky parts blocking delivery**.

## What changed in v2 (from codex review)
- **Key:** `facility_sk` is now a **deterministic hash** (recipe below). `content_table_id` is **never** a join key.
- **Uniqueness:** every workstream table must be **exactly one row per `facility_sk`** before the Integrator joins.
- **Dedup is a Phase-0 decision, not deferred** (default policy below).
- **WS-2 reframed** from "operating hours" to **service-availability/scope signals** (regex-first; LLM only classifies scope).
- **WS-3 de-risked & off the critical path:** website-only by default, `robots.txt`-compliant, no UA rotation;
  Facebook only via official Graph API if credentials are provided; the Integrator ships gold **without** WS-3.
- **Cross-workstream derived fields** (`needs_outreach`, `is_digitally_active`) are computed **in the Integrator**, not inside a single WS.
- **Failure isolation:** missing/failed WS tables degrade to NULL + `*_status`, never abort the run.
- **New workstreams** added: WS-8 quality/accreditation, WS-9 emergency-readiness composite, WS-7 expanded to density analytics + ownership normalization.
- **Validation:** deterministic range/pattern buckets, not just eyeballing 20–30.
- **Runtime:** default to a **deterministic notebook sequence**; the agent team builds it. Full Databricks Workflow only if parallel isolation is genuinely needed.

## Design principles
1. **Never destroy provenance.** Imputed/derived value fields ship as `<field>_final`, `<field>_source`
   (`structured`/`text_regex`/`text_llm`/`web`/`graph_api`/`imputed`/`original`), `<field>_confidence`.
   *Scope of the contract:* applies to **value-imputation** fields (beds, email, phone, dates). Pure
   derived analytics (scores, tiers, boolean capability flags) instead carry a documented formula +
   `*_inputs_present` coverage flag — they are not "sourced," they are computed.
2. **Cheapest method that works:** deterministic SQL/regex → `ai_query` (LLM) → external fetch. Don't LLM what regex nails; don't scrape what regex extracts.
3. **Coverage honesty.** Each field reports realized coverage vs. baseline. No silent caps.
4. **Idempotent, keyed, conflict-free, uniqueness-enforced.** One row per `facility_sk` per table; Integrator joins are guaranteed 1:1.
5. **Risky/optional work never blocks the gold table.** WS-3 (scrape) and any LLM stage are late-binding.
6. **Surface uncertainty, never fabricate.** Any value we can't verify reliably stays NULL with a
   machine-readable status, not a guess. Every imputed/derived field carries a `*_confidence`
   (`high`/`medium`/`low`) and the row carries a consolidated `needs_verification` flag + per-domain
   `*_verification_status` (`verified`/`inferred`/`unverified`/`stale`) so the **frontend can show a badge**
   ("verified" vs "inferred — please confirm" vs "may be out of date"). This is how WS-3 (unverifiable
   contacts) and WS-4 (stale pages) reach the UI honestly.

---

## Phase 0 — Foundation, key, dedup (WS-0) — blocks everything

**Clean base:** `WHERE organization_type='facility'` → **10,000 rows** (drops 88 corrupt). Normalize
literal `'null'`/`'NA'`/`''` → SQL `NULL`. Parse JSON-array columns once (`phone_numbers`, `websites`,
`source_urls`, `specialties`+`array_distinct`, `procedure`, `equipment`, `capability`). `TRY_CAST`
numerics; coordinate-validity flag (India bbox lat 6–37 / long 68–98 → 9,964 valid).

**Surrogate key (deterministic):**
```
facility_sk = sha2(concat_ws('|',
                 lower(trim(name)),
                 lower(trim(coalesce(address_line1,''))),
                 coalesce(pincode_clean,''),
                 round(lat_clean,4), round(long_clean,4)), 256)
```
Stable across reruns; independent of `unique_id` (11 collisions) and `content_table_id` (unsafe).

**Dedup policy (decided now, default — confirm). VERIFIED against data:**
`content_table_id` is **NOT** a duplicate key — 405 of 413 multi-row content groups span *different*
facilities (one `content_table_id` covers 27 distinct hospitals across MP). It's a *same-scraped-source*
signal only → kept as `source_content_id` + `shares_source_content` flag, **never** used to collapse.
True identity is `facility_sk` (name+address+pincode+geo) → **9,989 distinct facilities**, only 11 true
dupes (22 rows). **Keep all rows**, stamp `is_probable_duplicate` and elect one `is_canonical` per
`facility_sk` (richest fill). **All count/density analytics use `WHERE is_canonical`** (9,989); row-level
enrichment still applies to every row.

**Output:** `facilities_silver` (10,000 rows; typed, parsed, keyed, dedup-flagged). Contract for all WS:
read silver, write **one row per `facility_sk`**.

---

## Enrichment workstreams
Each: **source → method → fields → coverage (measured) → risk.**

### WS-1 — Capacity = bed count (idea #1)
- **Source:** `capacity` (25.2% filled, dirty, 200000 outlier) + bed counts in `description`/`procedure`/`capability`
  (1,949 rows match `\d{1,4}\s*-?\s*bed`; **198 recoverable where capacity NULL**).
- **Method (escalation — codex confirmed sound):** ① clean structured `capacity` (`TRY_CAST`, clamp >5,000 as suspect,
  reject 200000); ② regex extract "N bed(ded)" → take facility-level max per row; ③ `ai_query` **only** for
  ambiguous/multi-mention rows ("expanding 205→300 beds"; "20-bed Dialysis Unit" = unit, not facility);
  ④ cross-validate structured vs text, emit conflict flag. **De-dupe to one bed_count per `facility_sk`.**
- **Fields:** `bed_count` (int), `bed_count_source`, `bed_count_confidence`, `bed_count_conflict`, `capacity_is_imputed`.
- **Coverage:** ~25% + ~2pp net-new + validation → **~27–30%**. **Risk:** unit-level mentions → LLM disambiguation.

### WS-2 — Service availability & scope signals (idea #2, reframed)
> Not "operating hours." We deliver **availability/scope signals**, not a weekly schedule (codex HIGH).
- **Source:** `procedure` + `description` + `capability`. Measured: 3,868 mention 24x7/round-the-clock,
  467 weekday, 388 am/pm, 290 "timings/OPD timing/working hours" — mostly **service-specific** ("pharmacy 24x7", "dialysis 24x7").
- **Method (regex-first, deterministic):** flags for 24x7 + a **scope** per match. `ai_query` used **only** to
  classify scope (facility-wide vs emergency vs OPD vs pharmacy/dialysis) on rows with a hit — **never** to reconstruct schedules.
- **Fields:** `is_24x7_emergency` (bool), `has_24x7_service` (bool), `service_24x7_scope` (enum), `opd_hours_raw`
  (text, best-effort, only when explicit), `hours_signal_present` (bool).
- **Coverage:** flags on ~40%; explicit OPD-hours text on a few hundred. **Risk:** mislabeling a single 24x7 service as whole-facility → scope enum mitigates.

### WS-3 — Contact backfill (idea #3) — DEAD-SIMPLE, BEST-EFFORT, OFF CRITICAL PATH
> **Decision #2:** keep it trivial. Try once, cheaply, website-only. If it doesn't yield a *reliable*
> value, leave NULL and **surface the uncertainty to the frontend** — never fabricate. No Facebook
> scraping, no spike gating, no retry orchestration.
- **Opportunity (measured but caveated):** 1,455 missing email / 497 missing phone, all with a website or
  facebookLink. **URL presence ≠ recoverable** (page may be down, JS-rendered, no contact markup, stale).
- **Method (minimal):**
  - **Website-only, single polite pass.** For rows with a missing contact, fetch `officialWebsite` (and the
    home/contact page only); extract `mailto:` / `tel:` and a strict email/phone regex. **Respect `robots.txt`**,
    one fixed rate-limit, identifying UA, short timeout, **no retries/UA-rotation/anti-bot evasion**. On any
    failure (timeout, block, JS-only, no match) → give up immediately, record `unverified`.
  - **No Facebook scraping** (ToS). `facebookLink` is kept only as a frontend "verify here" outreach link.
  - Validate extracted values: email regex, phone → E.164 (`+91`). Only accept high-confidence matches.
- **Fields:** `email_final`, `email_source` (`original`/`web`), `email_confidence`, `phone_final`,
  `phone_source`, `phone_confidence`, `contact_verification_status`
  (`verified`/`web_inferred`/`unverified`), `is_contactable`, `contact_followup_link` (website/facebook to verify).
- **Frontend contract:** original values → `verified`; web-extracted → `web_inferred` (show "please confirm");
  still-missing → `unverified` (show "no contact on file — reach out via {link}"). Stale contacts inherit WS-4's `stale` status.
- **Sequencing:** Integrator joins WS-3 as a **late-binding optional** table; gold ships fully even if WS-3 yields nothing.
- **Coverage:** whatever the single pass returns (likely modest); **the win is honest status, not high yield.**

### WS-4 — Freshness / staleness (idea #4)
- **Source:** `recency_of_page_update` (35.4%, mixed ISO + relative "1 month ago") + `post_metrics_most_recent_social_media_post_date`
  (49.3%, messy, missing-year "12 February").
- **Method (deterministic):** parse both formats → date; anchor relative terms to snapshot **≈2025-12-21** (max observed; confirm); compute `days_since_*`.
- **Fields:** `page_update_date`, `social_post_date`, `days_since_page_update`, `freshness_tier`
  (`fresh<6mo`/`aging 6–18mo`/`stale>18mo`/`unknown`), `data_freshness_score` (0–1). *(`needs_outreach` is computed in the Integrator.)*
- **Coverage:** dates ~35–50%; tier defined for all. **Risk:** low — nail relative-date anchor + missing-year.

### WS-5 — Social / digital presence (idea #5)
- **Source (measured):** followers 88.8%, likes 78.0%, engagements 48.9%, post_count 37.8%,
  social-presence-count 99.7%, facebookLink 98.8%, `affiliated_staff_presence`, `custom_logo_presence` (median 244 followers; 15M outlier).
- **Method:** `TRY_CAST` + winsorize at p99 (flag the 15M); booleanize presence; composite scores.
- **Fields:** `digital_presence_score`, `engagement_index`, `social_activity_tier`, `is_digitally_invisible`
  (low presence — outreach target). *(`is_digitally_active` = presence + recent post lives in the Integrator.)*
- **Coverage:** high. **Risk:** low — document scoring weights + clamp.

### WS-6 — Capability / specialty / equipment (bonus, high value)
- **Source:** `specialties` (99.7%), `equipment`, `procedure`, `capability`.
- **Method:** **keyword maps primary** for all binary flags (codex MEDIUM); `ai_query` only for fuzzy equipment normalization, never for simple presence.
- **Fields:** `specialty_count`, `specialties_clean`, `is_multispecialty`, `facility_complexity_tier`;
  specialty flags (`has_cardiology`/`has_maternity`/`has_oncology`/`has_dialysis`/`has_pediatrics`/`has_emergency`…);
  equipment flags (`has_ct`/`has_mri`/`has_xray`/`has_ultrasound`/`has_icu`/`has_ot`/`has_blood_bank`/`has_ventilator`), `equipment_richness_score`.
- **Risk:** low–medium (taxonomy upkeep).

### WS-7 — Geo, density & ownership (bonus, expanded per codex)
- **Method:** clean lat/long + validity; normalize `district`/`pincode`; **then add density analytics** —
  facilities-per-district/pincode, beds-per-district, specialty-gap vs NFHS district need. Normalize ownership/scheme.
- **Fields:** `lat_clean`, `long_clean`, `geo_valid`, `district_normalized`, `pincode_clean`,
  `facilities_in_district`, `beds_in_district`, `ownership_clean` (public/private/trust/govt-scheme),
  `is_public_health_facility`, scheme flags (`is_cghs`/`is_esic`/`is_pmjay`) if present in text.
- **Note:** `district_normalized` is the crosswalk to NFHS need data — the biggest join hurdle per the deep-dive.

### WS-8 — Quality / accreditation signals (NEW, codex MEDIUM→high value)
- **Source:** `description`/`capability`/`name` text. **Method:** keyword/regex (LLM only for ambiguous).
- **Fields:** `is_nabh_accredited`, `is_nabl_accredited`, `is_teaching_hospital`, `is_medical_college_attached`,
  `accreditation_signal_count`, `quality_tier`. Directly answers "which facilities meet quality thresholds?"

### WS-9 — Emergency-readiness composite (NEW, codex MEDIUM)
- **Method:** combine WS-2 + WS-6 flags into one India-relevant index.
- **Fields:** `emergency_readiness_score` = f(`has_emergency`, `has_icu`, `has_blood_bank`, `has_ventilator`,
  `is_24x7_emergency`, trauma/ambulance/maternity/dialysis), `emergency_readiness_tier`. Computed in Integrator (depends on WS-2/6).

---

## Architecture

```
facilities (raw 10,088)
  └─ WS-0 ─► facilities_silver (10,000 rows → 9,989 real facilities; typed/parsed; facility_sk; is_canonical; shares_source_content)
              │  (each WS: 1 row per facility_sk)
              ├─ enrich_beds (WS-1)     ├─ enrich_freshness (WS-4)   ├─ enrich_capability (WS-6)
              ├─ enrich_availability(WS-2)├─ enrich_social (WS-5)    ├─ enrich_geo (WS-7)
              ├─ enrich_quality (WS-8)                               └─ [optional] enrich_contact (WS-3)
              └─ Integrator (1:1 left joins on facility_sk; WS-3 late-binding)
                   ├─ derives cross-WS fields: needs_outreach (WS-4+WS-3), is_digitally_active (WS-5+WS-4),
                   │   emergency_readiness_score (WS-2+WS-6)
                   ├─ rolls up frontend confidence: needs_verification (bool) + *_verification_status per domain
                   ├─ degrades missing/failed WS to NULL + *_status (never aborts)
                   └─► facilities_gold (wide) + data_dictionary
```
**Output schema:** `workspace.virtue_foundation_enriched` (source catalog is read-only Delta Share — see Decisions).
Tables prefixed `facilities_`. LLM = Databricks `ai_query()` with Claude (in-platform, batchable).
Final table carries column comments; `data_dictionary` documents every field's method/coverage/confidence/formula.

**Frontend confidence rollup (gold):** `needs_verification` (any low-confidence/unverified/stale field present),
plus per-domain `contact_verification_status`, `beds_confidence`, `freshness_tier`. The UI reads these to badge each
fact as verified / inferred / out-of-date and to drive "confirm via {link}" prompts.

## Agent-team orchestration
Independent-after-WS-0 workstreams fan out; cross-WS fields are Integrator-owned (explicit input contracts).
- **Orchestrator (me):** key/dedup design, sequencing, integration, codex liaison.
- **WS-0 Silver+Key+Dedup Builder** (first; blocks all).
- **Parallel fan-out** (read silver, write own 1-row-per-key table): A1 Beds · A2 Availability · A4 Freshness ·
  A5 Social · A6 Capability · A7 Geo/Density · A8 Quality. *(A3 Contact = separate gated track.)*
- **Integrator** — 1:1 joins → `facilities_gold`, derives cross-WS fields, validation suite, data dictionary, WS-9 score.
- **Codex** — reviewed this plan (done); will review the Integrator + WS-3 spike before they ship.

**Runtime:** default **deterministic notebook sequence** (cheap, auditable). Promote to a Databricks Workflow only
if we need real parallel isolation/retries — i.e. just the LLM (WS-1/2 `ai_query`) and WS-3 fetch stages.

### Phasing
- **P0:** WS-0 silver + `facility_sk` + dedup policy. *(blocks all)*
- **P1 (parallel, cheap, high-confidence):** WS-4, WS-5, WS-6, WS-7, WS-8, WS-1/2 **regex** passes.
- **P2 (LLM, gated):** WS-1/WS-2 `ai_query` (scope/ambiguous only).
- **P3 (optional, off critical path):** WS-3 single website-only pass; record `verified`/`web_inferred`/`unverified`. No gating.
- **P4:** Integrator + WS-9 + frontend-confidence rollup + validation + data dictionary + coverage report. *(codex review before ship)*
  — **P4 can run after P1/P2 without P3.**

## Validation (deterministic, not eyeball-only)
- Row-count parity (10,000 in → 10,000 out; **assert 1:1 joins**, no fanout).
- Per-`facility_sk` uniqueness assertion on every WS table **before** join.
- Field-level **deterministic buckets**: bed_count ∈ [1,5000]; dates ∈ [2000-01-01, snapshot]; emails regex-valid;
  phones E.164; scores ∈ [0,1]; known-bad-pattern counts. + targeted human review of flagged edge cases only.
- Provenance invariant: for value fields, `_final ≠ _original` implies `_source ≠ original`.
- Coverage report per field vs. baseline; flag any below target.

## Decisions (resolved)
1. ✅ **Output schema** = `workspace.virtue_foundation_enriched` (source catalog is read-only Delta Share; can't write there).
2. ✅ **WS-3** = dead-simple website-only best-effort; unverifiable → NULL + surfaced uncertainty (no Facebook scrape).
3. **`ai_query` budget** for WS-1/2 — only flagged rows, small; proceed.
4. ✅ **Snapshot anchor date** for relative dates = **2025-12-21**.
5. ✅ **Dedup** = keep-all + `is_canonical` (per `facility_sk`, 9,989) for analytics.
