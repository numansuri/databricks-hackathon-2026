-- 14_description.sql
-- BUILD: workspace.virtue_foundation_enriched.facilities_enrich_description
-- Grain: exactly 1 row per canonical facility_sk (9,989 rows)
-- Source: facilities_silver WHERE is_canonical
-- description is 100% filled. Mines: length/word counts, ownership sector,
-- founding year, opening hours, accreditation signal, 24x7 signal.
-- Principle: surface uncertainty, never fabricate. NULL (not a guess) when unknown.
-- Tightened (2026-06-15, post Codex review) to cut free-text false positives:
--   * ownership_sector requires institutional context (not bare 'government'/'mission'/'trust'/'foundation')
--   * ownership_sector_source is NULL when the sector is unknown (no provenance for a non-classification)
--   * desc_founding_year requires an explicit founding phrase (drops bare 'since YYYY' = experience years)
--   * desc_bed_count removed (only +34 net-new vs structured capacity; unit-count false-positive risk)

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_description AS
WITH base AS (
  SELECT
    facility_sk,
    description,
    name,
    lower(description) AS t
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
mined AS (
  SELECT
    facility_sk,

    -- Raw text metrics
    length(description) AS description_length,
    size(split(trim(description), '\\s+')) AS description_word_count,
    (length(description) >= 300) AS has_rich_description,

    -- Ownership sector (NULL = unknown; do NOT guess). Requires institutional
    -- context so promotional phrases ('our mission', 'you can trust', 'private rooms',
    -- 'government scheme') do not misclassify ownership.
    CASE
      WHEN t RLIKE 'government hospital|govt hospital|government medical|govt medical|run by (the )?government|state government|municipal corporation|municipal hospital|district hospital|civil hospital|public sector|\\besic\\b hospital|railway hospital|cantonment hospital|primary health cent|community health cent|\\bphc\\b|\\bchc\\b'
           OR lower(coalesce(name,'')) RLIKE 'govt|government|district hospital|civil hospital|municipal|\\besic\\b|railway|cantonment'
        THEN 'government'
      WHEN t RLIKE 'charitable|charity hospital|\\bngo\\b|non[- ]?profit|not[- ]for[- ]profit|mission hospital|trust hospital|charitable trust|run by (a |the )?(trust|society|mission|church)|managed by (a |the )?(trust|society)|sisters of|fathers of|seva sadan|relief society|religious trust'
           OR lower(coalesce(name,'')) RLIKE 'trust|charitable|mission|seva|foundation'
        THEN 'trust_charitable'
      WHEN t RLIKE 'pvt|private limited|private hospital|\\bllp\\b|corporate'
           OR lower(coalesce(name,'')) RLIKE 'pvt|private'
        THEN 'private'
      ELSE NULL
    END AS ownership_sector,

    -- Founding year from description text, clamped to 1800..2026. Requires an explicit
    -- founding/establishment phrase (bare 'since YYYY' dropped: it often marks a doctor's
    -- experience or service years, not the facility's establishment).
    CASE
      WHEN try_cast(regexp_extract(t, '(?:established|founded|incorporated|inception|set up|commissioned|serving (?:the community )?since|operating since|in service since)[^0-9]{0,15}((?:18|19|20)[0-9]{2})', 1) AS int) BETWEEN 1800 AND 2026
        THEN try_cast(regexp_extract(t, '(?:established|founded|incorporated|inception|set up|commissioned|serving (?:the community )?since|operating since|in service since)[^0-9]{0,15}((?:18|19|20)[0-9]{2})', 1) AS int)
      ELSE NULL
    END AS desc_founding_year,

    -- Opening hours signal (boolean): explicit hours wording OR a day-range + clock time.
    (
      t RLIKE 'opening hours|working hours|\\btimings\\b|open 24'
      OR (t RLIKE 'mon(day)?\\s*(to|-|–|&)' AND t RLIKE '[0-9]{1,2}[:.][0-9]{2}\\s*(am|pm)?')
    ) AS desc_has_opening_hours,

    -- Best-effort raw opening-hours substring (may be NULL even when desc_has_opening_hours is TRUE).
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

    -- Accreditation signal (free-text mention; not a verified accreditation)
    (t RLIKE 'nabh|nabl|\\bjci\\b|iso ?9001|accredit') AS desc_accreditation_signal,

    -- 24x7 signal
    (t RLIKE '24x7|24/7|round[- ]the[- ]clock|round the clock') AS desc_mentions_24x7
  FROM base
)
SELECT
  facility_sk,
  description_length,
  description_word_count,
  has_rich_description,
  ownership_sector,
  -- provenance is recorded ONLY when a sector was actually inferred
  CASE WHEN ownership_sector IS NOT NULL THEN 'description_name_text' ELSE NULL END AS ownership_sector_source,
  desc_founding_year,
  desc_has_opening_hours,
  desc_opening_hours_raw,
  desc_accreditation_signal,
  desc_mentions_24x7
FROM mined;
