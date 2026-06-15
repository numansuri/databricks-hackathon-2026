from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
wh = '260da0aaab951fdb'
cat = 'databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset'

def sql(q):
    r = w.statement_execution.execute_statement(warehouse_id=wh, statement=q, wait_timeout='50s')
    return r.result.data_array or []

print("\n========== FACILITIES ==========")
print("\n-- Row count --")
print(sql(f"SELECT COUNT(*) FROM {cat}.facilities"))

print("\n-- facilityTypeId distribution --")
for r in sql(f"SELECT facilityTypeId, COUNT(*) n FROM {cat}.facilities GROUP BY 1 ORDER BY 2 DESC"): print(r)

print("\n-- operatorTypeId distribution --")
for r in sql(f"SELECT operatorTypeId, COUNT(*) n FROM {cat}.facilities GROUP BY 1 ORDER BY 2 DESC"): print(r)

print("\n-- State distribution top 15 --")
for r in sql(f"SELECT address_stateOrRegion, COUNT(*) n FROM {cat}.facilities GROUP BY 1 ORDER BY 2 DESC LIMIT 15"): print(r)

print("\n-- Field null rates --")
for r in sql(f"""
SELECT COUNT(*) total,
  SUM(CASE WHEN capability IS NULL OR capability='null' THEN 1 ELSE 0 END) null_capability,
  SUM(CASE WHEN procedure IS NULL OR procedure='null' THEN 1 ELSE 0 END) null_procedure,
  SUM(CASE WHEN equipment IS NULL OR equipment='null' THEN 1 ELSE 0 END) null_equipment,
  SUM(CASE WHEN specialties IS NULL OR specialties='null' THEN 1 ELSE 0 END) null_specialties,
  SUM(CASE WHEN description IS NULL OR description='null' THEN 1 ELSE 0 END) null_description,
  SUM(CASE WHEN numberDoctors IS NULL OR numberDoctors='null' THEN 1 ELSE 0 END) null_doctors,
  SUM(CASE WHEN capacity IS NULL OR capacity='null' THEN 1 ELSE 0 END) null_capacity,
  SUM(CASE WHEN email IS NULL OR email='null' THEN 1 ELSE 0 END) null_email,
  SUM(CASE WHEN address_zipOrPostcode IS NULL OR address_zipOrPostcode='null' THEN 1 ELSE 0 END) null_zip
FROM {cat}.facilities"""): print(r)

print("\n-- Coordinate quality (India: lat 8-37, lng 68-97) --")
for r in sql(f"""
SELECT
  SUM(CASE WHEN latitude BETWEEN 8 AND 37 AND longitude BETWEEN 68 AND 97 THEN 1 ELSE 0 END) valid_coords,
  SUM(CASE WHEN latitude NOT BETWEEN 8 AND 37 OR longitude NOT BETWEEN 68 AND 97 THEN 1 ELSE 0 END) bad_coords,
  SUM(CASE WHEN latitude IS NULL THEN 1 ELSE 0 END) null_coords
FROM {cat}.facilities"""): print(r)

print("\n-- Bad coords recoverable via zipcode --")
for r in sql(f"""
SELECT COUNT(*) FROM {cat}.facilities
WHERE (latitude NOT BETWEEN 8 AND 37 OR longitude NOT BETWEEN 68 AND 97)
AND address_zipOrPostcode IS NOT NULL AND address_zipOrPostcode != 'null'"""): print(r)

print("\n-- Email availability --")
for r in sql(f"""
SELECT
  SUM(CASE WHEN email IS NOT NULL AND email != 'null' THEN 1 ELSE 0 END) has_email,
  SUM(CASE WHEN email IS NULL OR email = 'null' THEN 1 ELSE 0 END) no_email
FROM {cat}.facilities"""): print(r)

print("\n-- Single vs multi-source --")
for r in sql(f"""
SELECT
  SUM(CASE WHEN source_types='null' OR source_types IS NULL THEN 1 ELSE 0 END) single_source,
  SUM(CASE WHEN source_types != 'null' AND source_types IS NOT NULL THEN 1 ELSE 0 END) multi_source
FROM {cat}.facilities"""): print(r)

