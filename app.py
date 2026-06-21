"""
AI-Driven Parking Intelligence Hub — Flask Version
Bengaluru Traffic Police | Jan–May Violations
"""

from flask import Flask, jsonify, render_template, request
import pandas as pd
import numpy as np
import joblib
import os
import warnings
warnings.filterwarnings("ignore")

from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, confusion_matrix
)
from sklearn.impute import SimpleImputer

app = Flask(__name__)

# ─── JSON encoder: turn NaN/Inf → null so jsonify never crashes ───────────────
import math, json as _json
class _SafeEncoder(app.json_provider_class):
    def dumps(self, obj, **kw):
        def _clean(o):
            if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
                return None
            if isinstance(o, dict):
                return {k: _clean(v) for k, v in o.items()}
            if isinstance(o, list):
                return [_clean(v) for v in o]
            return o
        return super().dumps(_clean(obj), **kw)
app.json_provider_class = _SafeEncoder
app.json = _SafeEncoder(app)

# ─── Resolve paths relative to this script, not the CWD ──────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Global state ─────────────────────────────────────────────────────────────
_df_cache = None
_hotspot_cache = None


def load_data(path: str) -> pd.DataFrame:
    global _df_cache
    if _df_cache is not None:
        return _df_cache

    df = pd.read_csv(path, low_memory=False)

    df["created_datetime"] = pd.to_datetime(df["created_datetime"], utc=True, errors="coerce")
    df["hour"]  = df["created_datetime"].dt.hour
    df["month"] = df["created_datetime"].dt.month
    df["dow"]   = df["created_datetime"].dt.day_name()
    df["date"]  = df["created_datetime"].dt.date

    df["violation_clean"] = (
        df["violation_type"]
        .fillna("UNKNOWN")
        .str.replace(r'[\[\]"]', "", regex=True)
        .str.strip()
    )
    df["primary_violation"] = df["violation_clean"].str.split(",").str[0].str.strip()

    PARKING_KEYWORDS = ["PARKING", "NO PARKING", "WRONG PARKING", "FOOTPATH"]
    df["is_parking"] = df["violation_clean"].str.contains(
        "|".join(PARKING_KEYWORDS), case=False, na=False
    )

    def impact(row):
        v = str(row["violation_clean"]).upper()
        if "MAIN ROAD" in v:
            return 3
        if "FOOTPATH" in v or "DOUBLE" in v or "BUSTOP" in v or "SCHOOL" in v:
            return 2
        if "NO PARKING" in v or "WRONG PARKING" in v:
            return 1
        return 0

    df["impact_score"] = df.apply(impact, axis=1)
    df = df.dropna(subset=["latitude", "longitude"])
    df = df[(df["latitude"] > 12.7) & (df["latitude"] < 13.4)]
    df = df[(df["longitude"] > 77.4) & (df["longitude"] < 77.9)]

    df["closed_datetime"] = pd.to_datetime(df["closed_datetime"], utc=True, errors="coerce")
    df["resolution_min"] = (
        (df["closed_datetime"] - df["created_datetime"]).dt.total_seconds() / 60
    ).clip(0, 1440)

    month_map = {1:"Jan", 2:"Feb", 3:"Mar", 4:"Apr", 11:"Nov", 12:"Dec"}
    df["month_name"] = df["month"].map(month_map).fillna("Other")

    _df_cache = df
    return df


def compute_hotspots(df: pd.DataFrame, grid_size: float = 0.005) -> pd.DataFrame:
    parking = df[df["is_parking"]].copy()
    parking["lat_bin"] = (parking["latitude"]  / grid_size).round() * grid_size
    parking["lon_bin"] = (parking["longitude"] / grid_size).round() * grid_size

    agg = parking.groupby(["lat_bin", "lon_bin"]).agg(
        count=("id", "count"),
        avg_impact=("impact_score", "mean"),
        main_road_pct=("violation_clean", lambda x: x.str.contains("MAIN ROAD").mean() * 100),
        top_violation=("primary_violation", lambda x: x.mode().iloc[0] if len(x) > 0 else "N/A"),
        top_station=("police_station", lambda x: x.mode().iloc[0] if len(x) > 0 else "N/A"),
    ).reset_index()

    agg["weighted_score"] = agg["count"] * agg["avg_impact"]
    agg["risk_tier"] = pd.cut(
        agg["weighted_score"],
        bins=[0, 50, 200, float("inf")],
        labels=["LOW", "MEDIUM", "HIGH"],
    ).astype(str)
    agg = agg.sort_values("weighted_score", ascending=False).reset_index(drop=True)
    agg["rank"] = agg.index + 1
    return agg


