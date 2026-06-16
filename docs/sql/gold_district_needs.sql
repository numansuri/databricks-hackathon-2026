-- gold_district_needs
-- One row per district (district_name_norm, state_ut_norm).
--   needs            = collect_list(struct(segment, need_category AS category, severity, score, affected_share_pct)) ordered score desc
--   n_needs          = number of need rows
--   top_need_categories = need_categories of the top 5 scores (array)
--   persona_label    = derived from the dominant need family (highest total family score);
--                      a co-dominant 2nd family (>= 60% of top family score) is composed with '+'.
-- Need-family map:
--   maternal_care_underserved   <- antenatal_care, institutional_delivery, postnatal_care,
--                                  skilled_birth_attendance, cesarean_delivery, maternal_nutrition,
--                                  maternal_oop_financial_protection
--   child_health_nutrition_hotspot <- child_malnutrition, infant_young_child_feeding,
--                                  child_immunization, child_illness_care
--   ncd_rising                  <- ncd_diabetes, ncd_hypertension, cancer_screening,
--                                  adult_overnutrition_obesity
--   anaemia_burden              <- anaemia
--   wash_environment_deficit    <- wash_sanitation, clean_cooking_air
--   mixed_need_profile          <- everything else
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.gold_district_needs AS
WITH flags AS (
  SELECT
    district_name_norm,
    state_ut_norm,
    need_category,
    segment,
    severity,
    score,
    affected_share_pct,
    CASE
      WHEN need_category IN ('antenatal_care','institutional_delivery','postnatal_care','skilled_birth_attendance','cesarean_delivery','maternal_nutrition','maternal_oop_financial_protection') THEN 'maternal_care_underserved'
      WHEN need_category IN ('child_malnutrition','infant_young_child_feeding','child_immunization','child_illness_care') THEN 'child_health_nutrition_hotspot'
      WHEN need_category IN ('ncd_diabetes','ncd_hypertension','cancer_screening','adult_overnutrition_obesity') THEN 'ncd_rising'
      WHEN need_category = 'anaemia' THEN 'anaemia_burden'
      WHEN need_category IN ('wash_sanitation','clean_cooking_air') THEN 'wash_environment_deficit'
      ELSE 'mixed_need_profile'
    END AS need_family
  FROM workspace.virtue_foundation_enriched.gold_district_need_flags
),
-- aggregate family scores per district
fam AS (
  SELECT district_name_norm, state_ut_norm, need_family, SUM(score) AS fam_score
  FROM flags
  GROUP BY district_name_norm, state_ut_norm, need_family
),
fam_ranked AS (
  SELECT
    district_name_norm, state_ut_norm, need_family, fam_score,
    ROW_NUMBER() OVER (PARTITION BY district_name_norm, state_ut_norm ORDER BY fam_score DESC, need_family) AS frank,
    MAX(fam_score) OVER (PARTITION BY district_name_norm, state_ut_norm) AS top_fam_score
  FROM fam
),
persona AS (
  SELECT
    district_name_norm, state_ut_norm,
    -- top family (always present)
    MAX(CASE WHEN frank = 1 THEN need_family END) AS fam1,
    -- second family only if co-dominant (>= 60% of top family score) and not mixed
    MAX(CASE WHEN frank = 2 AND fam_score >= 0.6 * top_fam_score THEN need_family END) AS fam2
  FROM fam_ranked
  GROUP BY district_name_norm, state_ut_norm
),
persona_label AS (
  SELECT
    district_name_norm, state_ut_norm,
    CASE
      WHEN fam2 IS NULL OR fam2 = fam1 THEN fam1
      -- compose top two distinct families with '+', keep mixed_need_profile as standalone if it is fam1
      WHEN fam1 = 'mixed_need_profile' THEN fam1
      WHEN fam2 = 'mixed_need_profile' THEN fam1
      ELSE concat(fam1, '+', fam2)
    END AS persona_label
  FROM persona
),
-- ordered needs array + top categories
agg AS (
  SELECT
    district_name_norm,
    state_ut_norm,
    sort_array(
      collect_list(struct(score AS sort_score, segment, need_category AS category, severity, score, affected_share_pct)),
      false
    ) AS needs_sorted,
    COUNT(*) AS n_needs
  FROM flags
  GROUP BY district_name_norm, state_ut_norm
),
top5 AS (
  SELECT
    district_name_norm, state_ut_norm,
    collect_list(need_category) AS top_need_categories
  FROM (
    SELECT district_name_norm, state_ut_norm, need_category,
      ROW_NUMBER() OVER (PARTITION BY district_name_norm, state_ut_norm ORDER BY score DESC, need_category) AS rnk
    FROM flags
  ) t
  WHERE rnk <= 5
  GROUP BY district_name_norm, state_ut_norm
)
SELECT
  a.district_name_norm,
  a.state_ut_norm,
  transform(a.needs_sorted, x -> struct(x.segment AS segment, x.category AS category, x.severity AS severity, x.score AS score, x.affected_share_pct AS affected_share_pct)) AS needs,
  CAST(a.n_needs AS INT) AS n_needs,
  t.top_need_categories,
  p.persona_label
FROM agg a
JOIN top5 t USING (district_name_norm, state_ut_norm)
JOIN persona_label p USING (district_name_norm, state_ut_norm)
