-- 12_trust.sql
-- BUILD: TRUST & digital legitimacy enrichment
-- One row per canonical facility_sk, sourced from facilities_silver WHERE is_canonical.
--
-- Observed source values (from silver, is_canonical):
--   affiliated_staff_presence: 'true' (9250), 'false' (696), '' (30), NULL (13)
--   custom_logo_presence:      'true' (8600), 'false' (998), NULL (361), '' (30)
-- Mapping rule: truthy/positive == lower(trim(x)) = 'true' -> TRUE; everything else -> FALSE.
--
-- data_completeness_score (0..1, rounded to 3 dp):
--   mean of 10 presence indicators, each scored 1 when present else 0:
--     1) email IS NOT NULL
--     2) official_phone IS NOT NULL
--     3) official_website IS NOT NULL
--     4) size(specialties_clean) > 0
--     5) description IS NOT NULL
--     6) year_established_raw IS NOT NULL
--     7) capacity_raw IS NOT NULL
--     8) has_affiliated_staff (derived boolean)
--     9) has_custom_logo (derived boolean)
--    10) social_presence_count IS NOT NULL
--   score = round((sum of the 10 indicators) / 10.0, 3)

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_trust AS
SELECT
    facility_sk,

    -- Digital legitimacy booleans (truthy 'true' -> TRUE, else FALSE)
    (lower(trim(affiliated_staff_presence)) = 'true') AS has_affiliated_staff,
    (lower(trim(custom_logo_presence)) = 'true')       AS has_custom_logo,

    -- Passthrough counts
    number_of_facts        AS org_facts_count,
    post_count             AS social_post_count,
    social_presence_count  AS social_presence_count,
    source_url_count       AS source_url_count,

    -- First 5 source URLs for verifiability
    slice(source_urls_arr, 1, 5) AS source_urls_list,

    -- Affiliation passthrough + presence flag
    affiliation_type_ids_arr                  AS affiliation_type_ids,
    (size(affiliation_type_ids_arr) > 0)      AS has_affiliation,

    -- Documented 0..1 data completeness score (mean of 10 presence indicators)
    round((
        CAST(email IS NOT NULL AS INT)
      + CAST(official_phone IS NOT NULL AS INT)
      + CAST(official_website IS NOT NULL AS INT)
      + CAST(size(specialties_clean) > 0 AS INT)
      + CAST(description IS NOT NULL AS INT)
      + CAST(year_established_raw IS NOT NULL AS INT)
      + CAST(capacity_raw IS NOT NULL AS INT)
      + CAST((lower(trim(affiliated_staff_presence)) = 'true') AS INT)
      + CAST((lower(trim(custom_logo_presence)) = 'true') AS INT)
      + CAST(social_presence_count IS NOT NULL AS INT)
    ) / 10.0, 3) AS data_completeness_score

FROM workspace.virtue_foundation_enriched.facilities_silver
WHERE is_canonical;