def get_df():
    default = os.path.join(BASE_DIR, "data", "violations.csv")
    path = os.environ.get("VIOLATIONS_CSV", default)
    return load_data(path)


def get_hotspots(df):
    global _hotspot_cache
    if _hotspot_cache is None:
        _hotspot_cache = compute_hotspots(df)
    return _hotspot_cache


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/set_csv", methods=["POST"])
def api_set_csv():
    global _df_cache, _hotspot_cache
    raw = request.json.get("path", "").strip()
    if not raw:
        return jsonify({"ok": False, "error": "No path provided"})
    # Resolve relative paths against BASE_DIR
    path = raw if os.path.isabs(raw) else os.path.join(BASE_DIR, raw)
    if not os.path.exists(path):
        return jsonify({"ok": False, "error": f"File not found: {path}"})
    _df_cache = None
    _hotspot_cache = None
    os.environ["VIOLATIONS_CSV"] = path
    return jsonify({"ok": True, "path": path})


@app.route("/api/kpis")
def api_kpis():
    df = get_df()
    months = request.args.getlist("months", type=int)
    h_min  = request.args.get("h_min", 0, type=int)
    h_max  = request.args.get("h_max", 23, type=int)
    vfilter = request.args.get("vfilter", "All")

    filtered = df.copy()
    if months:
        filtered = filtered[filtered["month"].isin(months)]
    filtered = filtered[(filtered["hour"] >= h_min) & (filtered["hour"] <= h_max)]
    if vfilter != "All":
        filtered = filtered[filtered["violation_clean"].str.contains(vfilter, case=False, na=False)]

    parking = filtered[filtered["is_parking"]]
    total      = len(filtered)
    park_total = len(parking)
    park_pct   = round(park_total / total * 100, 1) if total else 0
    high_impact = int((parking["impact_score"] == 3).sum())
    res_series  = parking["resolution_min"].dropna()
    avg_res     = float(res_series.median()) if len(res_series) else 0
    avg_res     = 0 if (np.isnan(avg_res) or np.isinf(avg_res)) else avg_res
    hotspots = get_hotspots(df)
    high_zones = int((hotspots["risk_tier"] == "HIGH").sum())

    return jsonify({
        "total": total,
        "park_total": park_total,
        "park_pct": park_pct,
        "high_impact": high_impact,
        "avg_res": round(avg_res),
        "high_zones": high_zones,
    })


@app.route("/api/map_data")
def api_map_data():
    df = get_df()
    parking = df[df["is_parking"]]
    sample = parking.sample(min(len(parking), 20000), random_state=42)
    points = sample[["latitude", "longitude", "impact_score"]].values.tolist()

    hotspots = get_hotspots(df)
    top_n = request.args.get("top_n", 20, type=int)
    hot = hotspots.head(top_n)[["lat_bin","lon_bin","count","main_road_pct","risk_tier","top_station","rank","weighted_score"]].copy()
    hot = hot.fillna("")

    # Top junctions
    junctions_raw = (
        parking[parking["junction_name"].notna() & (parking["junction_name"] != "No Junction")]
        .groupby("junction_name")
        .agg(lat=("latitude","mean"), lon=("longitude","mean"), count=("id","count"))
        .nlargest(5,"count")
        .reset_index()
    )

    return jsonify({
        "heatmap": points,
        "hotspots": hot.to_dict(orient="records"),
        "junctions": junctions_raw.to_dict(orient="records"),
    })


@app.route("/api/analytics")
def api_analytics():
    df = get_df()
    parking = df[df["is_parking"]]

    # Violation type breakdown
    vtype = df["primary_violation"].value_counts().nlargest(12).reset_index()
    vtype.columns = ["violation","count"]

    # Vehicle type
    veh = parking["vehicle_type"].value_counts().nlargest(10).reset_index()
    veh.columns = ["vehicle","count"]

    # Monthly trend
    order = ["Nov","Dec","Jan","Feb","Mar","Apr"]
    monthly = df.groupby("month_name").size().reset_index(name="count")
    monthly["sort"] = monthly["month_name"].apply(lambda x: order.index(x) if x in order else 99)
    monthly = monthly.sort_values("sort")[["month_name","count"]]

    # Validation status
    vs = df["validation_status"].value_counts().reset_index()
    vs.columns = ["status","count"]

    # Top stations
    station_df = (
        parking.groupby("police_station")
        .agg(
            total=("id","count"),
            high_impact=("impact_score", lambda x: (x==3).sum()),
            avg_score=("impact_score","mean"),
            main_road_pct=("violation_clean", lambda x: x.str.contains("MAIN ROAD").mean()*100),
        )
        .nlargest(15,"total")
        .reset_index()
    )
    station_df["risk"] = station_df["avg_score"].apply(
        lambda x: "HIGH" if x >= 2 else ("MEDIUM" if x >= 1 else "LOW")
    )

    return jsonify({
        "violation_types": vtype.to_dict(orient="records"),
        "vehicle_types": veh.to_dict(orient="records"),
        "monthly": monthly.to_dict(orient="records"),
        "validation": vs.to_dict(orient="records"),
        "stations": station_df[["police_station","total","high_impact","main_road_pct","risk"]].to_dict(orient="records"),
    })


