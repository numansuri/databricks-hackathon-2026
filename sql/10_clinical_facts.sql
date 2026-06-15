-- ============================================================================
-- 10_clinical_facts.sql
-- Clinical FREE-TEXT facts enrichment for India healthcare facilities.
--
-- Builds:
--   1) workspace.virtue_foundation_enriched.facilities_enrich_clinical_facts
--      (1 row per canonical facility_sk) -- boolean clinical signal flags mined
--      from capability/procedure/description free text.
--   2) workspace.virtue_foundation_enriched.facilities_clinical_facts
--      (bridge, many rows per facility_sk) -- one row per capability/procedure
--      fact, tagged with its source.
--
-- Source: workspace.virtue_foundation_enriched.facilities_silver WHERE is_canonical
-- Principle: "surface uncertainty, never fabricate" -- flags are scraped free-text
-- signals (clinical_signal_source = 'capability_procedure_text'), not authoritative.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Enrich table: 1 row per canonical facility_sk
-- ----------------------------------------------------------------------------
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_clinical_facts AS
WITH base AS (
  SELECT
    facility_sk,
    capability_arr,
    procedure_arr,
    description,
    -- Concatenated, lower-cased free-text blob across capability/procedure/description.
    lower(concat_ws(' || ',
      array_join(capability_arr, ' || '),
      array_join(procedure_arr,  ' || '),
      coalesce(description, '')
    )) AS blob
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
)
SELECT
  facility_sk,
  size(capability_arr) + size(procedure_arr)                              AS clinical_facts_count,
  blob RLIKE 'jci accredit|joint commission'                             AS is_jci_accredited,
  blob RLIKE 'robotic|da vinci'                                          AS offers_robotic_surgery,
  blob RLIKE 'transplant'                                                AS offers_transplant,
  blob RLIKE 'chemotherap'                                               AS offers_chemotherapy,
  blob RLIKE 'radiotherap|radiation oncolog|linac|linear accelerator|cyberknife|gamma knife'
                                                                          AS offers_radiotherapy,
  blob RLIKE 'trauma cent|trauma care'                                   AS is_trauma_center,
  blob RLIKE 'telemedicine|teleconsult|tele-?health'                     AS offers_telemedicine,
  blob RLIKE 'ambulance'                                                 AS offers_ambulance,
  -- Operating-theatre count mined from text; clamp to plausible 1..200 else NULL.
  CASE
    WHEN array_max(
           transform(
             regexp_extract_all(blob, '([0-9]{1,3})\\s*(?:operating|operation)\\s*theat', 1),
             x -> try_cast(x AS int)
           )
         ) BETWEEN 1 AND 200
    THEN array_max(
           transform(
             regexp_extract_all(blob, '([0-9]{1,3})\\s*(?:operating|operation)\\s*theat', 1),
             x -> try_cast(x AS int)
           )
         )
    ELSE NULL
  END                                                                     AS ot_count_text,
  CAST('capability_procedure_text' AS STRING)                            AS clinical_signal_source
FROM base;

-- ----------------------------------------------------------------------------
-- 2) Bridge table: one row per capability/procedure fact (canonical only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_clinical_facts AS
SELECT facility_sk, fact_text, CAST('capability' AS STRING) AS fact_source
FROM workspace.virtue_foundation_enriched.facilities_silver
LATERAL VIEW explode(capability_arr) AS fact_text
WHERE is_canonical
UNION ALL
SELECT facility_sk, fact_text, CAST('procedure' AS STRING) AS fact_source
FROM workspace.virtue_foundation_enriched.facilities_silver
LATERAL VIEW explode(procedure_arr) AS fact_text
WHERE is_canonical;
