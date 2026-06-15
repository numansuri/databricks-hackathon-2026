-- ============================================================================
-- 12  district_crosswalk + normalize fns + pincode_nfhs view
-- Plan: ideas/02-pincode-enrichment-plan.md  (Step 3 — the NFHS bridge)
--
-- Turns a postal district name (modern, UPPERCASE) into the matching NFHS-5
-- district health row (older, Title-Case, 2019-21 spelling).
-- Two-tier resolution: (1) normalize-exact closes 597 districts; (2) the 103-row
-- crosswalk closes the rest -> 705/706 NFHS (district,state) tuples resolve (100% of
-- reachable; the 1 residual is an NFHS data error -- Chandel listed under Mizoram as
-- well as its correct Manipur row -- and is unreachable from postal geography).
-- Idempotent. Verified live 2026-06-15 (warehouse 3d472a8f72349193).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 12a  normalize_district(name): case/whitespace/&/punctuation ONLY.
--      Apply identically to BOTH sides of the join. Deliberately does NOT strip
--      trailing RURAL/URBAN/DISTRICT -- those distinguish REAL separate districts
--      (Bengaluru Urban vs Rural; Warangal-vs-Hanumakonda lineage). Stripping them
--      would fan out / drop NFHS rows. The handful of cosmetic suffix cases
--      (Lakshadweep DISTRICT, Sikkim double-space) and all renames/transliterations/
--      word-reorders are handled by explicit crosswalk rows (12c), not here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workspace.virtue_foundation_enriched.normalize_district(name STRING)
RETURNS STRING
RETURN
  TRIM(
    REGEXP_REPLACE(                                  -- 5. collapse whitespace runs -> single space
      REGEXP_REPLACE(                                -- 4. separators '-' '/' surrounded by spaces -> single space
        REGEXP_REPLACE(                              -- 3. strip parentheses, keep content: 'LEH(LADAKH)' -> 'LEH LADAKH'
          REPLACE(REPLACE(                           -- 2. '&' (with/without spaces) -> ' AND '
            UPPER(TRIM(name)),                       -- 1. uppercase + outer trim
            ' & ', ' AND '), '&', ' AND '),
          '[\\(\\)]', ' '),
        '\\s*[-/]\\s*', ' '),
      '\\s+', ' ')
  );

-- ---------------------------------------------------------------------------
-- 12b  normalize_state(name): case/&, plus the known NFHS<->postal state diffs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workspace.virtue_foundation_enriched.normalize_state(name STRING)
RETURNS STRING
RETURN
  CASE UPPER(TRIM(REPLACE(REPLACE(name,' & ',' AND '),'&',' AND ')))
    WHEN 'MAHARASTRA'                                   THEN 'MAHARASHTRA'   -- NFHS misspelling
    WHEN 'NCT OF DELHI'                                 THEN 'DELHI'          -- NFHS label -> postal 'DELHI'
    WHEN 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU' THEN 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU'
    WHEN 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU'     THEN 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU'
    ELSE UPPER(TRIM(REPLACE(REPLACE(name,' & ',' AND '),'&',' AND ')))
  END;