@app.route("/api/enforcement")
def api_enforcement():
    df = get_df()
    hotspots = get_hotspots(df)
    top_n = request.args.get("top_n", 20, type=int)
    risk_filter = request.args.getlist("risk")

    filtered = hotspots.copy()
    if risk_filter:
        filtered = filtered[filtered["risk_tier"].isin(risk_filter)]

    top = filtered.head(top_n).fillna("").copy()

    # Junction analysis
    parking = df[df["is_parking"]]
    junctions = (
        parking[parking["junction_name"].notna() & (parking["junction_name"] != "No Junction")]
        .groupby("junction_name")
        .agg(
            count=("id","count"),
            avg_impact=("impact_score","mean"),
            main_road_pct=("violation_clean", lambda x: x.str.contains("MAIN ROAD").mean()*100),
            top_vehicle=("vehicle_type", lambda x: x.mode().iloc[0] if len(x) else "N/A"),
        )
        .nlargest(20,"count")
        .reset_index()
    )
    junctions["priority_score"] = (junctions["count"] * junctions["avg_impact"]).round(1)
    junctions["risk"] = junctions["avg_impact"].apply(
        lambda x: "HIGH" if x >= 2 else ("MEDIUM" if x >= 1 else "LOW")
    )

    return jsonify({
        "hotspots": top.to_dict(orient="records"),
        "junctions": junctions.to_dict(orient="records"),
    })


@app.route("/api/temporal")
def api_temporal():
    df = get_df()
    parking = df[df["is_parking"]]

    # Hourly
    hourly = parking.groupby("hour").size().reset_index(name="count")

    # Day of week
    DOW_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
    dow = parking.groupby("dow").size().reset_index(name="count")
    dow["sort"] = dow["dow"].apply(lambda x: DOW_ORDER.index(x) if x in DOW_ORDER else 99)
    dow = dow.sort_values("sort")[["dow","count"]]

    # Heatmap: hour x violation type
    top_vtypes = parking["primary_violation"].value_counts().nlargest(6).index.tolist()
    pivot = (
        parking[parking["primary_violation"].isin(top_vtypes)]
        .groupby(["hour","primary_violation"])
        .size()
        .unstack(fill_value=0)
        .reset_index()
    )

    # Resolution distribution
    res = parking["resolution_min"].dropna()
    if len(res) > 0:
        hist, edges = np.histogram(res, bins=50)
        res_median = float(res.median())
        res_median = 0 if (np.isnan(res_median) or np.isinf(res_median)) else res_median
    else:
        hist, edges = np.array([0]), np.array([0, 1])
        res_median = 0
    resolution = {
        "counts": hist.tolist(),
        "edges": edges.tolist(),
        "median": res_median,
    }

    return jsonify({
        "hourly": hourly.to_dict(orient="records"),
        "dow": dow.to_dict(orient="records"),
        "pivot": pivot.to_dict(orient="records"),
        "pivot_columns": [c for c in pivot.columns if c != "hour"],
        "resolution": resolution,
    })


