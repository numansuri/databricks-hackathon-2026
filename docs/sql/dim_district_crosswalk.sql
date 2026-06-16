-- ============================================================================
-- dim_district_crosswalk
-- Bridges POSTAL-derived district (gold_facilities.district_approx, UPPERCASE,
-- modern spelling) to NFHS district (gold_nfhs_district.district_name_norm,
-- Title-Case, older spelling). Grain: one row per (postal_district, state) pair.
--
-- Match tiers (priority exact > rename > fuzzy > geo):
--   exact  : normalized district equal within same canonical state   (conf 1.0)
--   rename : curated post-2014 renames / transliterations /
--            city->parent-district pairs                             (conf 0.97)
--   fuzzy  : best same-state NFHS district by levenshtein similarity,
--            accepted when similarity >= 0.72             (conf = similarity)
--   geo    : pincode-propagated. For a still-unresolved (postal_district,state),
--            take the dominant NFHS district that the SAME pincodes resolve to
--            among already-matched facilities. Authoritative geo key; recovers
--            metro localities / towns that are not NFHS district names and even
--            corrects mislabeled states (e.g. Hyderabad tagged Andhra Pradesh).
--            Accepted when pincode agreement >= 0.50. Emitted as match_method
--            'fuzzy' (schema allows only exact|rename|fuzzy) with
--            confidence = agreement share, capped at 0.90 to stay below rename.
--
-- Normalization (both sides): upper -> '&'->'AND' -> regexp_replace('[^A-Z0-9]','').
-- States canonicalized to the NFHS normalized form (note NFHS keeps '&'->'AND',
-- so e.g. Jammu & Kashmir -> JAMMUANDKASHMIR, NOT JAMMUKASHMIR).
--
-- NOTE: combine tiers with LEFT JOIN + COALESCE, NOT correlated NOT EXISTS with
-- the null-safe '<=>' operator -- Spark mis-decorrelates that and silently drops
-- all matched rows.
-- ============================================================================
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.dim_district_crosswalk AS
WITH
nfhs AS (
  SELECT DISTINCT district_name_norm, state_ut_norm,
    regexp_replace(replace(upper(district_name_norm),'&','AND'),'[^A-Z0-9]','') AS d_norm,
    regexp_replace(replace(upper(state_ut_norm),'&','AND'),'[^A-Z0-9]','')      AS s_norm
  FROM workspace.virtue_foundation_enriched.gold_nfhs_district
),
-- canonical-state expression, reused for postal districts AND for facilities
fac AS (
  SELECT district_approx, address_state, pincode_clean, is_probable_duplicate,
    regexp_replace(replace(upper(district_approx),'&','AND'),'[^A-Z0-9]','') AS p_d_norm,
    CASE
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('DELHI','NEWDELHI','NCT','NCTDELHI','NCTOFDELHI','DELHINCR','NCRDELHI','DL','EASTDELHI','SOUTHDELHI','WESTDELHI','NORTHWESTDELHI','SOUTHEASTDELHIAREA') THEN 'NCTOFDELHI'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('ORISSA') THEN 'ODISHA'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('PONDICHERRY','UTOFPUDUCHERRY') THEN 'PUDUCHERRY'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('CHATTISGARH','CG') THEN 'CHHATTISGARH'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('TELENGANA','TS') THEN 'TELANGANA'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('UP','UTTRANCHAL','UTTARPRADESH') THEN 'UTTARPRADESH'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('UTTARANCHAL','UK') THEN 'UTTARAKHAND'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('MP','MADHYA') THEN 'MADHYAPRADESH'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('MH','MS') THEN 'MAHARASHTRA'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('GJ') THEN 'GUJARAT'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('BR') THEN 'BIHAR'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('JAMMUANDKASHMIR','JAMMUKASHMIR','JAMMUJK','KASHMIR','SRINAGARKASHMIR') THEN 'JAMMUANDKASHMIR'
      WHEN regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','') IN ('DADRAANDNAGARHAVELIANDDAMANANDDIU','DADRANAGARHAVELIDAMANDIU','DAMANANDDIU') THEN 'DADRAANDNAGARHAVELIANDDAMANANDDIU'
      ELSE regexp_replace(replace(upper(address_state),'&','AND'),'[^A-Z0-9]','')
    END AS p_s_norm
  FROM workspace.virtue_foundation_enriched.gold_facilities
  WHERE district_approx IS NOT NULL
),
postal AS (
  SELECT DISTINCT district_approx AS postal_district, address_state AS postal_state_raw, p_d_norm, p_s_norm FROM fac
),
rename_dict AS (
  SELECT DISTINCT postal_d_norm, state_norm, target_d_norm FROM VALUES
    ('PRAYAGRAJ','UTTARPRADESH','ALLAHABAD'),('AYODHYA','UTTARPRADESH','FAIZABAD'),
    ('BENGALURUURBAN','KARNATAKA','BANGALORE'),('KALABURAGI','KARNATAKA','GULBARGA'),
    ('BELAGAVI','KARNATAKA','BELGAUM'),('GURUGRAM','HARYANA','GURGAON'),
    ('HOOGHLY','WESTBENGAL','HUGLI'),('HOWRAH','WESTBENGAL','HAORA'),
    ('AHMEDNAGAR','MAHARASHTRA','AHMADNAGAR'),
    ('AHMEDABAD','GUJARAT','AHMADABAD'),('MEHSANA','GUJARAT','MAHESANA'),('BARODA','GUJARAT','VADODARA'),
    ('BENGALURU','KARNATAKA','BANGALORE'),('MYSURU','KARNATAKA','MYSORE'),
    ('MANGALORE','KARNATAKA','DAKSHINAKANNADA'),('MANGALURU','KARNATAKA','DAKSHINAKANNADA'),
    ('HUBLI','KARNATAKA','DHARWAD'),('HUBBALLI','KARNATAKA','DHARWAD'),
    ('VIJAYAPURA','KARNATAKA','BIJAPUR'),('BALLARI','KARNATAKA','BELLARY'),
    ('SHIVAMOGGA','KARNATAKA','SHIMOGA'),('TUMAKURU','KARNATAKA','TUMKUR'),
    ('CHIKKAMAGALURU','KARNATAKA','CHIKMAGALUR'),('CHAMARAJANAGARA','KARNATAKA','CHAMARAJANAGAR'),
    ('KOCHI','KERALA','ERNAKULAM'),('COCHIN','KERALA','ERNAKULAM'),('ALUVA','KERALA','ERNAKULAM'),
    ('PERUMBAVOOR','KERALA','ERNAKULAM'),('MUVATTUPUZHA','KERALA','ERNAKULAM'),
    ('CALICUT','KERALA','KOZHIKODE'),('KOZHIKODE','KERALA','KOZHIKODE'),
    ('TRIVANDRUM','KERALA','THIRUVANANTHAPURAM'),('CHERTHALA','KERALA','ALAPPUZHA'),
    ('THALASSERY','KERALA','KANNUR'),('KANHANGAD','KERALA','KASARAGOD'),
    ('THODUPUZHA','KERALA','IDUKKI'),('THIRUVALLA','KERALA','PATHANAMTHITTA'),
    ('KOZHENCHERRY','KERALA','PATHANAMTHITTA'),('KOTTAKKAL','KERALA','MALAPPURAM'),
    ('PERINTALMANNA','KERALA','MALAPPURAM'),('KODUNGALLUR','KERALA','THRISSUR'),
    ('SILIGURI','WESTBENGAL','DARJILING'),('DARJEELING','WESTBENGAL','DARJILING'),
    ('DURGAPUR','WESTBENGAL','PASCHIMBARDDHAMAN'),('ASANSOL','WESTBENGAL','PASCHIMBARDDHAMAN'),
    ('BURDWAN','WESTBENGAL','PASCHIMBARDDHAMAN'),('BARDHAMAN','WESTBENGAL','PASCHIMBARDDHAMAN'),
    ('BERHAMPORE','WESTBENGAL','MURSHIDABAD'),('MIDNAPORE','WESTBENGAL','PASCHIMMEDINIPUR'),
    ('WESTMEDINIPUR','WESTBENGAL','PASCHIMMEDINIPUR'),('PASCHIMMEDINIPUR','WESTBENGAL','PASCHIMMEDINIPUR'),
    ('COOCHBEHAR','WESTBENGAL','KOCHBIHAR'),('KHARAGPUR','WESTBENGAL','PASCHIMMEDINIPUR'),
    ('CHANDANNAGAR','WESTBENGAL','HUGLI'),('BARRACKPORE','WESTBENGAL','NORTHTWENTYFOURPARGANA'),
    ('SHYAMNAGAR','WESTBENGAL','NORTHTWENTYFOURPARGANA'),('ARAMBAGH','WESTBENGAL','HUGLI'),('RANAGHAT','WESTBENGAL','NADIA'),
    ('NORTH24PARGANAS','WESTBENGAL','NORTHTWENTYFOURPARGANA'),('SOUTH24PARGANAS','WESTBENGAL','SOUTHTWENTYFOURPARGANA'),
    ('NOIDA','UTTARPRADESH','GAUTAMBUDDHANAGAR'),('GREATERNOIDA','UTTARPRADESH','GAUTAMBUDDHANAGAR'),
    ('GREATERNOIDAWEST','UTTARPRADESH','GAUTAMBUDDHANAGAR'),
    ('KANPUR','UTTARPRADESH','KANPURNAGAR'),('ALLAHABAD','UTTARPRADESH','ALLAHABAD'),
    ('INDIRAPURAM','UTTARPRADESH','GHAZIABAD'),('VAISHALI','UTTARPRADESH','GHAZIABAD'),
    ('VIJAYAWADA','ANDHRAPRADESH','KRISHNA'),('TIRUPATI','ANDHRAPRADESH','CHITTOOR'),
    ('RAJAHMUNDRY','ANDHRAPRADESH','EASTGODAVARI'),('KAKINADA','ANDHRAPRADESH','EASTGODAVARI'),
    ('VISAKHAPATNAM','ANDHRAPRADESH','VISAKHAPATNAM'),('ONGOLE','ANDHRAPRADESH','PRAKASAM'),
    ('CHIRALA','ANDHRAPRADESH','PRAKASAM'),
    ('ELURU','ANDHRAPRADESH','WESTGODAVARI'),('BHIMAVARAM','ANDHRAPRADESH','WESTGODAVARI'),
    ('MADANAPALLE','ANDHRAPRADESH','CHITTOOR'),('PUTTAPARTHI','ANDHRAPRADESH','ANANTAPUR'),
    ('SECUNDERABAD','TELANGANA','HYDERABAD'),('KUKATPALLY','TELANGANA','HYDERABAD'),
    ('KOMPALLY','TELANGANA','HYDERABAD'),
    ('HANAMKONDA','TELANGANA','WARANGALURBAN'),('WARANGAL','TELANGANA','WARANGALURBAN'),
    ('CHHATRAPATISAMBHAJINAGAR','MAHARASHTRA','AURANGABAD'),('SAMBHAJINAGAR','MAHARASHTRA','AURANGABAD'),
    ('NAVIMUMBAI','MAHARASHTRA','THANE'),('THANEWEST','MAHARASHTRA','THANE'),
    ('DOMBIVLI','MAHARASHTRA','THANE'),('DOMBIVLIEAST','MAHARASHTRA','THANE'),
    ('KALYAN','MAHARASHTRA','THANE'),('PANVEL','MAHARASHTRA','RAIGARH'),
    ('ULHASNAGAR','MAHARASHTRA','THANE'),('BHIWANDI','MAHARASHTRA','THANE'),
    ('PIMPRICHINCHWAD','MAHARASHTRA','PUNE'),('CHINCHWAD','MAHARASHTRA','PUNE'),
    ('HADAPSAR','MAHARASHTRA','PUNE'),('BANER','MAHARASHTRA','PUNE'),('AUNDH','MAHARASHTRA','PUNE'),
    ('KARAD','MAHARASHTRA','SATARA'),('KARADCITY','MAHARASHTRA','SATARA'),
    ('KHARGHAR','MAHARASHTRA','RAIGARH'),('VIRAR','MAHARASHTRA','PALGHAR'),
    ('MIRAJ','MAHARASHTRA','SANGLI'),('SANGAMNER','MAHARASHTRA','AHMADNAGAR'),
    ('BHUSAWAL','MAHARASHTRA','JALGAON'),('MANGALWEDHA','MAHARASHTRA','SOLAPUR'),
    ('ANDHERIWEST','MAHARASHTRA','MUMBAISUBURBAN'),('MALADEAST','MAHARASHTRA','MUMBAISUBURBAN'),
    ('MALADWEST','MAHARASHTRA','MUMBAISUBURBAN'),('KANDIVALIWEST','MAHARASHTRA','MUMBAISUBURBAN'),
    ('MULUNDWEST','MAHARASHTRA','MUMBAISUBURBAN'),
    ('NAGERCOIL','TAMILNADU','KANNIYAKUMARI'),('KANYAKUMARI','TAMILNADU','KANNIYAKUMARI'),
    ('HOSUR','TAMILNADU','KRISHNAGIRI'),('TRICHY','TAMILNADU','TIRUCHIRAPPALLI'),
    ('KUMBAKONAM','TAMILNADU','THANJAVUR'),('PALAYAMKOTTAI','TAMILNADU','TIRUNELVELI'),
    ('ATTUR','TAMILNADU','SALEM'),('RAJAPALAYAM','TAMILNADU','VIRUDHUNAGAR'),
    ('DEVAKOTTAI','TAMILNADU','SIVAGANGA'),('COONOOR','TAMILNADU','THENILGIRIS'),
    ('ANNANAGAR','TAMILNADU','CHENNAI'),('KILPAUK','TAMILNADU','CHENNAI'),('NANGANALLUR','TAMILNADU','CHENNAI'),
    ('HALDWANI','UTTARAKHAND','NAINITAL'),('ROORKEE','UTTARAKHAND','HARIDWAR'),
    ('RUDRAPUR','UTTARAKHAND','UDHAMSINGHNAGAR'),('RISHIKESH','UTTARAKHAND','DEHRADUN'),
    ('KASHIPUR','UTTARAKHAND','UDHAMSINGHNAGAR'),
    ('BHUBANESWAR','ODISHA','KHORDHA'),('BHUBANESHWAR','ODISHA','KHORDHA'),('CUTTACK','ODISHA','CUTTACK'),
    ('ROURKELA','ODISHA','SUNDARGARH'),('BERHAMPUR','ODISHA','GANJAM'),('BALASORE','ODISHA','BALESHWAR'),
    ('GUWAHATI','ASSAM','KAMRUPMETROPOLITAN'),('SILCHAR','ASSAM','CACHAR'),('TEZPUR','ASSAM','SONITPUR'),
    ('JAMSHEDPUR','JHARKHAND','PURBISINGHBHUM'),('EASTSINGHBHUM','JHARKHAND','PURBISINGHBHUM'),
    ('MOHALI','PUNJAB','SAHIBZADAAJITSINGHNAGAR'),('KHARAR','PUNJAB','SAHIBZADAAJITSINGHNAGAR'),
    ('ZIRAKPUR','PUNJAB','SAHIBZADAAJITSINGHNAGAR'),('PHAGWARA','PUNJAB','KAPURTHALA'),
    ('KHANNA','PUNJAB','LUDHIANA'),('BATALA','PUNJAB','GURDASPUR'),('BANGA','PUNJAB','SHAHIDBHAGATSINGHNAGAR'),
    ('SRIMUKTSARSAHIB','PUNJAB','MUKTSAR'),
    ('JAMMU','JAMMUANDKASHMIR','JAMMU'),('SRINAGAR','JAMMUANDKASHMIR','SRINAGAR'),
    ('BHILAI','CHHATTISGARH','DURG'),('AMBIKAPUR','CHHATTISGARH','SURGUJA'),
    ('MARGAO','GOA','SOUTHGOA'),('PANAJI','GOA','NORTHGOA'),('PANJIM','GOA','NORTHGOA'),
    ('PONDICHERRY','PUDUCHERRY','PUDUCHERRY'),
    ('SRIGANGANAGAR','RAJASTHAN','GANGANAGAR'),('BHIWADI','RAJASTHAN','ALWAR'),
    ('NADIAD','GUJARAT','KHEDA'),('BHUJ','GUJARAT','KACHCHH'),('GANDHIDHAM','GUJARAT','KACHCHH'),
    ('VAPI','GUJARAT','VALSAD'),('ANKLESHWAR','GUJARAT','BHARUCH'),('PALANPUR','GUJARAT','BANASKANTHA'),
    ('DEESA','GUJARAT','BANASKANTHA'),('BARDOLI','GUJARAT','SURAT'),('KALOL','GUJARAT','GANDHINAGAR'),
    ('AMBALACITY','HARYANA','AMBALA'),('AMBALACANTT','HARYANA','AMBALA'),('NARNAUL','HARYANA','MAHENDRAGARH'),
    ('BAHADURGARH','HARYANA','JHAJJAR'),('JAGADHRI','HARYANA','YAMUNANAGAR'),
    ('TOHANA','HARYANA','FATEHABAD'),('PINJORE','HARYANA','PANCHKULA'),
    ('MOTIHARI','BIHAR','PURBACHAMPARAN'),('LAHERIASARAI','BIHAR','DARBHANGA'),
    ('SHILLONG','MEGHALAYA','EASTKHASIHILLS'),('IMPHAL','MANIPUR','IMPHALWEST'),
    ('AGARTALA','TRIPURA','WESTTRIPURA'),('GANGTOK','SIKKIM','EASTDISTRICT'),
    -- additional locality -> district (verified against NFHS district list)
    ('ANGAMALY','KERALA','ERNAKULAM'),('THRIPPUNITHURA','KERALA','ERNAKULAM'),
    ('PANDALAM','KERALA','PATHANAMTHITTA'),('CHENGANNUR','KERALA','ALAPPUZHA'),('HARIPAD','KERALA','ALAPPUZHA'),
    ('TIRUR','KERALA','MALAPPURAM'),('NADAPURAM','KERALA','KOZHIKODE'),('PALA','KERALA','KOTTAYAM'),
    ('KUNNAMKULAM','KERALA','THRISSUR'),('IRINJALAKUDA','KERALA','THRISSUR'),('PAVARATTY','KERALA','THRISSUR'),
    ('HALOL','GUJARAT','PANCHMAHALS'),('DAHOD','GUJARAT','DOHAD'),('VERAVAL','GUJARAT','GIRSOMNATH'),
    ('MUNDRA','GUJARAT','KACHCHH'),
    ('ICHALKARANJI','MAHARASHTRA','KOLHAPUR'),
    ('HAJIPUR','BIHAR','VAISHALI'),
    ('BADDI','HIMACHALPRADESH','SOLAN'),('HOSPET','KARNATAKA','BELLARY'),('SIRSI','KARNATAKA','UTTARAKANNADA'),
    ('TENKASI','TAMILNADU','TIRUNELVELI'),('PALLADAM','TAMILNADU','TIRUPPUR'),('KARAIKUDI','TAMILNADU','SIVAGANGA'),
    ('RASIPURAM','TAMILNADU','NAMAKKAL'),
    ('BOKAROSTEELCITY','JHARKHAND','BOKARO'),('ABUROAD','RAJASTHAN','SIROHI'),
    ('SAMRALA','PUNJAB','LUDHIANA'),('DORAHA','PUNJAB','LUDHIANA'),('SHAHBAD','HARYANA','KURUKSHETRA'),
    ('MAPUSA','GOA','NORTHGOA'),
    ('DELHI','NCTOFDELHI','NEWDELHI'),('NEWDELHI','NCTOFDELHI','NEWDELHI'),('EASTDELHI','NCTOFDELHI','EAST'),
    ('DWARKA','NCTOFDELHI','SOUTHWEST'),('NAJAFGARH','NCTOFDELHI','SOUTHWEST'),
    ('ROHINI','NCTOFDELHI','NORTHWEST'),('PITAMPURA','NCTOFDELHI','NORTHWEST'),
    ('SAKET','NCTOFDELHI','SOUTH'),('JANAKPURI','NCTOFDELHI','WEST')
  AS t(postal_d_norm, state_norm, target_d_norm)
),
exact_c AS (
  SELECT p.postal_district, p.postal_state_raw, n.district_name_norm AS nfhs_d, n.state_ut_norm AS nfhs_s
  FROM postal p JOIN nfhs n ON n.d_norm = p.p_d_norm AND n.s_norm = p.p_s_norm
),
exact_one AS (
  SELECT postal_district, postal_state_raw, nfhs_d, nfhs_s
  FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY postal_district, postal_state_raw ORDER BY nfhs_d) rn FROM exact_c) WHERE rn=1
),
rename_c AS (
  SELECT p.postal_district, p.postal_state_raw, n.district_name_norm AS nfhs_d, n.state_ut_norm AS nfhs_s
  FROM postal p
  JOIN rename_dict r ON r.postal_d_norm = p.p_d_norm AND r.state_norm = p.p_s_norm
  JOIN nfhs n ON n.d_norm = r.target_d_norm AND n.s_norm = p.p_s_norm
),
rename_one AS (
  SELECT postal_district, postal_state_raw, nfhs_d, nfhs_s
  FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY postal_district, postal_state_raw ORDER BY nfhs_d) rn FROM rename_c) WHERE rn=1
),
fuzzy_c AS (
  SELECT p.postal_district, p.postal_state_raw, n.district_name_norm AS nfhs_d, n.state_ut_norm AS nfhs_s,
    1.0 - (levenshtein(p.p_d_norm, n.d_norm) / GREATEST(length(p.p_d_norm), length(n.d_norm))) AS sim,
    ROW_NUMBER() OVER (PARTITION BY p.postal_district, p.postal_state_raw
      ORDER BY 1.0 - (levenshtein(p.p_d_norm, n.d_norm) / GREATEST(length(p.p_d_norm), length(n.d_norm))) DESC, n.district_name_norm) AS rn
  FROM postal p JOIN nfhs n ON n.s_norm = p.p_s_norm WHERE length(p.p_d_norm) > 0
),
fuzzy_one AS (
  SELECT postal_district, postal_state_raw, nfhs_d, nfhs_s, ROUND(sim,4) AS sim
  FROM fuzzy_c WHERE rn=1 AND sim >= 0.72
),
-- ---- base resolution (exact > rename > fuzzy) per postal pair -----------------
base AS (
  SELECT
    p.postal_district, p.postal_state_raw,
    COALESCE(e.nfhs_d, r.nfhs_d, f.nfhs_d) AS nfhs_d,
    COALESCE(e.nfhs_s, r.nfhs_s, f.nfhs_s) AS nfhs_s,
    CASE WHEN e.nfhs_d IS NOT NULL THEN 'exact' WHEN r.nfhs_d IS NOT NULL THEN 'rename'
         WHEN f.nfhs_d IS NOT NULL THEN 'fuzzy' ELSE NULL END AS method,
    CASE WHEN e.nfhs_d IS NOT NULL THEN 1.0 WHEN r.nfhs_d IS NOT NULL THEN 0.97
         WHEN f.nfhs_d IS NOT NULL THEN f.sim ELSE NULL END AS conf
  FROM (SELECT DISTINCT postal_district, postal_state_raw FROM postal) p
  LEFT JOIN exact_one  e ON e.postal_district = p.postal_district AND e.postal_state_raw <=> p.postal_state_raw
  LEFT JOIN rename_one r ON r.postal_district = p.postal_district AND r.postal_state_raw <=> p.postal_state_raw
  LEFT JOIN fuzzy_one  f ON f.postal_district = p.postal_district AND f.postal_state_raw <=> p.postal_state_raw
),
-- ---- Tier 4 GEO: pincode propagation for unresolved postal pairs --------------
-- facilities (non-dup) already resolved through base, with their pincode
fac_resolved AS (
  SELECT fc.pincode_clean, b.nfhs_d, b.nfhs_s
  FROM fac fc
  JOIN base b ON b.postal_district <=> fc.district_approx AND b.postal_state_raw <=> fc.address_state
  WHERE fc.is_probable_duplicate = false
    AND b.nfhs_d IS NOT NULL
    AND fc.pincode_clean IS NOT NULL AND length(fc.pincode_clean) >= 6
),
-- dominant NFHS district per pincode
pin_dom AS (
  SELECT pincode_clean, nfhs_d, nfhs_s
  FROM (SELECT pincode_clean, nfhs_d, nfhs_s,
               ROW_NUMBER() OVER (PARTITION BY pincode_clean ORDER BY COUNT(*) DESC, nfhs_d) rn
        FROM fac_resolved GROUP BY pincode_clean, nfhs_d, nfhs_s) WHERE rn=1
),
-- unresolved postal pairs and the pincodes their facilities use
unresolved_pairs AS (
  SELECT b.postal_district, b.postal_state_raw FROM base b WHERE b.nfhs_d IS NULL
),
geo_votes AS (
  SELECT fc.district_approx AS postal_district, fc.address_state AS postal_state_raw,
         pd.nfhs_d, pd.nfhs_s, COUNT(*) AS votes
  FROM fac fc
  JOIN unresolved_pairs u ON u.postal_district <=> fc.district_approx AND u.postal_state_raw <=> fc.address_state
  JOIN pin_dom pd ON pd.pincode_clean = fc.pincode_clean
  WHERE fc.is_probable_duplicate = false
  GROUP BY fc.district_approx, fc.address_state, pd.nfhs_d, pd.nfhs_s
),
geo_one AS (
  SELECT postal_district, postal_state_raw, nfhs_d, nfhs_s,
         ROUND(votes / tot, 4) AS agreement
  FROM (
    SELECT *, SUM(votes) OVER (PARTITION BY postal_district, postal_state_raw) AS tot,
           ROW_NUMBER() OVER (PARTITION BY postal_district, postal_state_raw ORDER BY votes DESC, nfhs_d) AS rn
    FROM geo_votes
  )
  WHERE rn = 1 AND (votes / tot) >= 0.50
)
-- ---- final assembly ---------------------------------------------------------
SELECT
  b.postal_district AS postal_district,
  b.postal_state_raw AS state,
  COALESCE(b.nfhs_d, g.nfhs_d) AS nfhs_district_name_norm,
  COALESCE(b.nfhs_s, g.nfhs_s) AS nfhs_state_ut_norm,
  COALESCE(b.method, 'fuzzy')  AS match_method,
  CAST(COALESCE(b.conf, LEAST(g.agreement, 0.90)) AS DOUBLE) AS confidence
FROM base b
LEFT JOIN geo_one g ON g.postal_district <=> b.postal_district AND g.postal_state_raw <=> b.postal_state_raw
WHERE COALESCE(b.nfhs_d, g.nfhs_d) IS NOT NULL