print("\n-- numberDoctors top values --")
for r in sql(f"""
SELECT numberDoctors, COUNT(*) n FROM {cat}.facilities
WHERE numberDoctors IS NOT NULL AND numberDoctors != 'null'
GROUP BY 1 ORDER BY CAST(numberDoctors AS INT) DESC LIMIT 10"""): print(r)

print("\n-- capacity top values --")
for r in sql(f"""
SELECT capacity, COUNT(*) n FROM {cat}.facilities
WHERE capacity IS NOT NULL AND capacity != 'null'
GROUP BY 1 ORDER BY CAST(capacity AS INT) DESC LIMIT 10"""): print(r)


print("\n\n========== PINCODE DIRECTORY ==========")
print("\n-- Row count --")
print(sql(f"SELECT COUNT(*) FROM {cat}.india_post_pincode_directory"))

print("\n-- Unique pincodes --")
print(sql(f"SELECT COUNT(DISTINCT pincode) FROM {cat}.india_post_pincode_directory"))

print("\n-- officetype distribution --")
for r in sql(f"SELECT officetype, COUNT(*) n FROM {cat}.india_post_pincode_directory GROUP BY 1 ORDER BY 2 DESC"): print(r)

print("\n-- Coordinate quality --")
for r in sql(f"""
SELECT
  SUM(CASE WHEN CAST(latitude AS DOUBLE) BETWEEN 8 AND 37 AND CAST(longitude AS DOUBLE) BETWEEN 68 AND 97 THEN 1 ELSE 0 END) valid,
  SUM(CASE WHEN latitude IS NULL OR latitude='null' THEN 1 ELSE 0 END) null_coords
FROM {cat}.india_post_pincode_directory"""): print(r)

print("\n-- Facility zipcodes matched in pincode directory --")
for r in sql(f"""
SELECT COUNT(DISTINCT f.address_zipOrPostcode) matched
FROM {cat}.facilities f
JOIN {cat}.india_post_pincode_directory p ON CAST(f.address_zipOrPostcode AS BIGINT) = p.pincode
WHERE f.address_zipOrPostcode IS NOT NULL AND f.address_zipOrPostcode != 'null'"""): print(r)

print("\n-- Facility zipcodes NOT matched --")
for r in sql(f"""
SELECT COUNT(DISTINCT f.address_zipOrPostcode) unmatched
FROM {cat}.facilities f
LEFT JOIN {cat}.india_post_pincode_directory p ON CAST(f.address_zipOrPostcode AS BIGINT) = p.pincode
WHERE f.address_zipOrPostcode IS NOT NULL AND f.address_zipOrPostcode != 'null'
AND p.pincode IS NULL"""): print(r)


print("\n\n========== NFHS INDICATORS ==========")
print("\n-- Row count --")
print(sql(f"SELECT COUNT(*) FROM {cat}.nfhs_5_district_health_indicators"))

print("\n-- State distribution --")
for r in sql(f"SELECT state_ut, COUNT(*) districts FROM {cat}.nfhs_5_district_health_indicators GROUP BY 1 ORDER BY 2 DESC LIMIT 20"): print(r)

print("\n-- NFHS districts matched via pincode directory --")
for r in sql(f"""
SELECT COUNT(DISTINCT n.district_name) matched
FROM {cat}.nfhs_5_district_health_indicators n
JOIN {cat}.india_post_pincode_directory p
  ON LOWER(TRIM(n.district_name)) = LOWER(TRIM(p.district))"""): print(r)

print("\n-- Top 10 districts by diabetes rate --")
for r in sql(f"""
SELECT district_name, state_ut,
  w15_plus_with_high_or_very_high_gt_140_mg_dl_blood_sugar_or_pct as diabetes_pct,
  w15_plus_with_high_bp_sys_gte_140_mmhg_and_or_dia_gte_90_mm_pct as hypertension_pct,
  all_w15_49_who_are_anaemic_pct as anaemia_pct,
  institutional_birth_5y_pct as inst_birth_pct
FROM {cat}.nfhs_5_district_health_indicators
ORDER BY CAST(diabetes_pct AS DOUBLE) DESC NULLS LAST
LIMIT 10"""): print(r)

print("\nDONE")
