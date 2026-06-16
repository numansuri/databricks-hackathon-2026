#!/usr/bin/env python3
"""Refresh Shiftlink's bundled gold data from the LIVE Databricks gold layer.

LOCAL-FIRST (the project's guiding principle = SIMPLE):
  * The app NEVER reads Databricks at runtime. It imports the committed
    public/gold/*.json slices, which ARE the runtime data for both local dev
    and the deployed Free Edition app. That is the local fallback.
  * This script is the *offline build* path that regenerates those slices from
    live Databricks so they can be re-committed when the gold layer changes.

DATABRICKS-IF-AVAILABLE-ELSE-LOCAL:
  * If Databricks credentials are present (DATABRICKS_HOST + DATABRICKS_TOKEN,
    and a SQL warehouse via DATABRICKS_WAREHOUSE_ID or DATABRICKS_HTTP_PATH),
    it re-downloads the 5 live sources, writes the recommender intermediates,
    and runs `recommend.py --emit-slice` to rebuild public/gold/*.json.
  * If NOT, it prints that it is keeping the committed local slices and exits 0
    (never a failure). The committed slices remain the source of truth.

Pure stdlib + the Databricks SQL Statement Execution REST API over urllib.
No databricks-sql-connector, no pandas, no extra pip install.

Usage:
    python3 scripts/refresh_data.py          # refresh if creds present, else no-op
    npm run refresh:data                     # same, via package.json

Live sources (all in workspace.virtue_foundation_enriched):
    gold_demand_supply_gap_v2  -> recommender/data/gold_demand_supply_gap_v2.csv
    gold_facility_enriched     -> recommender/data/gold_facility_enriched.csv
    fct_facility_specialty     -> recommender/data/fct_facility_specialty.csv
    §4.1 facilities export      -> recommender/data/facilities_export.json
    gold_district_card         -> public/gold/district_cards.json
Then: recommend.py --emit-slice rebuilds the other 4 public/gold/*.json.
"""
import csv
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "recommender", "data")
GOLD_DIR = os.path.join(REPO, "public", "gold")
CATALOG = "workspace.virtue_foundation_enriched"


# --------------------------------------------------------------------------- #
# Credential discovery (local-first: absence is a clean no-op, never an error)
# --------------------------------------------------------------------------- #
def _load_dotenv():
    """Best-effort: fold .env / .env.local into os.environ (does not override
    already-set vars). Keeps the script usable in plain local dev."""
    for fname in (".env", ".env.local"):
        path = os.path.join(REPO, fname)
        if not os.path.exists(path):
            continue
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                os.environ.setdefault(k, v)


def _credentials():
    """Return (host, token, warehouse_id) or None if not fully configured."""
    host = os.environ.get("DATABRICKS_HOST", "").strip().rstrip("/")
    token = os.environ.get("DATABRICKS_TOKEN", "").strip()
    wh = os.environ.get("DATABRICKS_WAREHOUSE_ID", "").strip()
    # Accept an HTTP path like /sql/1.0/warehouses/<id> too.
    if not wh:
        hp = os.environ.get("DATABRICKS_HTTP_PATH", "").strip()
        if "/warehouses/" in hp:
            wh = hp.rsplit("/", 1)[-1]
    if host and token and wh:
        if not host.startswith("http"):
            host = "https://" + host
        return host, token, wh
    return None


