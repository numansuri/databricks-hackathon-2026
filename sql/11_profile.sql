-- 11_profile.sql
-- Facility PROFILE enrichment: one row per canonical facility_sk.
-- Built from workspace.virtue_foundation_enriched.facilities_silver WHERE is_canonical.
-- Principle: surface uncertainty, never fabricate. Imputed/mined fields carry
-- *_source / *_confidence companions; implausible numerics clamp to NULL.

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_profile AS
WITH base AS (
  SELECT
    facility_sk,
    description,
    area,
    address_line1,
    address_line2,
    address_line3,
    -- year clamp: keep TRY_CAST only when between 1800 and 2026
    CASE
      WHEN TRY_CAST(year_established_raw AS int) BETWEEN 1800 AND 2026
        THEN TRY_CAST(year_established_raw AS int)
      ELSE NULL
    END AS year_established,
    -- structured doctor count: clamp 1..5000
    CASE
      WHEN TRY_CAST(number_doctors_raw AS int) BETWEEN 1 AND 5000
        THEN TRY_CAST(number_doctors_raw AS int)
      ELSE NULL
    END AS doctor_count_structured,
    -- text-mined doctor count: largest "<n> doctors" mention across capability+procedure text, clamped 1..5000
    CASE
      WHEN array_max(
             transform(
               regexp_extract_all(
                 lower(concat_ws(' || ', array_join(capability_arr, ' || '), array_join(procedure_arr, ' || '))),
                 '([0-9]{1,4})\\s*(?:\\+\\s*)?doctors',
                 1
               ),
               x -> try_cast(x AS int)
             )
           ) BETWEEN 1 AND 5000
        THEN array_max(
               transform(
                 regexp_extract_all(
                   lower(concat_ws(' || ', array_join(capability_arr, ' || '), array_join(procedure_arr, ' || '))),
                   '([0-9]{1,4})\\s*(?:\\+\\s*)?doctors',
                   1
                 ),
                 x -> try_cast(x AS int)
               )
             )
      ELSE NULL
    END AS doctor_count_text
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
derived AS (
  SELECT
    facility_sk,
    description,
    area,
    address_line1,
    address_line2,
    address_line3,
    year_established,
    CASE WHEN year_established IS NOT NULL THEN 2026 - year_established ELSE NULL END AS facility_age_years,
    doctor_count_structured,
    doctor_count_text,
    coalesce(doctor_count_structured, doctor_count_text) AS doctor_count
  FROM base
)
SELECT
  facility_sk,
  year_established,
  facility_age_years,
  CASE
    WHEN facility_age_years >= 50 THEN 'legacy_50plus'
    WHEN facility_age_years >= 20 THEN 'established_20_49'
    WHEN facility_age_years >= 5  THEN 'growing_5_19'
    WHEN facility_age_years >= 0  THEN 'new_under_5'
    ELSE NULL
  END AS facility_age_tier,
  doctor_count_structured,
  doctor_count_text,
  doctor_count,
  CASE
    WHEN doctor_count_structured IS NOT NULL THEN 'structured'
    WHEN doctor_count_text IS NOT NULL THEN 'text'
    ELSE NULL
  END AS doctor_count_source,
  CASE
    WHEN doctor_count_structured IS NOT NULL THEN 'high'
    WHEN doctor_count_text IS NOT NULL THEN 'low'
    ELSE NULL
  END AS doctor_count_confidence,
  CASE
    WHEN doctor_count >= 100 THEN 'large'
    WHEN doctor_count >= 25  THEN 'medium'
    WHEN doctor_count >= 1   THEN 'small'
    ELSE NULL
  END AS staffing_tier,
  description,
  area,
  -- null-safe full address; NULL when all parts empty (concat_ws skips NULLs)
  CASE
    WHEN concat_ws(', ', address_line1, address_line2, address_line3) = '' THEN NULL
    ELSE concat_ws(', ', address_line1, address_line2, address_line3)
  END AS address_full
FROM derived;
