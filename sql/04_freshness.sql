-- WS-4 FRESHNESS  ->  workspace.virtue_foundation_enriched.facilities_enrich_freshness
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Grain validated: COUNT(*)=COUNT(DISTINCT facility_sk)=9989, one row per canonical facility_sk. Field population: page_update_date non-null 3531/9989; social_post_date non-null 4907/9989; days_since_page_update non-null 3531 (derived from page_update_date); data_freshness_score no

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_freshness AS
WITH parsed AS (
  SELECT
    facility_sk,
    CASE
      WHEN recency_of_page_update_raw RLIKE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN to_date(recency_of_page_update_raw)
      WHEN lower(recency_of_page_update_raw) RLIKE '([0-9]+)\s*(day|week|month|year)s?\s*ago' THEN
        date_sub(DATE'2025-12-21',
          CAST(regexp_extract(lower(recency_of_page_update_raw),'([0-9]+)\s*(day|week|month|year)',1) AS int) *
          CASE regexp_extract(lower(recency_of_page_update_raw),'(day|week|month|year)',1)
               WHEN 'day' THEN 1 WHEN 'week' THEN 7 WHEN 'month' THEN 30 WHEN 'year' THEN 365 ELSE 0 END)
      ELSE NULL
    END AS page_update_date_raw,
    CASE
      WHEN social_post_date_raw RLIKE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN to_date(social_post_date_raw)
      ELSE NULL
    END AS social_post_date_raw
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
base AS (
  -- Clamp any parsed date strictly AFTER the scrape anchor (2025-12-21) to NULL:
  -- a page/post cannot have been updated after the data was scraped.
  SELECT
    facility_sk,
    CASE WHEN page_update_date_raw > DATE'2025-12-21' THEN NULL ELSE page_update_date_raw END AS page_update_date,
    CASE WHEN social_post_date_raw > DATE'2025-12-21' THEN NULL ELSE social_post_date_raw END AS social_post_date
  FROM parsed
),
calc AS (
  SELECT
    facility_sk,
    page_update_date,
    social_post_date,
    datediff(DATE'2025-12-21', page_update_date) AS days_since_page_update,
    least(
      coalesce(datediff(DATE'2025-12-21', page_update_date), 99999),
      coalesce(datediff(DATE'2025-12-21', social_post_date), 99999)
    ) AS d
  FROM base
)
SELECT
  facility_sk,
  page_update_date,
  social_post_date,
  CAST(days_since_page_update AS INT) AS days_since_page_update,
  CASE
    WHEN d < 182 THEN 'fresh'
    WHEN d < 548 THEN 'aging'
    WHEN d < 99999 THEN 'stale'
    ELSE 'unknown'
  END AS freshness_tier,
  CAST(CASE WHEN d = 99999 THEN NULL ELSE round(greatest(0.0, 1.0 - d/730.0), 3) END AS DOUBLE) AS data_freshness_score
FROM calc;