# --------------------------------------------------------------------------- #
# SQL Statement Execution REST API (stdlib urllib; no extra deps)
# --------------------------------------------------------------------------- #
def _run_sql(host, token, warehouse_id, sql):
    """Execute one SQL statement, polling until done. Returns list[dict] rows
    with column names as keys and raw (string-or-null) values."""
    body = json.dumps({
        "warehouse_id": warehouse_id,
        "statement": sql,
        "wait_timeout": "30s",
        "disposition": "INLINE",
        "format": "JSON_ARRAY",
    }).encode()
    req = urllib.request.Request(
        f"{host}/api/2.0/sql/statements/",
        data=body,
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        res = json.loads(resp.read())

    stmt_id = res.get("statement_id")
    # Poll until the statement leaves PENDING/RUNNING.
    while res.get("status", {}).get("state") in ("PENDING", "RUNNING"):
        time.sleep(2)
        preq = urllib.request.Request(
            f"{host}/api/2.0/sql/statements/{stmt_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(preq, timeout=60) as r2:
            res = json.loads(r2.read())

    state = res.get("status", {}).get("state")
    if state != "SUCCEEDED":
        err = res.get("status", {}).get("error", {})
        raise RuntimeError(f"SQL state={state}: {err.get('message', res)}")

    manifest = res.get("manifest", {})
    cols = [c["name"] for c in manifest.get("schema", {}).get("columns", [])]
    result = res.get("result", {})
    chunks = [result.get("data_array") or []]

    # Fetch any external/extra chunks by index.
    total_chunks = manifest.get("total_chunk_count", 1)
    for idx in range(1, total_chunks):
        creq = urllib.request.Request(
            f"{host}/api/2.0/sql/statements/{stmt_id}/result/chunks/{idx}",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(creq, timeout=120) as r3:
            chunks.append(json.loads(r3.read()).get("data_array") or [])

    rows = []
    for chunk in chunks:
        for arr in chunk:
            rows.append(dict(zip(cols, arr)))
    return cols, rows


# --------------------------------------------------------------------------- #
# Coercion helpers (the §4.1 export must match the canonical JSON types)
# --------------------------------------------------------------------------- #
def _num(v):
    if v in (None, "", "null"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _intg(v):
    if v in (None, "", "null"):
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _bool(v):
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() == "true"


def _str(v):
    if v in (None, "", "null"):
        return None
    return v


def _list(v):
    if isinstance(v, list):
        return v
    if v in (None, ""):
        return []
    try:
        x = json.loads(v)
        return x if isinstance(x, list) else []
    except (TypeError, ValueError):
        return []


# --------------------------------------------------------------------------- #
# Refresh steps
# --------------------------------------------------------------------------- #
def _csv_cell(v):
    """None -> '' and strip embedded NUL bytes (some source columns carry stray
    \\x00, which makes csv.DictReader raise '_csv.Error: line contains NUL' on the
    next read). Everything else is left verbatim."""
    if v is None:
        return ""
    return str(v).replace("\x00", "")


def _write_csv(path, cols, rows):
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([_csv_cell(r.get(c)) for c in cols])
    print(f"  wrote {os.path.relpath(path, REPO)} ({len(rows)} rows)")


def _refresh_csv(host, token, wh, table, fname):
    cols, rows = _run_sql(host, token, wh, f"SELECT * FROM {CATALOG}.{table}")
    _write_csv(os.path.join(DATA_DIR, fname), cols, rows)


def _needed_district_keys():
    """The 211 Title-Case State::District keys the bundle covers. Prefer the
    on-disk file; if absent, derive it (recommend.py --emit-slice regenerates
    it from the gap table on the first pass)."""
    path = os.path.join(DATA_DIR, "_needed_district_keys.json")
    if os.path.exists(path):
        return json.load(open(path))
    return None


def _refresh_facilities_export(host, token, wh, keys):
    inlist = ",".join("'" + k.replace("'", "''") + "'" for k in keys)
    sql = f"""
SELECT e.facility_id AS id, e.facility_name AS name, e.facility_type AS type,
       f.address_city AS city, f.address_state AS state,
       COALESCE(e.lat_clean,  p.centroid_lat) AS lat,
       COALESCE(e.long_clean, p.centroid_lon) AS lng,
       (e.lat_clean IS NULL) AS coordsAreApproximate,
       f.email_final AS email, f.phone_final AS phone,
       f.official_website AS website, f.facebook_link AS facebook,
       f.specialties_list AS specialtiesList,
       e.ownership_sector_final AS ownership,
       e.is_public_health_facility AS isPublic,
       e.facility_complexity_tier AS complexityTier,
       e.has_specialist_evidence AS hasSpecialistEvidence,
       e.specialist_domain_count AS specialistDomainCount,
       e.nfhs_district_name_norm AS district,
       e.nfhs_state_ut_norm AS stateNorm,
       concat_ws('::', e.nfhs_state_ut_norm, e.nfhs_district_name_norm) AS districtKey
FROM {CATALOG}.gold_facility_enriched e
JOIN {CATALOG}.gold_facilities f ON e.facility_id = f.unique_id
LEFT JOIN {CATALOG}.gold_pincode p ON e.pincode_clean = p.pincode
WHERE concat_ws('::', e.nfhs_state_ut_norm, e.nfhs_district_name_norm) IN ({inlist})
ORDER BY id
"""
    _, rows = _run_sql(host, token, wh, sql)
    out = [{
        "id": r["id"], "name": r["name"], "type": r["type"],
        "city": _str(r.get("city")), "state": _str(r.get("state")),
        "lat": _num(r.get("lat")), "lng": _num(r.get("lng")),
        "coordsAreApproximate": _bool(r.get("coordsAreApproximate")),
        "email": _str(r.get("email")), "phone": _str(r.get("phone")),
        "website": _str(r.get("website")), "facebook": _str(r.get("facebook")),
        "specialtiesList": _list(r.get("specialtiesList")),
        "ownership": _str(r.get("ownership")), "isPublic": _bool(r.get("isPublic")),
        "complexityTier": _str(r.get("complexityTier")),
        "hasSpecialistEvidence": _bool(r.get("hasSpecialistEvidence")),
        "specialistDomainCount": _intg(r.get("specialistDomainCount")),
        "district": _str(r.get("district")), "stateNorm": _str(r.get("stateNorm")),
        "districtKey": r.get("districtKey"),
    } for r in rows]
    path = os.path.join(DATA_DIR, "facilities_export.json")
    json.dump(out, open(path, "w"), ensure_ascii=False)
    print(f"  wrote {os.path.relpath(path, REPO)} ({len(out)} rows)")


def _refresh_district_cards(host, token, wh, keys):
    # Emitted in sorted districtKey order (ORDER BY below) for a stable, diffable
    # file. The app looks cards up BY KEY (districtCards[districtKey]), so object
    # order is non-semantic; a refreshed file may reorder keys vs the originally
    # committed one without any data change.
    inlist = ",".join("'" + k.replace("'", "''") + "'" for k in keys)
    sql = f"""
SELECT concat_ws('::', state_ut_norm, district_name_norm) AS districtKey,
       state_ut_norm AS stateNorm, district_name_norm AS district,
       persona_label AS personaLabel,
       top_need_categories AS topNeedCategories,
       top_priority_specialties AS topPrioritySpecialties
FROM {CATALOG}.gold_district_card
WHERE concat_ws('::', state_ut_norm, district_name_norm) IN ({inlist})
ORDER BY districtKey
"""
    _, rows = _run_sql(host, token, wh, sql)
    out = {}
    for r in rows:
        # top_priority_specialties is an array of structs; the bundled card stores
        # the flat list of specialty_canonical strings (the recommender join key).
        prio = _list(r.get("topPrioritySpecialties"))
        names = [p.get("specialty_canonical") for p in prio
                 if isinstance(p, dict) and p.get("specialty_canonical")]
        out[r["districtKey"]] = {
            "districtKey": r["districtKey"],
            "stateNorm": _str(r.get("stateNorm")),
            "district": _str(r.get("district")),
            "personaLabel": _str(r.get("personaLabel")),
            "topNeedCategories": _list(r.get("topNeedCategories")),
            "topPrioritySpecialties": names,
        }
    path = os.path.join(GOLD_DIR, "district_cards.json")
    json.dump(out, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"  wrote {os.path.relpath(path, REPO)} ({len(out)} districts)")


def _emit_slice():
    print("  running recommend.py --emit-slice ...")
    subprocess.run(
        [sys.executable, os.path.join(REPO, "recommender", "recommend.py"),
         "--emit-slice", "--out", GOLD_DIR],
        check=True, cwd=REPO,
    )


def main():
    _load_dotenv()
    creds = _credentials()
    if not creds:
        print("[refresh:data] No Databricks credentials "
              "(DATABRICKS_HOST + DATABRICKS_TOKEN + DATABRICKS_WAREHOUSE_ID).")
        print("[refresh:data] Keeping the committed local public/gold/*.json "
              "slices (the runtime data for local + deployed). Nothing to do.")
        return 0

    host, token, wh = creds
    print(f"[refresh:data] Databricks creds found -> refreshing from {host}")
    try:
        # First pass: emit-slice writes _needed_district_keys.json from the gap
        # table even if the facilities export is stale/missing, so we always
        # have the 211 keys before the export queries.
        _refresh_csv(host, token, wh, "gold_demand_supply_gap_v2",
                     "gold_demand_supply_gap_v2.csv")
        _refresh_csv(host, token, wh, "gold_facility_enriched",
                     "gold_facility_enriched.csv")
        _refresh_csv(host, token, wh, "fct_facility_specialty",
                     "fct_facility_specialty.csv")

        keys = _needed_district_keys()
        if keys is None:
            # bootstrap the keys file via a first emit-slice pass (it exits
            # non-zero when the export is missing; that's expected here).
            subprocess.run(
                [sys.executable, os.path.join(REPO, "recommender", "recommend.py"),
                 "--emit-slice", "--out", GOLD_DIR],
                cwd=REPO,
            )
            keys = _needed_district_keys()
        if not keys:
            raise RuntimeError("could not determine needed district keys")

        _refresh_facilities_export(host, token, wh, keys)
        _refresh_district_cards(host, token, wh, keys)
        _emit_slice()
    except (urllib.error.URLError, RuntimeError, subprocess.CalledProcessError) as e:
        print(f"[refresh:data] FAILED talking to Databricks: {e}", file=sys.stderr)
        print("[refresh:data] The committed local slices are unchanged and "
              "remain valid; re-run when connectivity/creds are fixed.",
              file=sys.stderr)
        return 1

    print("[refresh:data] OK — public/gold/*.json regenerated from live "
          "Databricks. Review `git diff public/gold` and commit if intended.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
