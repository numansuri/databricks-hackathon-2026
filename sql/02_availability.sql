-- WS-2  ->  workspace.virtue_foundation_enriched.facilities_enrich_availability
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Coverage over 9989 canonical facilities: has_24x7_service = 3859 (38.6%); is_24x7_emergency = 2271 (22.7%); hours_signal_present = 1092 (10.9%); opd_hours_raw non-null = 104 (1.0%). is_24x7_emergency is a strict subset signal (proximity of emergency/casualty/trauma to a 24x7 toke

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_availability AS
WITH base AS (
  SELECT
    facility_sk,
    lower(concat_ws(' | ', description, array_join(procedure_arr, ' | '), array_join(capability_arr, ' | '))) AS blob
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
)
SELECT
  facility_sk,
  (blob RLIKE '(24x7|24/7|24 hours|round[ -]the[ -]clock)') AS has_24x7_service,
  (
    blob RLIKE '(emergency|casualty|trauma)[^.]{0,40}(24x7|24/7|round[ -]the[ -]clock)'
    OR blob RLIKE '(24x7|24/7|round[ -]the[ -]clock)[^.]{0,40}(emergency|casualty|trauma)'
  ) AS is_24x7_emergency,
  (blob RLIKE '([0-9]{1,2}\\s*(am|pm)|[0-9]{1,2}:[0-9]{2}|timings?|opd timing|working hours|hours of operation)') AS hours_signal_present,
  NULLIF(regexp_extract(blob, '(opd[^.|]{0,60}(am|pm|noon))', 1), '') AS opd_hours_raw
FROM base;