-- ---------------------------------------------------------------------------
-- 12c  district_crosswalk: the 103 non-exact mappings (NFHS old -> postal modern).
--      Stores ONLY non-exact rows; the 597 exact districts need no row.
--      Every postal target verified to exist live (0 dangling). match_type:
--      rename | spelling | punctuation | split ; confidence: high | medium | low.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.district_crosswalk
COMMENT 'Postal-district -> NFHS-5-district crosswalk (103 non-exact mappings: renames, transliterations, punctuation). Exact-name districts resolve via normalize_district and are not stored here. State is part of the key (disambiguates same-name districts across states). Resolves 705 of 706 NFHS (district,state) tuples; the 1 residual is a known NFHS mislabel (Chandel listed under Mizoram as well as its correct Manipur row) and is unreachable from postal geography.'
AS
SELECT * FROM VALUES
 -- (nfhs_district [UPPER], nfhs_state [Title], postal_district [UPPER], postal_state [UPPER], match_type, confidence)
 -- ===== Andaman & Nicobar Islands =====
 ('NORTH & MIDDLE ANDAMAN','Andaman & Nicobar Islands','NORTH AND MIDDLE ANDAMAN','ANDAMAN AND NICOBAR ISLANDS','punctuation','high'),
 ('SOUTH ANDAMAN','Andaman & Nicobar Islands','SOUTH ANDAMANS','ANDAMAN AND NICOBAR ISLANDS','spelling','high'),
 -- ===== Andhra Pradesh =====
 ('SRI POTTI SRIRAMULU NELLO','Andhra Pradesh','SPSR NELLORE','ANDHRA PRADESH','rename','high'),     -- NFHS value truncated; SPSR = Sri Potti Sriramulu
 ('VISAKHAPATNAM','Andhra Pradesh','VISAKHAPATANAM','ANDHRA PRADESH','spelling','high'),             -- postal typo 'VISAKHAPATANAM'
 -- ===== Assam =====
 ('KAMRUP METROPOLITAN','Assam','KAMRUP METRO','ASSAM','spelling','high'),
 ('MORIGAON','Assam','MARIGAON','ASSAM','spelling','high'),
 -- ===== Bihar =====
 ('PURBA CHAMPARAN','Bihar','PURBI CHAMPARAN','BIHAR','spelling','high'),
 -- ===== Chhattisgarh =====
 ('JANJGIR - CHAMPA','Chhattisgarh','JANJGIR-CHAMPA','CHHATTISGARH','punctuation','high'),
 ('KABEERDHAM','Chhattisgarh','KABIRDHAM','CHHATTISGARH','spelling','high'),
 ('KODAGAON','Chhattisgarh','KONDAGAON','CHHATTISGARH','spelling','high'),                           -- NFHS 'KODAGAON' = Kondagaon
 ('KORIYA','Chhattisgarh','KOREA','CHHATTISGARH','spelling','medium'),                               -- SPLIT note (12 doc C.4): Koriya -> Korea + MCB
 ('UTTAR BASTAR KANKER','Chhattisgarh','KANKER','CHHATTISGARH','rename','high'),
 -- ===== Dadra & Nagar Haveli and Daman & Diu =====
 ('DADRA & NAGAR HAVELI','Dadra and Nagar Haveli & Daman and Diu','DADRA AND NAGAR HAVELI','THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU','punctuation','high'),
 -- ===== Gujarat =====
 ('ARAVALI','Gujarat','ARVALLI','GUJARAT','spelling','high'),
 ('CHHOTA UDAIPUR','Gujarat','CHHOTAUDEPUR','GUJARAT','spelling','high'),
 ('THE DANGS','Gujarat','DANG','GUJARAT','spelling','high'),
 -- ===== Haryana =====
 ('CHARKHI DADRI','Haryana','CHARKI DADRI','HARYANA','spelling','high'),
 ('GURGAON','Haryana','GURUGRAM','HARYANA','rename','high'),                                         -- official 2016 rename
 ('MEWAT','Haryana','NUH','HARYANA','rename','high'),                                                -- Mewat -> Nuh (2016)
 -- ===== Himachal Pradesh =====
 ('LAHUL & SPITI','Himachal Pradesh','LAHUL AND SPITI','HIMACHAL PRADESH','punctuation','high'),
 -- ===== Jammu & Kashmir =====
 ('BADGAM','Jammu & Kashmir','BUDGAM','JAMMU AND KASHMIR','spelling','high'),
 ('BANDIPORE','Jammu & Kashmir','BANDIPORA','JAMMU AND KASHMIR','spelling','high'),
 ('BARAMULA','Jammu & Kashmir','BARAMULLA','JAMMU AND KASHMIR','spelling','high'),
 ('PUNCH','Jammu & Kashmir','POONCH','JAMMU AND KASHMIR','spelling','high'),
 ('SHUPIYAN','Jammu & Kashmir','SHOPIAN','JAMMU AND KASHMIR','spelling','high'),
 -- ===== Jharkhand =====
 ('KODARMA','Jharkhand','KODERMA','JHARKHAND','spelling','high'),
 ('PASHCHIMI SINGHBHUM','Jharkhand','WEST SINGHBHUM','JHARKHAND','rename','high'),
 ('PURBI SINGHBHUM','Jharkhand','EAST SINGHBUM','JHARKHAND','rename','high'),                        -- postal also misspells 'SINGHBUM'
 ('SAHIBGANJ','Jharkhand','SAHEBGANJ','JHARKHAND','spelling','high'),
 ('SARAIKELA-KHARSAWAN','Jharkhand','SARAIKELA KHARSAWAN','JHARKHAND','punctuation','high'),
 -- ===== Karnataka (the big rename cluster) =====
 ('BANGALORE','Karnataka','BENGALURU URBAN','KARNATAKA','rename','high'),                            -- C.4: Bangalore -> Bengaluru Urban
 ('BANGALORE RURAL','Karnataka','BENGALURU RURAL','KARNATAKA','rename','high'),
 ('BELGAUM','Karnataka','BELAGAVI','KARNATAKA','rename','high'),
 ('BELLARY','Karnataka','BALLARI','KARNATAKA','rename','high'),
 ('CHAMARAJANAGAR','Karnataka','CHAMARAJANAGARA','KARNATAKA','spelling','high'),
 ('CHIKMAGALUR','Karnataka','CHIKKAMAGALURU','KARNATAKA','rename','high'),
 ('DAVANAGERE','Karnataka','DAVANGERE','KARNATAKA','spelling','high'),
 ('BIJAPUR','Karnataka','VIJAYAPURA','KARNATAKA','rename','high'),                                   -- Bijapur(KA) -> Vijayapura (2014); state key essential
 ('GULBARGA','Karnataka','KALABURAGI','KARNATAKA','rename','high'),
 ('MYSORE','Karnataka','MYSURU','KARNATAKA','rename','high'),
 ('SHIMOGA','Karnataka','SHIVAMOGGA','KARNATAKA','rename','high'),
 ('TUMKUR','Karnataka','TUMAKURU','KARNATAKA','rename','high'),
 -- ===== Ladakh =====
 ('LEH(LADAKH)','Ladakh','LEH LADAKH','LADAKH','punctuation','high'),
 -- ===== Lakshadweep =====
 ('LAKSHADWEEP','Lakshadweep','LAKSHADWEEP DISTRICT','LAKSHADWEEP','spelling','high'),
 -- ===== Madhya Pradesh =====
 ('KHANDWA (EAST NIMAR)','Madhya Pradesh','EAST NIMAR','MADHYA PRADESH','rename','high'),
 ('KHARGONE (WEST NIMAR)','Madhya Pradesh','KHARGONE','MADHYA PRADESH','rename','high'),
 ('NARSIMHAPUR','Madhya Pradesh','NARSINGHPUR','MADHYA PRADESH','spelling','high'),
 -- ===== Maharashtra =====
 ('AHMADNAGAR','Maharastra','AHMEDNAGAR','MAHARASHTRA','spelling','high'),
 ('BID','Maharastra','BEED','MAHARASHTRA','spelling','high'),
 ('BULDANA','Maharastra','BULDHANA','MAHARASHTRA','spelling','high'),
 ('GONDIYA','Maharastra','GONDIA','MAHARASHTRA','spelling','high'),
 ('RAIGARH','Maharastra','RAIGAD','MAHARASHTRA','spelling','high'),                                  -- RAIGARH(MH) -> RAIGAD; RAIGARH also in CG, state key essential
 -- ===== Meghalaya =====
 ('EAST JANTIA HILLS','Meghalaya','EAST JAINTIA HILLS','MEGHALAYA','spelling','high'),
 ('RIBHOI','Meghalaya','RI BHOI','MEGHALAYA','spelling','high'),
 -- ===== Odisha =====
 ('BAUDH','Odisha','BOUDH','ODISHA','spelling','high'),
 ('DEBAGARH','Odisha','DEOGARH','ODISHA','spelling','high'),
 ('NABARANGAPUR','Odisha','NABARANGPUR','ODISHA','spelling','high'),
 ('SUBARNAPUR','Odisha','SONEPUR','ODISHA','rename','medium'),                                       -- Subarnapur == Sonepur
 -- ===== Puducherry =====
 ('PUDUCHERRY','Puducherry','PONDICHERRY','PUDUCHERRY','rename','high'),
 -- ===== Punjab =====
 ('FIROZPUR','Punjab','FIROZEPUR','PUNJAB','spelling','high'),
 ('MUKTSAR','Punjab','SRI MUKTSAR SAHIB','PUNJAB','rename','high'),
 ('SAHIBZADA AJIT SINGH NAGAR','Punjab','S.A.S NAGAR','PUNJAB','rename','high'),                     -- a.k.a. Mohali
 -- ===== Rajasthan =====
 ('CHITTAURGARH','Rajasthan','CHITTORGARH','RAJASTHAN','spelling','high'),
 ('DHAULPUR','Rajasthan','DHOLPUR','RAJASTHAN','spelling','high'),
 ('JALOR','Rajasthan','JALORE','RAJASTHAN','spelling','high'),
 ('JHUNJHUNUN','Rajasthan','JHUNJHUNU','RAJASTHAN','spelling','high'),
 -- ===== Sikkim =====
 ('NORTH  DISTRICT','Sikkim','NORTH DISTRICT','SIKKIM','spelling','high'),                           -- NFHS has a double space
 -- ===== Tamil Nadu =====
 ('KANCHEEPURAM','Tamil Nadu','KANCHIPURAM','TAMIL NADU','spelling','high'),
 ('THOOTHUKKUDI','Tamil Nadu','TUTICORIN','TAMIL NADU','rename','high'),
 ('VILUPPURAM','Tamil Nadu','VILLUPURAM','TAMIL NADU','spelling','high'),
 -- ===== Telangana =====
 ('KOMARAM BHEEM ASIFABAD','Telangana','KUMURAM BHEEM ASIFABAD','TELANGANA','spelling','high'),
 ('MEDCHAL-MALKAJGIRI','Telangana','MEDCHAL MALKAJGIRI','TELANGANA','punctuation','high'),
 ('WARANGAL URBAN','Telangana','HANUMAKONDA','TELANGANA','rename','high'),                           -- Warangal Urban -> Hanumakonda (2021)
 ('WARANGAL RURAL','Telangana','WARANGAL','TELANGANA','rename','high'),                              -- Warangal Rural -> Warangal (2021)
 -- ===== Uttar Pradesh =====
 ('ALLAHABAD','Uttar Pradesh','PRAYAGRAJ','UTTAR PRADESH','rename','high'),                          -- 2018 rename
 ('BARA BANKI','Uttar Pradesh','BARABANKI','UTTAR PRADESH','spelling','high'),
 ('FAIZABAD','Uttar Pradesh','AYODHYA','UTTAR PRADESH','rename','high'),                             -- 2018 rename
 ('JYOTIBA PHULE NAGAR','Uttar Pradesh','AMROHA','UTTAR PRADESH','rename','high'),
 ('KANSHIRAM NAGAR','Uttar Pradesh','KASGANJ','UTTAR PRADESH','rename','high'),
 ('KUSHINAGAR','Uttar Pradesh','KUSHI NAGAR','UTTAR PRADESH','spelling','high'),
 ('MAHAMAYA NAGAR','Uttar Pradesh','HATHRAS','UTTAR PRADESH','rename','high'),
 ('MAHRAJGANJ','Uttar Pradesh','MAHARAJGANJ','UTTAR PRADESH','spelling','high'),
 ('SANT KABIR NAGAR','Uttar Pradesh','SANT KABEER NAGAR','UTTAR PRADESH','spelling','high'),
 ('SANT RAVIDAS NAGAR (BHADOHI)','Uttar Pradesh','BHADOHI','UTTAR PRADESH','rename','high'),
 ('SHRAWASTI','Uttar Pradesh','SHRAVASTI','UTTAR PRADESH','spelling','high'),
 ('SIDDHARTHNAGAR','Uttar Pradesh','SIDDHARTH NAGAR','UTTAR PRADESH','spelling','high'),
 -- ===== Uttarakhand =====
 ('GARHWAL','Uttarakhand','PAURI GARHWAL','UTTARAKHAND','rename','high'),
 ('HARDWAR','Uttarakhand','HARIDWAR','UTTARAKHAND','spelling','high'),
 ('RUDRAPRAYAG','Uttarakhand','RUDRA PRAYAG','UTTARAKHAND','spelling','high'),
 ('UDHAM SINGH NAGAR','Uttarakhand','UDAM SINGH NAGAR','UTTARAKHAND','spelling','high'),
 ('UTTARKASHI','Uttarakhand','UTTAR KASHI','UTTARAKHAND','spelling','high'),
 -- ===== West Bengal (transliteration + word-reorder cluster) =====
 ('DAKSHIN DINAJPUR','West Bengal','DINAJPUR DAKSHIN','WEST BENGAL','rename','high'),                -- word reorder (Dakshin=South)
 ('DARJILING','West Bengal','DARJEELING','WEST BENGAL','spelling','high'),
 ('HAORA','West Bengal','HOWRAH','WEST BENGAL','rename','high'),
 ('HUGLI','West Bengal','HOOGHLY','WEST BENGAL','rename','high'),
 ('KOCH BIHAR','West Bengal','COOCHBEHAR','WEST BENGAL','spelling','high'),
 ('NORTH TWENTY FOUR PARGANA','West Bengal','24 PARAGANAS NORTH','WEST BENGAL','rename','high'),
 ('PASCHIM BARDDHAMAN','West Bengal','PASCHIM BARDHAMAN','WEST BENGAL','spelling','high'),           -- NFHS double-d typo
 ('PASCHIM MEDINIPUR','West Bengal','MEDINIPUR WEST','WEST BENGAL','rename','high'),
 ('PURBA MEDINIPUR','West Bengal','MEDINIPUR EAST','WEST BENGAL','rename','high'),
 ('PURULIYA','West Bengal','PURULIA','WEST BENGAL','spelling','high'),
 ('SOUTH TWENTY FOUR PARGANA','West Bengal','24 PARAGANAS SOUTH','WEST BENGAL','rename','high'),
 ('UTTAR DINAJPUR','West Bengal','DINAJPUR UTTAR','WEST BENGAL','rename','high')                     -- Uttar=North, reorder
 AS district_crosswalk(nfhs_district, nfhs_state, postal_district, postal_state, match_type, confidence);

