-- 14_description.sql
-- BUILD: workspace.virtue_foundation_enriched.facilities_enrich_description
-- Grain: exactly 1 row per canonical facility_sk (9,989 rows)
-- Source: facilities_silver WHERE is_canonical
-- description is 100% filled. Mines: length/word counts, ownership sector,
-- founding year, opening hours, accreditation signal, 24x7 signal, bed count.
-- Principle: surface uncertainty, never fabricate. NULL (not a guess) when unknown.

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_description AS
WITH base AS (
  SELECT
    facility_sk,
    description,
    name,
    lower(description) AS t
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
)
SELECT
  facility_sk,

  -- Raw text metrics
  length(description) AS description_length,
  size(split(trim(description), '\\s+')) AS description_word_count,
  (length(description) >= 300) AS has_rich_description,

  -- Ownership sector (NULL = unknown; do NOT guess)
  CASE
    WHEN t RLIKE 'government|govt|municipal|district hospital|civil hospital|public sector|state[ -]run|railway hospital|\\besic?\\b'
         OR lower(coalesce(name,'')) RLIKE 'govt|government|district hospital|civil hospital|municipal|\\besic?\\b|railway'
      THEN 'government'
    WHEN t RLIKE 'trust|charitable|charity|mission|\\bngo\\b|non[- ]?profit|foundation|seva|sisters of|fathers of|religious'
         OR lower(coalesce(name,'')) RLIKE 'trust|charitable|mission|seva|foundation'
      THEN 'trust_charitable'
    WHEN t RLIKE 'pvt|private limited|private hospital|\\bllp\\b|corporate'
         OR lower(coalesce(name,'')) RLIKE 'pvt|private'
      THEN 'private'
    ELSE NULL
  END AS ownership_sector,
  'description_name_text' AS ownership_sector_source,

  -- Founding year from description text, clamped to 1800..2026
  CASE
    WHEN try_cast(regexp_extract(t, '(?:establish(?:ed)?|since|founded|inception)[^0-9]{0,12}((?:18|19|20)[0-9]{2})', 1) AS int) BETWEEN 1800 AND 2026
      THEN try_cast(regexp_extract(t, '(?:establish(?:ed)?|since|founded|inception)[^0-9]{0,12}((?:18|19|20)[0-9]{2})', 1) AS int)
    ELSE NULL
  END AS desc_founding_year,

  -- Opening hours signal
  (
    t RLIKE 'opening hours|working hours|\\btimings\\b|open 24'
    OR (t RLIKE 'mon(day)?\\s*(to|-|–|&)' AND t RLIKE '[0-9]{1,2}[:.][0-9]{2}\\s*(am|pm)?')
  ) AS desc_has_opening_hours,

  -- Best-effort raw opening hours substring
  NULLIF(
    trim(
      regexp_extract(
        description,
        '(?i)(opening hours[\\s\\S]{0,160}|(?:mon|monday)[^.]{0,120}[0-9]{1,2}[:.][0-9]{2}[^.]{0,80})',
        1
      )
    ),
    ''
  ) AS desc_opening_hours_raw,

  -- Accreditation signal
  (t RLIKE 'nabh|nabl|\\bjci\\b|iso ?9001|accredit') AS desc_accreditation_signal,

  -- 24x7 signal
  (t RLIKE '24x7|24/7|round[- ]the[- ]clock|round the clock') AS desc_mentions_24x7,

  -- Low-priority extra bed count source, clamped 1..4000
  CASE
    WHEN array_max(
           transform(
             regexp_extract_all(t, '([0-9]{1,4})\\s*-?\\s*bed(?:ded|s)?', 1),
             x -> try_cast(x AS int)
           )
         ) BETWEEN 1 AND 4000
      THEN array_max(
             transform(
               regexp_extract_all(t, '([0-9]{1,4})\\s*-?\\s*bed(?:ded|s)?', 1),
               x -> try_cast(x AS int)
             )
           )
    ELSE NULL
  END AS desc_bed_count

FROM base;
