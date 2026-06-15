-- ============================================================================
-- 10  pincode_office_silver  —  office-grain clean base (one row per post office)
-- Plan: ideas/02-pincode-enrichment-plan.md  (Step 1)
--
-- Source: india_post_pincode_directory (READ-ONLY Delta Share).
-- Output: workspace.virtue_foundation_enriched.pincode_office_silver  (~165,625 rows)
--   (the source catalog databricks_virtue_foundation_dataset_dais_2026 is a
--    read-only Delta Sharing catalog, so the enriched layer lives in `workspace`.)
--
-- Produces ONE typed, cleaned row per office. Literal-'NA' missingness -> SQL NULL;
-- coordinates typed + bounds-flagged (NOT dropped); 2 exact-duplicate rows removed.
-- The per-PIN gold table (11) aggregates this into one row per pincode.
-- Idempotent / re-runnable. All counts verified live on warehouse 3d472a8f72349193.
-- ============================================================================
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.pincode_office_silver
COMMENT 'Office-grain silver: one typed, cleaned row per India Post office. Clean base for the per-PIN gold centroid table. Built from india_post_pincode_directory; literal-NA missingness normalized to SQL NULL; coordinates typed + bounds-flagged (not dropped); exact-duplicate office rows removed via DISTINCT.'
AS
WITH src AS (
  -- DISTINCT removes 2 fully-identical office rows (see validation #4).
  -- Every source column is clean string/bigint; DISTINCT over all 11 columns
  -- is the safe dedup because no surrogate / load-time columns exist here.
  SELECT DISTINCT
    circlename, regionname, divisionname, officename, pincode,
    officetype, delivery, district, statename, latitude, longitude
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
)
SELECT
  -- 1. keys / pass-through ---------------------------------------------------
  pincode,                                                                       -- BIGINT, already clean (0 nulls, all 6-digit)
  TRIM(REGEXP_REPLACE(officename, '\\s+', ' '))               AS officename,     -- collapse internal double-spaces + trim (763 rows changed)
  NULLIF(NULLIF(NULLIF(TRIM(circlename),   ''), 'NA'), 'null') AS circlename,    -- India Post Circle (~ state)
  NULLIF(NULLIF(NULLIF(TRIM(regionname),   ''), 'NA'), 'null') AS regionname,    -- Region (sub-circle)
  NULLIF(NULLIF(NULLIF(TRIM(divisionname), ''), 'NA'), 'null') AS divisionname,  -- Division (sub-region)

  -- 2. officetype decode (raw preserved) -------------------------------------
  officetype,                                                                    -- raw code BO / PO / HO
  CASE officetype
       WHEN 'BO' THEN 'Branch Office'   -- village-level
       WHEN 'PO' THEN 'Sub Office'      -- the standard "S.O"  (NOTE: code is PO, not SO)
       WHEN 'HO' THEN 'Head Office'     -- incl. G.P.O
       ELSE NULL END                                          AS office_class,   -- NULL = unmapped (0 today; future-proof)

  -- 3. delivery flag ---------------------------------------------------------
  (delivery = 'Delivery')                                     AS is_delivery,    -- TRUE delivers mail; only Delivery / Non Delivery exist

  -- 4. district + state cleaning ---------------------------------------------
  UPPER(TRIM(district))                                       AS district_raw,   -- UPPERCASE postal spelling; crosswalk applied later (gold/NFHS join)
  CASE WHEN UPPER(TRIM(statename)) IN ('NA','NULL','')
       THEN NULL ELSE UPPER(TRIM(statename)) END              AS statename_clean,-- literal 'NA' (715 offices) -> real NULL

  -- 5. coordinates (typed + bounds flag, rows NOT dropped) -------------------
  TRY_CAST(latitude  AS DOUBLE)                               AS lat,            -- 'NA'/junk -> NULL
  TRY_CAST(longitude AS DOUBLE)                               AS lon,            -- 'NA'/junk -> NULL
  COALESCE( TRY_CAST(latitude  AS DOUBLE) BETWEEN 6 AND 37.5
    AND TRY_CAST(longitude AS DOUBLE) BETWEEN 68 AND 97.5, FALSE) AS geo_valid,  -- TRUE = parse + inside India bounds; COALESCE so NA/junk -> FALSE, never NULL (gate, don't drop)

  -- 6. postal zone -----------------------------------------------------------
  CAST(SUBSTRING(CAST(pincode AS STRING), 1, 1) AS INT)       AS pin_zone,       -- first PIN digit 1-9
  CASE SUBSTRING(CAST(pincode AS STRING), 1, 1)
       WHEN '1' THEN 'North (Delhi/HR/PB/HP/JK/CH)'
       WHEN '2' THEN 'UP / Uttarakhand'
       WHEN '3' THEN 'Rajasthan / Gujarat / DD&DNH'
       WHEN '4' THEN 'Maharashtra / MP / Chhattisgarh / Goa'
       WHEN '5' THEN 'South - AP / Telangana / Karnataka'
       WHEN '6' THEN 'Kerala / Tamil Nadu'
       WHEN '7' THEN 'East - WB / Odisha / NE / A&N'
       WHEN '8' THEN 'Bihar / Jharkhand'
       WHEN '9' THEN 'Army Postal Service (APS)'
       ELSE NULL END                                          AS pin_zone_label
FROM src;

-- ---------------------------------------------------------------------------
-- VALIDATION (run after build; EXPECTED counts verified live 2026-06-15)
-- ---------------------------------------------------------------------------
-- 1) row count + key distributions
--   out_rows=165625 · distinct_pins=19586 · geo_valid_true=150999 ·
--   statename_null=715 · delivery_true=157899 · office_class_unmapped=0 · zones 1..9
-- SELECT COUNT(*) out_rows, COUNT(DISTINCT pincode) distinct_pins,
--   SUM(CASE WHEN geo_valid THEN 1 ELSE 0 END) geo_valid_true,
--   SUM(CASE WHEN statename_clean IS NULL THEN 1 ELSE 0 END) statename_null,
--   SUM(CASE WHEN is_delivery THEN 1 ELSE 0 END) delivery_true,
--   SUM(CASE WHEN office_class IS NULL THEN 1 ELSE 0 END) office_class_unmapped,
--   MIN(pin_zone) min_zone, MAX(pin_zone) max_zone
-- FROM workspace.virtue_foundation_enriched.pincode_office_silver;
--
-- 2) office_class decode integrity  EXPECT: Branch Office 140268 / Sub Office 24546 / Head Office 811
--    (both deduped rows are BO; source BO 140270 -> 140268; PO 24546 / HO 811 unchanged)
-- SELECT office_class, officetype, COUNT(*) n
-- FROM workspace.virtue_foundation_enriched.pincode_office_silver
-- GROUP BY office_class, officetype ORDER BY n DESC;
--
-- 3) no residual literal-missing leaked  EXPECT: 0
-- SELECT COUNT(*) leaked FROM workspace.virtue_foundation_enriched.pincode_office_silver
-- WHERE statename_clean IN ('NA','null','') OR officename RLIKE '  ' OR officename <> TRIM(officename);
--
-- 4) dedup proof: no exact duplicates remain  EXPECT: 0 rows
-- SELECT pincode, officename, officetype, district_raw, lat, lon, COUNT(*) n
-- FROM workspace.virtue_foundation_enriched.pincode_office_silver
-- GROUP BY ALL HAVING COUNT(*) > 1;