-- 12c-validation: every postal target must exist live  EXPECT dangling_targets = 0
-- SELECT COUNT(*) AS dangling_targets
-- FROM workspace.virtue_foundation_enriched.district_crosswalk c
-- LEFT JOIN (
--   SELECT DISTINCT UPPER(TRIM(district)) pd, UPPER(TRIM(statename)) ps
--   FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
--   WHERE statename <> 'NA'
-- ) p ON UPPER(TRIM(c.postal_district)) = p.pd AND UPPER(TRIM(c.postal_state)) = p.ps
-- WHERE p.pd IS NULL;

-- ---------------------------------------------------------------------------
-- 12d  pincode_nfhs view: pincode_gold -> NFHS health row.
--      Tier 1 (exact-normalized) resolves 597; Tier 2 (crosswalk) catches the 101.
--      COALESCE makes Tier 2 a pure fallback. State is in the key on both tiers.
--      nf is deduped to ONE row per (normalized district, normalized state) so the
--      join can never fan out a pincode into multiple NFHS rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW workspace.virtue_foundation_enriched.pincode_nfhs AS
WITH nf_keyed AS (
  SELECT
    workspace.virtue_foundation_enriched.normalize_district(district_name) AS nfhs_nd,
    workspace.virtue_foundation_enriched.normalize_state(state_ut)         AS nfhs_ns,
    *
  FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators
),
nf AS (   -- defensive dedupe: keep one NFHS row per (normalized district, normalized state)
  SELECT * EXCEPT (rn) FROM (
    SELECT nf_keyed.*,
           ROW_NUMBER() OVER (PARTITION BY nfhs_nd, nfhs_ns ORDER BY district_name) AS rn
    FROM nf_keyed
  ) WHERE rn = 1
),
xwalk AS (
  SELECT
    workspace.virtue_foundation_enriched.normalize_district(postal_district) AS postal_nd,
    workspace.virtue_foundation_enriched.normalize_state(postal_state)       AS postal_ns,
    workspace.virtue_foundation_enriched.normalize_district(nfhs_district)   AS nfhs_nd,
    workspace.virtue_foundation_enriched.normalize_state(nfhs_state)         AS nfhs_ns,
    match_type, confidence
  FROM workspace.virtue_foundation_enriched.district_crosswalk
)
SELECT
  g.pincode,
  g.district_majority,
  g.state_majority,
  (nf.district_name IS NOT NULL)         AS has_nfhs_match,         -- FALSE = no NFHS row (e.g. the 49 post-survey new districts)
  -- provenance is NULL when nothing joined, so 'exact'/'high' never lies about a miss
  CASE WHEN nf.district_name IS NULL THEN NULL
       ELSE COALESCE(x.match_type, 'exact') END AS nfhs_match_type,        -- 'exact' | rename | spelling | punctuation
  CASE WHEN nf.district_name IS NULL THEN NULL
       ELSE COALESCE(x.confidence, 'high') END  AS nfhs_match_confidence,
  nf.* EXCEPT (nfhs_nd, nfhs_ns)                                    -- all NFHS health indicator columns (all NULL when unmatched)