@app.route("/api/risk_score", methods=["POST"])
def api_risk_score():
    data = request.json
    violations    = data.get("violations", 150)
    main_road_pct = data.get("main_road_pct", 30)
    vehicle       = data.get("vehicle", "CAR")
    near_junction = data.get("near_junction", False)
    peak_hour     = data.get("peak_hour", False)
    repeat_rate   = data.get("repeat_rate", 20)

    score = 0
    if violations > 500:   score += 40
    elif violations > 200: score += 25
    elif violations > 50:  score += 12
    else:                  score += 5

    score += main_road_pct * 0.35

    vehicle_weights = {"BUS":12,"LGV":10,"MAXI-CAB":8,"PASSENGER AUTO":5,"CAR":4,"MOTOR CYCLE":2,"SCOOTER":1}
    score += vehicle_weights.get(vehicle, 3)

    if near_junction: score += 15
    if peak_hour:     score += 12
    score += repeat_rate * 0.1
    score = min(score, 100)

    if score >= 65:
        risk   = "HIGH"
        action = "Deploy dedicated enforcement unit immediately"
    elif score >= 35:
        risk   = "MEDIUM"
        action = "Schedule regular patrol (twice daily)"
    else:
        risk   = "LOW"
        action = "Monitor remotely — include in weekly sweep"

    factors = {
        "Volume":        min(40, 40 if violations > 500 else (25 if violations > 200 else (12 if violations > 50 else 5))),
        "Main Road":     round(main_road_pct * 0.35, 1),
        "Vehicle":       vehicle_weights.get(vehicle, 3),
        "Junction":      15 if near_junction else 0,
        "Peak Hour":     12 if peak_hour else 0,
        "Repeat Rate":   round(repeat_rate * 0.1, 1),
    }

    return jsonify({"score": round(score), "risk": risk, "action": action, "factors": factors})


@app.route("/api/bulk_risk")
def api_bulk_risk():
    df = get_df()
    hotspots = get_hotspots(df)
    bulk = hotspots.head(30).copy()
    bulk["risk_tier"] = bulk["risk_tier"].astype(str)
    bulk["action"] = bulk["risk_tier"].map({
        "HIGH":   "Immediate unit deployment",
        "MEDIUM": "Twice-daily patrol",
        "LOW":    "Weekly sweep",
    })
    bulk = bulk[["rank","top_station","count","main_road_pct","avg_impact","weighted_score","risk_tier","action"]].fillna("")
    return jsonify(bulk.to_dict(orient="records"))


