-- WS-7  ->  workspace.virtue_foundation_enriched.facilities_enrich_geo
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Validation PASSED: COUNT(*)=9989, COUNT(DISTINCT facility_sk)=9989 (exactly one row per canonical facility). Ownership distribution: private 8835, unknown 631, public 472, trust 49, government 2 (public+government = 474 public-health facilities). geo_valid=true for 9953 rows; lat

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_geo AS
SELECT
  facility_sk,
  CASE WHEN geo_valid THEN latitude ELSE NULL END AS lat_clean,
  CASE WHEN geo_valid THEN longitude ELSE NULL END AS long_clean,
  geo_valid,
  pincode_clean,
  upper(trim(address_city)) AS district_approx,
  CASE lower(coalesce(operator_type,''))
    WHEN 'private' THEN 'private'
    WHEN 'public' THEN 'public'
    WHEN 'government' THEN 'government'
    ELSE CASE
      WHEN lower(coalesce(description,'')) RLIKE 'trust|charitable|charity|mission' THEN 'trust'
      WHEN lower(coalesce(description,'')) RLIKE 'government|govt|district hospital|civil hospital|municipal' THEN 'public'
      ELSE 'unknown'
    END
  END AS ownership_clean,
  (CASE lower(coalesce(operator_type,''))
    WHEN 'private' THEN 'private'
    WHEN 'public' THEN 'public'
    WHEN 'government' THEN 'government'
    ELSE CASE
      WHEN lower(coalesce(description,'')) RLIKE 'trust|charitable|charity|mission' THEN 'trust'
      WHEN lower(coalesce(description,'')) RLIKE 'government|govt|district hospital|civil hospital|municipal' THEN 'public'
      ELSE 'unknown'
    END
  END) IN ('public','government') AS is_public_health_facility,
  lower(concat_ws(' ', name, description)) RLIKE 'cghs' AS is_cghs,
  lower(concat_ws(' ', name, description)) RLIKE '\\besic\\b|employees state insurance' AS is_esic,
  lower(concat_ws(' ', name, description)) RLIKE 'pmjay|ayushman|jan arogya' AS is_pmjay
FROM workspace.virtue_foundation_enriched.facilities_silver
WHERE is_canonical;
