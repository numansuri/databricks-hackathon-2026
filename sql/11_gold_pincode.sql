-- ============================================================================
-- 11  gold_pincode  —  the enriched pincodes table (one row per pincode)
-- Plan: ideas/02-pincode-enrichment-plan.md  (Step 2)
--
-- Output: workspace.virtue_foundation_enriched.gold_pincode  (19,586 rows)
-- Reads:  workspace.virtue_foundation_enriched.pincode_office_silver  (build 10 first)
--
-- Per-PIN rollup of the office-grain silver table: collapses ~8.46 offices/PIN into
-- one analytics-ready row carrying a CENTROID (geo-bridge anchor), a majority
-- district/state/circle (deterministic), and explicit QUALITY FLAGS so consumers
-- never silently trust a NULL centroid or a cross-district PIN.
-- Idempotent. All counts verified live 2026-06-15 (warehouse 3d472a8f72349193).
-- ============================================================================
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.gold_pincode
COMMENT 'Per-pincode gold rollup (19,586 rows). One row per India Post PIN with centroid (geo-bridge anchor), majority district/state/circle, office-type counts, and explicit quality flags. Built from pincode_office_silver. Centroid = AVG of in-bounds (geo_valid) office coords; NULL for 36 PINs with zero valid coords (has_centroid=false). Majorities use COUNT-desc with deterministic name tie-break.'
AS
WITH
-- Per-PIN scalar aggregates (counts, centroid, distinct-cardinalities) ---------
base AS (
  SELECT
    pincode,
    COUNT(*)                                           AS n_offices,
    SUM(CASE WHEN officetype = 'BO' THEN 1 ELSE 0 END) AS n_branch_offices,
    SUM(CASE WHEN officetype = 'PO' THEN 1 ELSE 0 END) AS n_sub_offices,    -- 'PO' = Sub Office, NOT 'SO'
    SUM(CASE WHEN officetype = 'HO' THEN 1 ELSE 0 END) AS n_head_offices,
    SUM(CASE WHEN is_delivery THEN 1 ELSE 0 END)       AS n_delivery_offices,
    -- centroid: AVG over geo_valid offices ONLY (silver already bounds-checked) -
    SUM(CASE WHEN geo_valid THEN 1 ELSE 0 END)         AS n_offices_geocoded,
    AVG(CASE WHEN geo_valid THEN lat END)              AS centroid_lat,
    AVG(CASE WHEN geo_valid THEN lon END)              AS centroid_lon,
    COUNT(DISTINCT district_raw)                       AS n_districts,
    COUNT(DISTINCT statename_clean)                    AS n_states,   -- NULL (ex-'NA') not counted
    COUNT(DISTINCT circlename)                         AS n_circles,
    MAX(pin_zone)                                      AS pin_zone,        -- constant within a PIN
    MAX(pin_zone_label)                                AS pin_zone_label,
    -- ---- folded-in raw detail (full sets the majorities collapse + geo bbox) -----
    COALESCE(sort_array(collect_set(officename)),     array())  AS office_names,      -- full office roster (representative_office is just 1)
    COALESCE(sort_array(collect_set(district_raw)),   array())  AS districts_all,     -- size = n_districts
    COALESCE(sort_array(collect_set(statename_clean)),array())  AS states_all,        -- size = n_states (empty when all-NA state)
    COALESCE(sort_array(collect_set(circlename)),     array())  AS circles_all,       -- size = n_circles
    COALESCE(sort_array(collect_set(regionname)),     array())  AS regions_all,       -- size = n_regions
    CAST(COUNT(DISTINCT regionname) AS INT)                     AS n_regions,         -- region-level parity (was missing)
    (COUNT(DISTINCT regionname) > 1)                            AS is_multi_region,   -- 33 PINs (16 single-circle)
    COALESCE(sort_array(collect_set(divisionname)),   array())  AS divisions_all,     -- size = n_divisions
    CAST(COUNT(DISTINCT divisionname) AS INT)                   AS n_divisions,       -- division-level parity (was missing)
    (COUNT(DISTINCT divisionname) > 1)                          AS is_multi_division, -- 129 PINs (112 single-circle)
    MIN(CASE WHEN geo_valid THEN lat END)                       AS lat_min,           -- geocoded bounding box ...
    MAX(CASE WHEN geo_valid THEN lat END)                       AS lat_max,
    MIN(CASE WHEN geo_valid THEN lon END)                       AS lon_min,
    MAX(CASE WHEN geo_valid THEN lon END)                       AS lon_max,
    GREATEST(
      (MAX(CASE WHEN geo_valid THEN lat END) - MIN(CASE WHEN geo_valid THEN lat END)) * 111.0,
      (MAX(CASE WHEN geo_valid THEN lon END) - MIN(CASE WHEN geo_valid THEN lon END)) * 111.0
        * COS(RADIANS(AVG(CASE WHEN geo_valid THEN lat END)))
    )                                                           AS office_span_km,    -- max bbox extent (km); >100 ~ bad coord
    CAST(SUM(CASE WHEN NOT geo_valid AND lat IS NOT NULL THEN 1 ELSE 0 END) AS INT) AS n_offices_geo_out_of_range  -- numeric-but-out-of-bounds coords
  FROM workspace.virtue_foundation_enriched.pincode_office_silver
  GROUP BY pincode
),
-- Majority district: most offices wins; tie-break = district name ASC (det.) ----
dist_maj AS (
  SELECT pincode, district_raw AS district_majority
  FROM (
    SELECT pincode, district_raw,
           ROW_NUMBER() OVER (PARTITION BY pincode
                              ORDER BY COUNT(*) DESC, district_raw ASC) AS rn
    FROM workspace.virtue_foundation_enriched.pincode_office_silver
    GROUP BY pincode, district_raw
  ) WHERE rn = 1
),
-- Majority state: ignore NULL (ex-'NA') unless that's all there is. NULLS LAST --
-- guarantees a real state always beats NULL on a tie; PINs with only NULL -> NULL.
state_maj AS (
  SELECT pincode, statename_clean AS state_majority
  FROM (
    SELECT pincode, statename_clean,
           ROW_NUMBER() OVER (PARTITION BY pincode
                              ORDER BY COUNT(*) DESC, statename_clean ASC NULLS LAST) AS rn
    FROM workspace.virtue_foundation_enriched.pincode_office_silver
    GROUP BY pincode, statename_clean
  ) WHERE rn = 1
),
-- Majority circle/region/division (org-chart pass-through), name tie-break ------
circ_maj AS (
  SELECT pincode, circlename AS circle, regionname AS region, divisionname AS division
  FROM (
    SELECT pincode, circlename, regionname, divisionname,
           ROW_NUMBER() OVER (PARTITION BY pincode
                              -- full deterministic tie-break across all 3 projected cols
                              ORDER BY COUNT(*) DESC, circlename ASC, regionname ASC, divisionname ASC) AS rn
    FROM workspace.virtue_foundation_enriched.pincode_office_silver
    GROUP BY pincode, circlename, regionname, divisionname
  ) WHERE rn = 1
),
-- Representative office (human anchor): prefer HO, then PO(Sub), then any; -------
-- final tie-break = officename ASC for determinism.
rep AS (
  SELECT pincode, officename AS representative_office
  FROM (
    SELECT pincode, officename,
           ROW_NUMBER() OVER (PARTITION BY pincode
                              ORDER BY CASE officetype
                                         WHEN 'HO' THEN 1
                                         WHEN 'PO' THEN 2
                                         ELSE 3 END,
                                       officename ASC) AS rn
    FROM workspace.virtue_foundation_enriched.pincode_office_silver
  ) WHERE rn = 1
)
SELECT
  b.pincode,
  b.pin_zone,
  b.pin_zone_label,
  -- office counts -------------------------------------------------------------
  b.n_offices,
  b.n_branch_offices,
  b.n_sub_offices,
  b.n_head_offices,
  b.n_delivery_offices,
  -- centroid + geo quality ----------------------------------------------------
  b.centroid_lat,
  b.centroid_lon,
  b.n_offices_geocoded,
  ROUND(b.n_offices_geocoded * 1.0 / b.n_offices, 4)            AS geo_coverage,
  (b.n_offices_geocoded > 0)                                    AS has_centroid,   -- false for 36 PINs
  CASE
    WHEN b.n_offices_geocoded = 0                                          THEN 'none'
    WHEN b.n_offices_geocoded * 1.0 / b.n_offices >= 0.8
         AND b.n_offices_geocoded >= 3                                     THEN 'high'
    WHEN b.n_offices_geocoded * 1.0 / b.n_offices >= 0.5
         AND b.n_offices_geocoded >= 1                                     THEN 'medium'
    ELSE 'low'
  END                                                           AS centroid_quality,
  -- district -------------------------------------------------------------------
  dm.district_majority,
  b.n_districts,
  (b.n_districts > 1)                                           AS is_multi_district,  -- 1,478 PINs (7.5%)
  -- state ----------------------------------------------------------------------
  sm.state_majority,
  b.n_states,
  (b.n_states > 1)                                              AS is_multi_state,     -- clean (52); 'NA'-raw=290
  -- circle ---------------------------------------------------------------------
  (b.n_circles > 1)                                            AS is_multi_circle,     -- 17, all AP<->Telangana
  b.n_circles,
  -- representative anchor + org-chart pass-through -----------------------------
  r.representative_office,
  cm.circle,
  cm.region,
  cm.division,
  -- folded-in raw detail: full sets behind the majorities + region/division parity + geo bbox
  b.office_names,
  b.districts_all,
  b.states_all,
  b.circles_all,
  b.regions_all,
  b.n_regions,
  b.is_multi_region,
  b.divisions_all,
  b.n_divisions,
  b.is_multi_division,
  b.lat_min,
  b.lat_max,
  b.lon_min,
  b.lon_max,
  b.office_span_km,
  b.n_offices_geo_out_of_range
