-- ============================================================================
-- WS-0  Facilities Silver — foundation for the enrichment layer
-- Plan: ideas/01-facilities-enrichment-plan.md  (Phase 0)
--
-- Produces ONE clean, typed, keyed, dedup-flagged row per facility.
-- Everything downstream (WS-1..WS-9) reads this and writes 1 row per facility_sk.
--
-- Output schema = workspace.virtue_foundation_enriched
--   (source catalog databricks_virtue_foundation_dataset_dais_2026 is a READ-ONLY
--    Delta Sharing catalog, so the enriched layer lives in the writable `workspace` catalog.)
-- ============================================================================

CREATE OR REPLACE TABLE
  workspace.virtue_foundation_enriched.facilities_silver AS
WITH raw AS (
  SELECT *
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
  WHERE organization_type = 'facility'        -- drops the 88 column-shifted corrupt rows -> 10,000
),
-- Normalize literal-string missingness ('null'/'NA'/'') to real NULL via a CASE helper applied inline.
clean AS (
  SELECT
    unique_id,
    content_table_id,
    cluster_id,
    -- identity / location
    CASE WHEN lower(trim(name))                  IN ('null','na','') THEN NULL ELSE trim(name) END                  AS name,
    CASE WHEN lower(trim(address_line1))         IN ('null','na','') THEN NULL ELSE trim(address_line1) END         AS address_line1,
    CASE WHEN lower(trim(address_city))          IN ('null','na','') THEN NULL ELSE trim(address_city) END          AS address_city,
    CASE WHEN lower(trim(address_stateOrRegion)) IN ('null','na','') THEN NULL ELSE trim(address_stateOrRegion) END AS address_state,
    -- 6-digit PIN: strip spaces, pull the first 6-digit run
    NULLIF(regexp_extract(translate(coalesce(address_zipOrPostcode,''),' ',''), '([0-9]{6})', 1), '')               AS pincode_clean,
    latitude,
    longitude,
    -- contact (cleaned scalars; arrays parsed below)
    CASE WHEN lower(trim(officialPhone))   IN ('null','na','') THEN NULL ELSE trim(officialPhone) END   AS official_phone,
    CASE WHEN lower(trim(email))           IN ('null','na','') THEN NULL ELSE trim(email) END           AS email,
    CASE WHEN lower(trim(officialWebsite)) IN ('null','na','') THEN NULL ELSE trim(officialWebsite) END AS official_website,
    CASE WHEN lower(trim(facebookLink))    IN ('null','na','') THEN NULL ELSE trim(facebookLink) END    AS facebook_link,
    -- classification
    CASE WHEN lower(trim(facilityTypeId))  IN ('null','na','') THEN NULL ELSE trim(facilityTypeId) END  AS facility_type,
    CASE WHEN lower(trim(operatorTypeId))  IN ('null','na','') THEN NULL ELSE trim(operatorTypeId) END  AS operator_type,
    -- analytic raw fields kept for downstream WS (nullified)
    CASE WHEN lower(trim(capacity))               IN ('null','na','') THEN NULL ELSE trim(capacity) END               AS capacity_raw,
    CASE WHEN lower(trim(numberDoctors))          IN ('null','na','') THEN NULL ELSE trim(numberDoctors) END          AS number_doctors_raw,
    CASE WHEN lower(trim(yearEstablished))        IN ('null','na','') THEN NULL ELSE trim(yearEstablished) END        AS year_established_raw,
    CASE WHEN lower(trim(recency_of_page_update)) IN ('null','na','') THEN NULL ELSE trim(recency_of_page_update) END AS recency_of_page_update_raw,
    CASE WHEN lower(trim(post_metrics_most_recent_social_media_post_date)) IN ('null','na','') THEN NULL
         ELSE trim(post_metrics_most_recent_social_media_post_date) END                                              AS social_post_date_raw,
    CASE WHEN lower(trim(description)) IN ('null','na','') THEN NULL ELSE trim(description) END AS description,
    -- additional location passthroughs (trim + literal-null-normalized)
    CASE WHEN lower(trim(address_line2)) IN ('null','na','') THEN NULL ELSE trim(address_line2) END AS address_line2,
    CASE WHEN lower(trim(address_line3)) IN ('null','na','') THEN NULL ELSE trim(address_line3) END AS address_line3,
    CASE WHEN lower(trim(area))          IN ('null','na','') THEN NULL ELSE trim(area) END          AS area,
    -- affiliation type ids (JSON-array string -> distinct real array)
    array_distinct(coalesce(try_cast(from_json(affiliationTypeIds, 'array<string>') AS array<string>), array())) AS affiliation_type_ids_arr,
    -- count of mined facts about the organization (typed int)
    try_cast(number_of_facts_about_the_organization AS int) AS number_of_facts,
    -- provenance source URLs (JSON-array string -> real array, kept ordered/with dupes) + its size
    coalesce(try_cast(from_json(source_urls, 'array<string>') AS array<string>), array()) AS source_urls_arr,
    size(coalesce(try_cast(from_json(source_urls, 'array<string>') AS array<string>), array())) AS source_url_count,
    -- JSON-array string columns -> real arrays (array_distinct where dupes are common)
    array_distinct(coalesce(try_cast(from_json(specialties, 'array<string>') AS array<string>), array())) AS specialties_clean,
    coalesce(try_cast(from_json(phone_numbers, 'array<string>') AS array<string>), array())                AS phone_numbers_arr,
    coalesce(try_cast(from_json(websites,      'array<string>') AS array<string>), array())                AS websites_arr,
    coalesce(try_cast(from_json(equipment,     'array<string>') AS array<string>), array())                AS equipment_arr,
    coalesce(try_cast(from_json(procedure,     'array<string>') AS array<string>), array())                AS procedure_arr,
    coalesce(try_cast(from_json(capability,    'array<string>') AS array<string>), array())                AS capability_arr,
    -- social metrics (typed; outliers handled in WS-5)
    try_cast(engagement_metrics_n_followers AS int)        AS n_followers,
    try_cast(engagement_metrics_n_likes AS int)            AS n_likes,
    try_cast(engagement_metrics_n_engagements AS int)      AS n_engagements,
    try_cast(post_metrics_post_count AS int)               AS post_count,
    try_cast(distinct_social_media_presence_count AS int)  AS social_presence_count,
    affiliated_staff_presence,
    custom_logo_presence
  FROM raw
),
keyed AS (
  SELECT
    *,
    -- coordinate validity (India bbox)
    (latitude BETWEEN 6 AND 37 AND longitude BETWEEN 68 AND 98) AS geo_valid,
    -- DETERMINISTIC surrogate key (stable across reruns; never content_table_id)
    sha2(concat_ws('|',
      lower(coalesce(name,'')),
      lower(coalesce(address_line1,'')),
      coalesce(pincode_clean,''),
      coalesce(cast(round(latitude,4)  AS string),''),
      coalesce(cast(round(longitude,4) AS string),'')
    ), 256) AS facility_sk,
    -- richness score to elect a canonical row within a dup group
    ( (CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN official_phone IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN official_website IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN capacity_raw IS NOT NULL THEN 1 ELSE 0 END)
    + size(specialties_clean)
    + size(equipment_arr) ) AS fill_score
  FROM clean
)
SELECT
  k.* EXCEPT (fill_score, content_table_id),
  -- content_table_id == same SCRAPED SOURCE document, NOT a duplicate facility.
  -- VERIFIED: 405 of 413 multi-row content groups span DIFFERENT facilities (one spans 27
  -- distinct hospitals). So it is an informational shared-source signal, never a dedup key.
  content_table_id AS source_content_id,
  (COUNT(*) OVER (PARTITION BY content_table_id)) > 1 AS shares_source_content,
  -- TRUE duplicate detection is on the facility identity key (name+address+pincode+geo):
  (COUNT(*) OVER (PARTITION BY facility_sk)) > 1 AS is_probable_duplicate,
  -- canonical = richest row per real facility (tie-break by unique_id for determinism).
  -- Count/density analytics use WHERE is_canonical -> 9,989 distinct facilities.
  (ROW_NUMBER() OVER (
      PARTITION BY facility_sk
      ORDER BY fill_score DESC, unique_id ASC) = 1) AS is_canonical
FROM keyed k;

-- ---------------------------------------------------------------------------
-- Validation: run after build. Expect total_rows = 10000.
-- ---------------------------------------------------------------------------
-- SELECT
--   COUNT(*)                                   AS total_rows,        -- expect 10000
--   COUNT(DISTINCT facility_sk)                AS distinct_sk,       -- expect 9989 (real facilities)
--   SUM(CASE WHEN is_canonical THEN 1 ELSE 0 END) AS canonical_rows, -- expect 9989; use for counts/density
--   SUM(CASE WHEN is_probable_duplicate THEN 1 ELSE 0 END) AS dup_rows,        -- expect 22 (11 pairs)
--   SUM(CASE WHEN shares_source_content THEN 1 ELSE 0 END) AS shared_source,   -- expect 1346 (informational only)
--   SUM(CASE WHEN geo_valid    THEN 1 ELSE 0 END) AS geo_valid_rows, -- expect ~9964
--   SUM(CASE WHEN pincode_clean IS NOT NULL THEN 1 ELSE 0 END)     AS with_pincode   -- expect ~9931
-- FROM workspace.virtue_foundation_enriched.facilities_silver;