FROM workspace.virtue_foundation_enriched.pincode_gold g
LEFT JOIN xwalk x
  ON  workspace.virtue_foundation_enriched.normalize_district(g.district_majority) = x.postal_nd
  AND workspace.virtue_foundation_enriched.normalize_state(g.state_majority)       = x.postal_ns
LEFT JOIN nf
  ON  nf.nfhs_nd = COALESCE(x.nfhs_nd, workspace.virtue_foundation_enriched.normalize_district(g.district_majority))
  AND nf.nfhs_ns = COALESCE(x.nfhs_ns, workspace.virtue_foundation_enriched.normalize_state(g.state_majority));

-- ---------------------------------------------------------------------------
-- 12-validations (all verified live 2026-06-15; EXPECTED inline)
-- ---------------------------------------------------------------------------
-- A) crosswalk postal keys unique -> the view CANNOT fan out a pincode. EXPECT 0.
-- SELECT COUNT(*) - COUNT(DISTINCT concat_ws('||',
--          workspace.virtue_foundation_enriched.normalize_district(postal_district),
--          workspace.virtue_foundation_enriched.normalize_state(postal_state))) AS dup_postal_keys
-- FROM workspace.virtue_foundation_enriched.district_crosswalk;
--
-- B) crosswalk never MISROUTES an exact match. 8 postal keys also equal an exact NFHS key,
--    but all are punctuation/whitespace rows normalize already collapses -> they route to the
--    SAME nfhs key (harmless). A HARMFUL collision would route to a DIFFERENT key. EXPECT 0.
-- WITH xw AS (SELECT workspace.virtue_foundation_enriched.normalize_district(postal_district) p_nd,
--                    workspace.virtue_foundation_enriched.normalize_state(postal_state) p_ns,
--                    workspace.virtue_foundation_enriched.normalize_district(nfhs_district)   x_nd,
--                    workspace.virtue_foundation_enriched.normalize_state(nfhs_state)         x_ns
--             FROM workspace.virtue_foundation_enriched.district_crosswalk),
--      nf AS (SELECT DISTINCT workspace.virtue_foundation_enriched.normalize_district(district_name) nd,
--                            workspace.virtue_foundation_enriched.normalize_state(state_ut) ns
--             FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators)
-- SELECT COUNT(*) AS harmful_misroute_collisions
-- FROM xw JOIN nf ON xw.p_nd=nf.nd AND xw.p_ns=nf.ns WHERE NOT (xw.x_nd=nf.nd AND xw.x_ns=nf.ns);
--
-- C) coverage keyed on (district, STATE) tuples -- state matters (AURANGABAD in MH & BR, etc.)
--    EXPECT nfhs_total=706 · nfhs_resolved=705 · postal_total=754 · postal_mapped=705
--    The 1 NFHS miss = NFHS's own error: 'Chandel' is listed under BOTH Manipur (correct,
--    resolves) and Mizoram (wrong -> unreachable orphan, no postal CHANDEL in Mizoram).
--    The 49 unmapped postal tuples = districts created after NFHS-5 fieldwork (no health data).
-- WITH nf AS (SELECT DISTINCT workspace.virtue_foundation_enriched.normalize_district(district_name) nd,
--                            workspace.virtue_foundation_enriched.normalize_state(state_ut) ns
--             FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators),
--      po AS (SELECT DISTINCT workspace.virtue_foundation_enriched.normalize_district(district) nd,
--                            workspace.virtue_foundation_enriched.normalize_state(statename) ns
--             FROM databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory
--             WHERE statename <> 'NA'),
--      xw_n AS (SELECT DISTINCT workspace.virtue_foundation_enriched.normalize_district(nfhs_district) nd,
--                              workspace.virtue_foundation_enriched.normalize_state(nfhs_state) ns
--               FROM workspace.virtue_foundation_enriched.district_crosswalk),
--      xw_p AS (SELECT DISTINCT workspace.virtue_foundation_enriched.normalize_district(postal_district) nd,
--                              workspace.virtue_foundation_enriched.normalize_state(postal_state) ns
--               FROM workspace.virtue_foundation_enriched.district_crosswalk)
-- SELECT (SELECT COUNT(*) FROM nf) AS nfhs_total,
--   (SELECT COUNT(*) FROM nf WHERE EXISTS (SELECT 1 FROM po   WHERE po.nd=nf.nd   AND po.ns=nf.ns)
--                               OR EXISTS (SELECT 1 FROM xw_n WHERE xw_n.nd=nf.nd AND xw_n.ns=nf.ns)) AS nfhs_resolved,
--   (SELECT COUNT(*) FROM po) AS postal_total,
--   (SELECT COUNT(*) FROM po WHERE EXISTS (SELECT 1 FROM nf   WHERE nf.nd=po.nd   AND nf.ns=po.ns)
--                               OR EXISTS (SELECT 1 FROM xw_p WHERE xw_p.nd=po.nd AND xw_p.ns=po.ns)) AS postal_mapped;
