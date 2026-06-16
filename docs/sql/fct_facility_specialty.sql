-- fct_facility_specialty : facility x canonical-specialty supply grain.
-- Source: explode facilities.specialties (org_type='facility') -> (unique_id, raw_token)
--   -> join map_specialty_raw_to_canonical -> specialty_canonical
--   -> join gold_facilities (supply layer) for geo/public flags.
-- Filters: drop gold_facilities.is_probable_duplicate=true; drop specialty_canonical NULL or 'other_unspecified'.
-- Grain: distinct (facility_id, specialty_canonical). DISTINCT collapses duplicate raw tokens that map to
--   the same canonical within one facility (e.g. multiple onco subtypes -> medical_oncology) into one supply row.
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.fct_facility_specialty AS
WITH base AS (
  SELECT unique_id, from_json(specialties,'array<string>') arr
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities
  WHERE organization_type='facility' AND specialties IS NOT NULL AND specialties NOT IN ('null','[]','')
),
ex AS (
  SELECT unique_id, trim(s) AS raw_token
  FROM base LATERAL VIEW explode(arr) t AS s
  WHERE trim(s)<>'' AND lower(trim(s))<>'null'
),
mapped AS (
  SELECT e.unique_id, m.specialty_canonical
  FROM ex e
  JOIN workspace.virtue_foundation_enriched.map_specialty_raw_to_canonical m
    ON e.raw_token = m.raw_token
  WHERE m.specialty_canonical IS NOT NULL
    AND m.specialty_canonical <> 'other_unspecified'
),
joined AS (
  SELECT DISTINCT
    g.unique_id              AS facility_id,
    g.name                   AS facility_name,
    mp.specialty_canonical   AS specialty_canonical,
    g.district_approx        AS district_approx,
    g.address_state          AS address_state,
    g.pincode_clean          AS pincode_clean,
    g.lat_clean              AS latitude,
    g.long_clean             AS longitude,
    g.is_public_health_facility AS is_public
  FROM mapped mp
  JOIN workspace.virtue_foundation_enriched.gold_facilities g
    ON mp.unique_id = g.unique_id
  WHERE COALESCE(g.is_probable_duplicate, false) = false
)
SELECT
  facility_id,
  facility_name,
  specialty_canonical,
  district_approx,
  address_state,
  pincode_clean,
  latitude,
  longitude,
  is_public
FROM joined;
