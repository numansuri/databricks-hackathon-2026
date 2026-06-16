-- gold_demand_supply_gap
-- Demand/Supply gap mart: one row per (district_name_norm, state_ut_norm, specialty_canonical).
--
-- Supply : fct_facility_specialty -> dim_district_crosswalk (district_approx=postal_district,
--          address_state=state) gives nfhs_district_name_norm + nfhs_state_ut_norm.
--          Crosswalk is unique on (postal_district, state) so no fan-out.
--          Aggregated per (nfhs_district, specialty_canonical):
--            n_facilities = COUNT(DISTINCT facility_id)
--            n_public     = COUNT(DISTINCT facility_id WHERE is_public)
-- Demand : gold_district_need_flags JOIN gold_need_specialist_map (relation='primary')
--          per (district, specialty_canonical):
--            demand_score        = SUM(score*weight)
--            pop_weighted_demand = SUM(score*weight*COALESCE(affected_share_pct,50)/100.0)
--            driving_needs       = collect_set(need_category)
--          (one need can map to several primary specialties and several needs can map to the
--           same specialty; aggregating per specialty correctly rolls both up.)
-- Combine: FULL OUTER JOIN demand <-> supply on (district, state, specialty) so demand-only
--          rows (true gaps, specialty_absent=TRUE) and supply-only rows are both retained.
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.gold_demand_supply_gap AS
WITH supply AS (
  SELECT
    x.nfhs_district_name_norm                                              AS district_name_norm,
    x.nfhs_state_ut_norm                                                   AS state_ut_norm,
    f.specialty_canonical                                                  AS specialty_canonical,
    CAST(COUNT(DISTINCT f.facility_id) AS INT)                             AS n_facilities,
    CAST(COUNT(DISTINCT CASE WHEN f.is_public THEN f.facility_id END) AS INT) AS n_public
  FROM workspace.virtue_foundation_enriched.fct_facility_specialty f
  JOIN workspace.virtue_foundation_enriched.dim_district_crosswalk x
    ON f.district_approx = x.postal_district
   AND f.address_state  = x.state
  GROUP BY x.nfhs_district_name_norm, x.nfhs_state_ut_norm, f.specialty_canonical
),
need_dedup AS (
  -- collapse multi-segment rows of the same need to one per (district, need) so a need that
  -- spans several population segments (e.g. anaemia across women/children) does not inflate
  -- a specialty's demand by segment count. Take the worst (max) severity score + prevalence.
  SELECT
    district_name_norm,
    state_ut_norm,
    need_category,
    MAX(score)              AS score,
    MAX(affected_share_pct) AS affected_share_pct
  FROM workspace.virtue_foundation_enriched.gold_district_need_flags
  GROUP BY district_name_norm, state_ut_norm, need_category
),
demand AS (
  SELECT
    n.district_name_norm                                                   AS district_name_norm,
    n.state_ut_norm                                                        AS state_ut_norm,
    m.specialty_canonical                                                  AS specialty_canonical,
    CAST(SUM(n.score * m.weight) AS DOUBLE)                                AS demand_score,
    CAST(SUM(n.score * m.weight * LEAST(GREATEST(COALESCE(n.affected_share_pct, 50), 0), 100) / 100.0) AS DOUBLE) AS pop_weighted_demand,
    collect_set(n.need_category)                                           AS driving_needs
  FROM need_dedup n
  JOIN workspace.virtue_foundation_enriched.gold_need_specialist_map m
    ON n.need_category = m.need_category
   AND m.relation = 'primary'
  GROUP BY n.district_name_norm, n.state_ut_norm, m.specialty_canonical
)
SELECT
  COALESCE(d.district_name_norm,  s.district_name_norm)  AS district_name_norm,
  COALESCE(d.state_ut_norm,       s.state_ut_norm)       AS state_ut_norm,
  COALESCE(d.specialty_canonical, s.specialty_canonical) AS specialty_canonical,
  d.demand_score                                          AS demand_score,
  d.pop_weighted_demand                                   AS pop_weighted_demand,
  d.driving_needs                                         AS driving_needs,
  CAST(COALESCE(s.n_facilities, 0) AS INT)               AS n_facilities,
  CAST(COALESCE(s.n_public, 0) AS INT)                   AS n_public,
  (s.n_facilities IS NULL OR s.n_facilities = 0)         AS specialty_absent,
  d.pop_weighted_demand / NULLIF(COALESCE(s.n_facilities, 0), 0) AS unmet_intensity
FROM demand d
FULL OUTER JOIN supply s
  ON  d.district_name_norm  = s.district_name_norm
  AND d.state_ut_norm       = s.state_ut_norm
  AND d.specialty_canonical = s.specialty_canonical
