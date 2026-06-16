# gold_need_specialist_map

**FQN:** `workspace.virtue_foundation_enriched.gold_need_specialist_map` · **Grain:** one row per `(need_category, specialty_canonical)` · **Rows:** 174 · **Cols:** 4 · District-INDEPENDENT lookup.

## What it is

A curated dictionary that translates a district health *need* into the canonical medical *specialist(s)* that serve it. It is the bridge between the demand side (`gold_nfhs_district.needs`, derived from NFHS indicators) and the supply side (facility specialty counts). `gold_demand_supply_gap` joins it on both sides to score, for each district, how well local specialist supply covers each need. The table carries no district key — it is a static crosswalk applied uniformly across all districts.

## Columns

| column | description |
|---|---|
| `need_category` | The district need being served (28 distinct values; matches the keys in `gold_nfhs_district.needs`). |
| `specialty_canonical` | A canonical specialty that addresses the need. **FK to `dim_specialty_canonical`** — every value resolves there (verified: 0 orphans). |
| `relation` | `primary` = the specialty directly treats/owns the need; `adjacent` = referral / supporting role. |
| `weight` | Demand-scoring weight: `primary` = **1.0**, `adjacent` = **0.5**. Used to weight a need's contribution to specialist demand. |

Split: **52 primary** rows, **122 adjacent** rows. 44 distinct specialties are referenced.

## The crosswalk

28 need categories, each with its `primary` (directly treats) and `adjacent` (referral/support) specialties. Specialty names are canonical (see `dim_specialty_canonical`).

| need_category | primary | adjacent |
|---|---|---|
| adolescent_pregnancy | adolescent_medicine, maternal_child_health, obstetrics_gynecology | family_planning_contraception, maternal_fetal_medicine, neonatology, pediatrics, psychiatry |
| adult_overnutrition_obesity | endocrinology_diabetes, internal_medicine, nutrition_dietetics | bariatric_metabolic_surgery, cardiology, endocrine_surgery, family_medicine, preventive_medicine |
| alcohol_use | addiction_medicine, psychiatry | family_medicine, gastroenterology, internal_medicine, preventive_medicine, psychology |
| anaemia | internal_medicine, obstetrics_gynecology, pediatrics | family_medicine, gastroenterology, hematology, maternal_child_health, nutrition_dietetics |
| antenatal_care | maternal_child_health, obstetrics_gynecology | family_medicine, internal_medicine, maternal_fetal_medicine, nutrition_dietetics, radiology |
| birth_registration | preventive_medicine | maternal_child_health, neonatology, pediatrics, public_health_dentistry |
| cancer_screening | gynecologic_oncology, medical_oncology, preventive_medicine | breast_surgery, gastroenterology, obstetrics_gynecology, otolaryngology, pathology, radiology, surgical_oncology |
| cesarean_delivery | maternal_fetal_medicine, obstetrics_gynecology | anesthesiology, critical_care_medicine, maternal_child_health, neonatology |
| child_illness_care | pediatric_emergency_medicine, pediatrics | family_medicine, infectious_diseases, pediatric_critical_care, pulmonology |
| child_immunization | pediatrics, preventive_medicine | family_medicine, infectious_diseases, maternal_child_health |
| child_malnutrition | nutrition_dietetics, pediatrics | gastroenterology, internal_medicine, maternal_child_health, neonatology, preventive_medicine |
| child_marriage | adolescent_medicine, psychiatry | child_adolescent_psychiatry, maternal_child_health, obstetrics_gynecology, preventive_medicine, psychology |
| clean_cooking_air | preventive_medicine, pulmonology | cardiology, family_medicine, internal_medicine, pediatrics |
| family_planning_unmet | family_planning_contraception, obstetrics_gynecology | maternal_child_health, preventive_medicine, reproductive_endocrinology_infertility, urology |
| female_education | *(none — social determinant)* | maternal_child_health, preventive_medicine, psychology |
| health_insurance_access | *(none — social determinant)* | palliative_medicine, preventive_medicine |
| infant_young_child_feeding | nutrition_dietetics, pediatrics | maternal_child_health, neonatology, obstetrics_gynecology, preventive_medicine |
| institutional_delivery | maternal_child_health, obstetrics_gynecology | anesthesiology, emergency_medicine, maternal_fetal_medicine, neonatology |
| maternal_nutrition | nutrition_dietetics, obstetrics_gynecology | endocrinology_diabetes, internal_medicine, maternal_child_health, maternal_fetal_medicine |
| maternal_oop_financial_protection | *(none — social determinant)* | maternal_child_health, obstetrics_gynecology, preventive_medicine |
| menstrual_hygiene | adolescent_medicine, obstetrics_gynecology | dermatology, maternal_child_health, preventive_medicine, public_health_dentistry |
| micronutrient_fortification | nutrition_dietetics, preventive_medicine | hematology, internal_medicine, obstetrics_gynecology, pediatrics |
| ncd_diabetes | endocrinology_diabetes, internal_medicine | cardiology, family_medicine, nephrology, nutrition_dietetics, ophthalmology, podiatry |
| ncd_hypertension | cardiology, internal_medicine | endocrinology_diabetes, family_medicine, nephrology, nutrition_dietetics, preventive_medicine |
| postnatal_care | neonatology, obstetrics_gynecology | family_medicine, maternal_child_health, pediatrics, psychiatry |
| skilled_birth_attendance | maternal_child_health, obstetrics_gynecology | anesthesiology, emergency_medicine, maternal_fetal_medicine, neonatology |
| tobacco_use | addiction_medicine, preventive_medicine | cardiology, oral_medicine_pathology, otolaryngology, psychiatry, public_health_dentistry, pulmonology |
| wash_sanitation | preventive_medicine | gastroenterology, infectious_diseases, internal_medicine, pediatrics |

## Notes

- **Three social-determinant needs have no primary specialist** — `female_education`, `health_insurance_access`, and `maternal_oop_financial_protection`. They map only to `adjacent` (referral/support) specialties, so they generate **no direct specialist demand** in `gold_demand_supply_gap`; their gap is driven entirely by the half-weighted adjacent links.
- `specialty_canonical` values are drawn from the **111-term canonical taxonomy** organized into **14 families** in `dim_specialty_canonical` (e.g., `maternal_child`, `internal_medicine`, `cancer`, `eye`, `primary_care`). All 44 specialties used here are a subset of that vocabulary.

## How it's built

A hand-curated crosswalk seeded from the facilities specialty vocabulary: for each NFHS-derived need, clinicians-of-record were assigned as `primary` and referral/support specialties as `adjacent`, then materialized as one row per pair with the fixed `weight` (1.0 / 0.5). Build SQL: `docs/sql/gold_need_specialist_map.sql`.

## Sample

| need_category | specialty_canonical | relation | weight |
|---|---|---|---|
| adolescent_pregnancy | obstetrics_gynecology | primary | 1.0 |
| adolescent_pregnancy | psychiatry | adjacent | 0.5 |
| ncd_diabetes | endocrinology_diabetes | primary | 1.0 |
| ncd_diabetes | podiatry | adjacent | 0.5 |
| health_insurance_access | preventive_medicine | adjacent | 0.5 |
