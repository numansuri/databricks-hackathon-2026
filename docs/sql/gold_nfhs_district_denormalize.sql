-- Denormalize the district needs/persona model INTO gold_nfhs_district.
-- Result grain stays one row per district; adds: needs[] + persona_label + n_needs
-- + top_need_categories + total_need_score + n_high_needs.
-- Build order on a full rebuild: (1) gold_nfhs_district (indicators from source),
-- (2) gold_district_need_flags, (3) gold_district_needs, (4) THIS step (enrich in place via staging swap).
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.gold_nfhs_district_stg AS
SELECT
  b.*,
  n.persona_label,
  n.n_needs,
  n.top_need_categories,
  n.needs,
  s.total_need_score,
  s.n_high_needs
FROM workspace.virtue_foundation_enriched.gold_nfhs_district b
LEFT JOIN workspace.virtue_foundation_enriched.gold_district_needs n
  ON b.district_name_norm = n.district_name_norm AND b.state_ut_norm = n.state_ut_norm
LEFT JOIN (
  SELECT district_name_norm, state_ut_norm,
         CAST(SUM(score) AS INT) AS total_need_score,
         CAST(SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS INT) AS n_high_needs
  FROM workspace.virtue_foundation_enriched.gold_district_need_flags
  GROUP BY district_name_norm, state_ut_norm
) s ON b.district_name_norm = s.district_name_norm AND b.state_ut_norm = s.state_ut_norm;

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.gold_nfhs_district AS
SELECT * FROM workspace.virtue_foundation_enriched.gold_nfhs_district_stg;

DROP TABLE workspace.virtue_foundation_enriched.gold_nfhs_district_stg;