@app.route("/api/ml_train", methods=["POST"])
def api_ml_train():
    data = request.json
    model_name   = data.get("model", "Random Forest")
    n_estimators = data.get("n_estimators", 100)
    max_depth    = data.get("max_depth", 6)
    test_size    = data.get("test_size", 0.2)
    random_state = data.get("random_state", 42)

    df = get_df()
    parking = df[df["is_parking"]].copy()
    parking = parking.dropna(subset=["latitude","longitude","vehicle_type","police_station"])

    parking["is_high_impact"] = (parking["impact_score"] == 3).astype(int)
    parking["dow_num"]        = parking["created_datetime"].dt.dayofweek
    parking["near_junction"]  = (parking["junction_name"] != "No Junction").astype(int)

    grid = 0.005
    parking["lat_bin"] = (parking["latitude"] / grid).round() * grid
    parking["lon_bin"] = (parking["longitude"] / grid).round() * grid
    density = parking.groupby(["lat_bin","lon_bin"])["id"].transform("count")
    parking["area_density"] = density

    le_veh = LabelEncoder()
    le_sta = LabelEncoder()
    parking["vehicle_enc"] = le_veh.fit_transform(parking["vehicle_type"].fillna("UNKNOWN"))
    parking["station_enc"] = le_sta.fit_transform(parking["police_station"].fillna("UNKNOWN"))

    FEATURES = ["hour","month","dow_num","latitude","longitude","vehicle_enc","station_enc","near_junction","area_density"]
    X = parking[FEATURES].copy()
    y = parking["is_high_impact"].copy()

    imputer = SimpleImputer(strategy="median")
    X_imp   = imputer.fit_transform(X)
    scaler  = StandardScaler()
    X_scaled = scaler.fit_transform(X_imp)

    MAX_ROWS = 50_000
    if len(X_scaled) > MAX_ROWS:
        idx = np.random.RandomState(random_state).choice(len(X_scaled), MAX_ROWS, replace=False)
        X_s, y_s = X_scaled[idx], y.iloc[idx]
    else:
        X_s, y_s = X_scaled, y

    X_train, X_test, y_train, y_test = train_test_split(
        X_s, y_s, test_size=test_size, random_state=random_state, stratify=y_s
    )

    MODEL_PKL = os.path.join(BASE_DIR, "model.pkl")
    if model_name == "Random Forest" and os.path.exists(MODEL_PKL):
        model = joblib.load(MODEL_PKL)
    elif model_name == "Random Forest":
        model = RandomForestClassifier(
            n_estimators=n_estimators, max_depth=max_depth,
            class_weight="balanced", random_state=random_state, n_jobs=-1,
        )
        model.fit(X_train, y_train)
    else:
        model = GradientBoostingClassifier(
            n_estimators=n_estimators, max_depth=max_depth, random_state=random_state,
        )
        model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1].tolist()

    acc   = float(accuracy_score(y_test, y_pred))
    prec  = float(precision_score(y_test, y_pred, average="weighted", zero_division=0))
    rec   = float(recall_score(y_test, y_pred, average="weighted", zero_division=0))
    f1    = float(f1_score(y_test, y_pred, average="weighted", zero_division=0))
    prec_hi = float(precision_score(y_test, y_pred, pos_label=1, zero_division=0))
    rec_hi  = float(recall_score(y_test, y_pred, pos_label=1, zero_division=0))
    f1_hi   = float(f1_score(y_test, y_pred, pos_label=1, zero_division=0))
    prec_lo = float(precision_score(y_test, y_pred, pos_label=0, zero_division=0))
    rec_lo  = float(recall_score(y_test, y_pred, pos_label=0, zero_division=0))
    f1_lo   = float(f1_score(y_test, y_pred, pos_label=0, zero_division=0))

    cm = confusion_matrix(y_test, y_pred).tolist()
    fi = model.feature_importances_.tolist()

    cv_scores = cross_val_score(model, X_s, y_s, cv=5, scoring="f1_weighted", n_jobs=-1)

    # Class balance
    class_counts = y.value_counts()
    imbal = float(class_counts.get(0,0) / class_counts.get(1,1))

    # Prob distribution sample
    y_test_list = y_test.tolist()

    return jsonify({
        "metrics": {
            "accuracy": round(acc*100,2),
            "precision": round(prec*100,2),
            "recall": round(rec*100,2),
            "f1": round(f1*100,2),
            "prec_hi": round(prec_hi*100,2),
            "rec_hi": round(rec_hi*100,2),
            "f1_hi": round(f1_hi*100,2),
            "prec_lo": round(prec_lo*100,2),
            "rec_lo": round(rec_lo*100,2),
            "f1_lo": round(f1_lo*100,2),
        },
        "confusion_matrix": cm,
        "feature_importance": [{"feature": f, "importance": round(i, 4)} for f, i in zip(FEATURES, fi)],
        "cv": {
            "scores": [round(s, 4) for s in cv_scores.tolist()],
            "mean": round(float(cv_scores.mean()), 4),
            "std": round(float(cv_scores.std()), 4),
        },
        "split": {
            "train": len(X_train),
            "test": len(X_test),
            "test_high": int(y_test.sum()),
            "test_low": int((y_test == 0).sum()),
        },
        "class_imbalance": round(imbal, 1),
        "prob_distribution": {
            "probs": [round(p,3) for p in y_prob[:2000]],
            "actuals": y_test_list[:2000],
        },
        "features": FEATURES,
        "model_used": model_name,
        "loaded_pretrained": (model_name == "Random Forest" and os.path.exists(MODEL_PKL)),
    })


@app.route("/api/preprocessing")
def api_preprocessing():
    df = get_df()
    parking = df[df["is_parking"]].copy()
    parking = parking.dropna(subset=["latitude","longitude","vehicle_type","police_station"])

    le_veh = LabelEncoder()
    le_sta = LabelEncoder()
    le_veh.fit(parking["vehicle_type"].fillna("UNKNOWN"))
    le_sta.fit(parking["police_station"].fillna("UNKNOWN"))

    FEATURES = ["hour","month","dow_num","latitude","longitude","vehicle_enc","station_enc","near_junction","area_density"]
    missing_info = []
    for f in FEATURES:
        if f in parking.columns:
            m = int(parking[f].isnull().sum())
            missing_info.append({"feature": f, "missing": m, "pct": round(m/len(parking)*100,2)})
        else:
            missing_info.append({"feature": f, "missing": 0, "pct": 0.0})

    parking["is_high_impact"] = (parking["impact_score"] == 3).astype(int)
    class_counts = parking["is_high_impact"].value_counts()

    return jsonify({
        "missing": missing_info,
        "vehicle_encoding": [{"vehicle": v, "code": i} for i, v in enumerate(le_veh.classes_[:12])],
        "station_encoding": [{"station": v, "code": i} for i, v in enumerate(le_sta.classes_[:10])],
        "class_balance": {
            "high": int(class_counts.get(1,0)),
            "low": int(class_counts.get(0,0)),
        },
        "total_parking_rows": len(parking),
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
