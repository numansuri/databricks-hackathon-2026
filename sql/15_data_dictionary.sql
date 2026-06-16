-- 15_data_dictionary.sql
-- POST-BUILD: materialize the gold_facilities data dictionary.
-- Runs AFTER 09b_gold_comments.sql has stamped a comment on every gold column.
-- Table: workspace.virtue_foundation_enriched.facilities_data_dictionary
--   one row per gold_facilities column: column_name, ordinal_position, data_type, description
-- VALIDATION (must hold): dictionary row count == gold_facilities column count (177),
--   and 0 rows have a NULL/empty description (full comment coverage).

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_data_dictionary AS
SELECT
  column_name,
  ordinal_position,
  data_type,
  comment AS description
FROM workspace.information_schema.columns
WHERE table_schema = 'virtue_foundation_enriched'
  AND table_name   = 'gold_facilities'
ORDER BY ordinal_position;
