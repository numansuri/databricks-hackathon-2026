-- WS-5  ->  workspace.virtue_foundation_enriched.facilities_enrich_social
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Validation PASSED: COUNT(*)=9989 and COUNT(DISTINCT facility_sk)=9989. Coverage: has_website TRUE=8385/9989 (84.0%), has_facebook TRUE=9871/9989 (98.8%). followers_clean non-null=8871; 1118 NULL = 1116 genuinely null in source + 2 clamped 15M outliers. likes_clean/engagements_cle

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_social AS
WITH base AS (
  SELECT
    facility_sk,
    CASE WHEN n_followers   > 5000000 THEN NULL ELSE n_followers   END AS followers_clean,
    CASE WHEN n_likes       > 5000000 THEN NULL ELSE n_likes       END AS likes_clean,
    CASE WHEN n_engagements > 5000000 THEN NULL ELSE n_engagements END AS engagements_clean,
    (official_website IS NOT NULL) AS has_website,
    (facebook_link    IS NOT NULL) AS has_facebook,
    social_presence_count,
    custom_logo_presence,
    affiliated_staff_presence
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
scored AS (
  SELECT
    facility_sk,
    followers_clean,
    likes_clean,
    engagements_clean,
    has_website,
    has_facebook,
    round(
        0.25 * CAST(has_website  AS int)
      + 0.25 * CAST(has_facebook AS int)
      + 0.25 * (least(coalesce(social_presence_count, 0), 4) / 4.0)
      + 0.10 * CASE WHEN lower(custom_logo_presence)      = 'true' THEN 1 ELSE 0 END
      + 0.15 * CASE WHEN lower(affiliated_staff_presence) = 'true' THEN 1 ELSE 0 END
    , 3) AS digital_presence_score
  FROM base
)
SELECT
  facility_sk,
  CAST(followers_clean   AS int)    AS followers_clean,
  CAST(likes_clean       AS int)    AS likes_clean,
  CAST(engagements_clean AS int)    AS engagements_clean,
  has_website,
  has_facebook,
  CAST(digital_presence_score AS double) AS digital_presence_score,
  CASE
    WHEN coalesce(followers_clean, 0) >= 5000 THEN 'high'
    WHEN coalesce(followers_clean, 0) >= 500  THEN 'medium'
    WHEN coalesce(followers_clean, 0) >= 1    THEN 'low'
    ELSE 'none'
  END AS social_activity_tier,
  (digital_presence_score < 0.25) AS is_digitally_invisible
FROM scored;
