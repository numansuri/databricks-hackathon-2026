-- WS-1 — BED COUNT  ->  workspace.virtue_foundation_enriched.facilities_enrich_beds
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Validation PASSED: COUNT(*)=9989 and COUNT(DISTINCT facility_sk)=9989, exactly one row per facility_sk. Bed count coverage: 2,693 of 9,989 rows (27.0%) have a non-null bed_count. Split by source: structured=2,496 (high confidence, from capacity_raw TRY_CAST; range 1..4000; the 20

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_beds AS
WITH base AS (
  SELECT
    facility_sk,
    CASE
      WHEN TRY_CAST(capacity_raw AS int) > 0 AND TRY_CAST(capacity_raw AS int) <= 5000
        THEN TRY_CAST(capacity_raw AS int)
      ELSE NULL
    END AS capacity_structured,
    array_max(
      filter(
        transform(
          regexp_extract_all(
            lower(concat_ws(' | ', description, array_join(procedure_arr,' | '), array_join(capability_arr,' | '))),
            '([0-9]{1,4})\s*-?\s*bed(?:s|ded)?', 1
          ),
          x -> TRY_CAST(x AS int)
        ),
        v -> v IS NOT NULL AND v BETWEEN 1 AND 5000
      )
    ) AS bed_count_text
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
)
SELECT
  facility_sk,
  capacity_structured,
  bed_count_text,
  coalesce(capacity_structured, bed_count_text) AS bed_count,
  CASE
    WHEN capacity_structured IS NOT NULL THEN 'structured'
    WHEN bed_count_text IS NOT NULL THEN 'text'
    ELSE 'none'
  END AS bed_count_source,
  CASE
    WHEN capacity_structured IS NOT NULL THEN 'high'
    WHEN bed_count_text IS NOT NULL THEN 'medium'
    ELSE 'low'
  END AS bed_count_confidence,
  (capacity_structured IS NULL AND bed_count_text IS NOT NULL) AS capacity_is_imputed
FROM base;