FROM base b
LEFT JOIN dist_maj  dm USING (pincode)
LEFT JOIN state_maj sm USING (pincode)
LEFT JOIN circ_maj  cm USING (pincode)
LEFT JOIN rep       r  USING (pincode);

-- ---------------------------------------------------------------------------
-- PERSISTED COLUMN DESCRIPTIONS (show in DESCRIBE / Catalog Explorer / Genie).
-- NB: the inline `--` notes above are SQL source only; these ALTERs are what
-- actually attach a description to each column. Idempotent / re-runnable.
-- ---------------------------------------------------------------------------
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN pincode               COMMENT 'PRIMARY KEY. 6-digit India Post PIN code (19,586 distinct). Join key: from facilities via TRY_CAST(address_zipOrPostcode), and to the pincode_nfhs bridge view.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN pin_zone              COMMENT 'First digit of the PIN (1-9) = India Post postal zone. Cheap coarse geographic prefilter.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN pin_zone_label        COMMENT 'Human-readable region for pin_zone (e.g. "South - AP / Telangana / Karnataka").';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_offices             COMMENT 'Number of India Post offices in this PIN (avg 8.46, median 7, max 153).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_branch_offices      COMMENT 'Count of Branch Offices (officetype BO, village-level) in this PIN.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_sub_offices         COMMENT 'Count of Sub Offices in this PIN (officetype code is PO, i.e. the standard S.O - not SO).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_head_offices        COMMENT 'Count of Head Offices (officetype HO, includes GPOs) in this PIN.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_delivery_offices    COMMENT 'Count of offices that deliver mail (vs Non Delivery counter-only) in this PIN.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN centroid_lat          COMMENT 'Mean latitude of the in-bounds (geo_valid) offices = the PIN geographic anchor for distance ranking. NULL when has_centroid = false.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN centroid_lon          COMMENT 'Mean longitude of the in-bounds (geo_valid) offices. NULL when has_centroid = false.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_offices_geocoded    COMMENT 'Number of offices with valid in-India coordinates that feed the centroid.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN geo_coverage          COMMENT 'n_offices_geocoded / n_offices (0-1). Fraction of offices with usable coords - centroid reliability.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN has_centroid          COMMENT 'TRUE if the PIN has at least one valid coordinate (centroid is non-NULL). FALSE for 36 PINs - do not use their centroid.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN centroid_quality      COMMENT 'Centroid trust tier: high (coverage>=0.8 and >=3 points) / medium (>=0.5 and >=1) / low (>=1 point) / none (0).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN district_majority     COMMENT 'NFHS JOIN KEY (1 of 2). Most-common postal district among this PIN offices, UPPERCASE postal spelling. Resolve to NFHS-5 via normalize_district + district_crosswalk on (district_majority, state_majority) - ready-made in the pincode_nfhs view. Majority vote when is_multi_district.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_districts           COMMENT 'Distinct postal districts whose offices fall in this PIN.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN is_multi_district     COMMENT 'TRUE if the PIN spans more than one district (1,478 PINs / 7.5%). When TRUE, district_majority is a majority vote, not a clean 1:1.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN state_majority        COMMENT 'NFHS JOIN KEY (2 of 2). Most-common real state among offices, UPPERCASE. Pairs with district_majority for the NFHS join (state disambiguates same-name districts). NULL for 105 PINs where state is unknown (all offices had literal NA).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_states              COMMENT 'Distinct REAL states touching this PIN (literal NA is excluded, not counted).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN is_multi_state        COMMENT 'TRUE if the PIN spans more than one real state (52 PINs). Excludes the NA data artifact (the raw 290 counts NA as a state).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN is_multi_circle       COMMENT 'TRUE if the PIN spans more than one India Post Circle (17 PINs, all on the Andhra Pradesh <-> Telangana 2014-bifurcation border).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_circles             COMMENT 'Distinct India Post Circles touching this PIN.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN representative_office  COMMENT 'Human-readable anchor name for the PIN (prefers a Head Office, then Sub Office, then any) - the town label.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN circle                COMMENT 'Majority India Post Circle (org-chart unit, roughly a state). Administrative, not a geographic key.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN region                COMMENT 'Majority India Post Region (sub-circle org-chart unit).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN division              COMMENT 'Majority India Post Division (sub-region org-chart unit).';
-- folded-in raw detail (recovers what the per-PIN majorities collapsed) --------
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN office_names               COMMENT 'Sorted distinct set of all post office names in this PIN. Recovers the full roster that representative_office collapses to one name (89% of PINs have >1). officename has no nulls, so lossless.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN districts_all              COMMENT 'Sorted distinct set of all postal districts this PIN touches. Recovers the set behind district_majority for the 1,478 multi-district PINs. size = n_districts.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN states_all                 COMMENT 'Sorted distinct set of all real states this PIN touches (literal NA dropped). Recovers states behind state_majority for the 52 cross-state PINs. size = n_states (empty array for the 100 all-NA-state PINs).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN circles_all                COMMENT 'Sorted distinct set of all India Post Circles this PIN touches. Recovers the circle list for the 17 multi-circle PINs. size = n_circles.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN regions_all                COMMENT 'Sorted distinct set of all India Post Regions this PIN touches. Recovers regions behind the majority-only region column. size = n_regions.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_regions                  COMMENT 'Number of distinct India Post Regions whose offices share this PIN. Restores region-level count parity with n_districts/n_states/n_circles.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN is_multi_region            COMMENT 'True when offices in this PIN span more than one Region (33 PINs, 16 of them single-circle so invisible to is_multi_circle).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN divisions_all              COMMENT 'Sorted distinct set of all India Post Divisions this PIN touches. Recovers divisions behind the majority-only division column. size = n_divisions.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_divisions                COMMENT 'Number of distinct India Post Divisions whose offices share this PIN. The most fragmented hierarchy level (129 multi-division PINs).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN is_multi_division          COMMENT 'True when offices in this PIN span more than one Division (129 PINs, 112 of them single-circle so invisible to is_multi_circle).';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN lat_min                    COMMENT 'Minimum latitude among geocoded (geo_valid) offices in this PIN. With lat_max/lon_min/lon_max = the geocoded bounding box. NULL for the 36 PINs with no geocoded office.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN lat_max                    COMMENT 'Maximum latitude among geocoded offices in this PIN. Pairs with lat_min to bound the PIN vertically. NULL when no geocoded office.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN lon_min                    COMMENT 'Minimum longitude among geocoded offices in this PIN. Pairs with lon_max to bound the PIN horizontally. NULL when no geocoded office.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN lon_max                    COMMENT 'Maximum longitude among geocoded offices in this PIN. Completes the geocoded bounding box. NULL when no geocoded office.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN office_span_km             COMMENT 'Approximate max bounding-box extent (km) across geocoded offices - how spread out the PIN is, i.e. how trustworthy the centroid is for distance ranking. Values over ~100km usually signal a bad coordinate (see n_offices_geo_out_of_range). NULL when no geocoded office.';
ALTER TABLE workspace.virtue_foundation_enriched.gold_pincode ALTER COLUMN n_offices_geo_out_of_range COMMENT 'Count of offices with numeric but out-of-India-bounds coordinates (~2,602 such rows overall). Excluded from the centroid/bbox but flagged here. Distinct from the literal-NA case folded into geo_coverage.';

-- ---------------------------------------------------------------------------
-- VALIDATION (run after build; EXPECTED verified live 2026-06-15)
-- ---------------------------------------------------------------------------
-- SELECT
--   COUNT(*) n_pins,                                            -- 19586
--   COUNT(DISTINCT pincode) n_pins_distinct,                    -- 19586 (PK unique)
--   SUM(CASE WHEN has_centroid THEN 1 ELSE 0 END) has_centroid_true,   -- 19550
--   SUM(CASE WHEN NOT has_centroid THEN 1 ELSE 0 END) has_centroid_false, -- 36
--   SUM(CASE WHEN centroid_lat IS NULL THEN 1 ELSE 0 END) null_centroid,  -- 36
--   SUM(CASE WHEN is_multi_district THEN 1 ELSE 0 END) multi_district,    -- 1478
--   SUM(CASE WHEN is_multi_state THEN 1 ELSE 0 END) multi_state_clean,    -- 52  (raw-with-NA = 290)
--   SUM(CASE WHEN is_multi_circle THEN 1 ELSE 0 END) multi_circle,        -- 17  (all AP<->Telangana)
--   SUM(CASE WHEN state_majority IS NULL THEN 1 ELSE 0 END) state_maj_null,-- 105
--   SUM(n_offices) total_offices,                              -- 165625 (= deduped silver rows, not raw 165627)
--   SUM(n_branch_offices + n_sub_offices + n_head_offices) typed_offices, -- 165625 (BO 140268 + PO 24546 + HO 811)
--   ROUND(AVG(geo_coverage),4) avg_geo_coverage                -- ~0.928
-- FROM workspace.virtue_foundation_enriched.gold_pincode;
--
-- centroid_quality distribution  EXPECT: high 14366 / medium 3882 / low 1302 / none 36
-- SELECT centroid_quality, COUNT(*) n FROM workspace.virtue_foundation_enriched.gold_pincode
-- GROUP BY centroid_quality ORDER BY n DESC;
--
-- well-known-PIN sanity (centroid lands in the right city):
--   110001 -> ~(28.606, 77.220) NEW DELHI ;  400001 -> ~(18.936, 72.834) MUMBAI ;
--   500001 -> ~(17.425, 78.507) HYDERABAD
-- SELECT pincode, ROUND(centroid_lat,4) lat, ROUND(centroid_lon,4) lon,
--   district_majority, state_majority, representative_office, centroid_quality
-- FROM workspace.virtue_foundation_enriched.gold_pincode
-- WHERE pincode IN (110001, 400001, 500001) ORDER BY pincode;
--
-- FOLDED-IN DETAIL validation (the 16 added columns). EXPECTED all-zero mismatches.
-- SELECT
--   SUM(CASE WHEN size(districts_all)<>n_districts THEN 1 ELSE 0 END) d_par,   -- 0
--   SUM(CASE WHEN size(states_all)   <>n_states    THEN 1 ELSE 0 END) s_par,   -- 0
--   SUM(CASE WHEN size(circles_all)  <>n_circles   THEN 1 ELSE 0 END) c_par,   -- 0
--   SUM(CASE WHEN size(regions_all)  <>n_regions   THEN 1 ELSE 0 END) r_par,   -- 0
--   SUM(CASE WHEN size(divisions_all)<>n_divisions THEN 1 ELSE 0 END) v_par,   -- 0
--   SUM(CASE WHEN office_names IS NULL THEN 1 ELSE 0 END) null_arrays,         -- 0 (COALESCE to array())
--   SUM(CASE WHEN is_multi_region   THEN 1 ELSE 0 END) multi_region,          -- 33  (16 single-circle)
--   SUM(CASE WHEN is_multi_division THEN 1 ELSE 0 END) multi_division,        -- 129 (112 single-circle)
--   SUM(CASE WHEN lat_min IS NULL THEN 1 ELSE 0 END) null_bbox                -- 36  (= has_centroid=false)
-- FROM workspace.virtue_foundation_enriched.gold_pincode;
