# 🚦 AI Parking Intelligence Hub — Flask

> Migrated from Streamlit to Flask for full production deployment control.

## Project Structure

```
flask_app/
├── app.py                  ← Flask server + all API endpoints
├── model.pkl               ← Pre-trained Random Forest model
├── requirements.txt        ← Python dependencies
├── data/
│   └── violations.csv      ← Dataset (download separately)
├── templates/
│   └── index.html          ← Single-page dashboard
└── static/
    └── js/
        └── dashboard.js    ← All chart & API logic (Plotly + Leaflet)
```

## Quick Start

```bash
# 1. Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Place dataset
mkdir data
# Copy violations.csv into data/

# 4. Run development server
python app.py
# → Open http://localhost:5000

# 5. Production (gunicorn)
gunicorn -w 2 -b 0.0.0.0:5000 app:app
```

## Environment Variables

| Variable         | Default               | Description                    |
|------------------|-----------------------|--------------------------------|
| `VIOLATIONS_CSV` | `data/violations.csv` | Path to the violations dataset |

```bash
VIOLATIONS_CSV=/path/to/file.csv python app.py
```

## API Endpoints

| Endpoint              | Method | Description                          |
|-----------------------|--------|--------------------------------------|
| `/`                   | GET    | Dashboard HTML                       |
| `/api/kpis`           | GET    | KPI metrics (filterable)             |
| `/api/map_data`       | GET    | Heatmap points + hotspot grids       |
| `/api/analytics`      | GET    | Charts data (violations, vehicles…)  |
| `/api/enforcement`    | GET    | Hotspot zones + junction analysis    |
| `/api/temporal`       | GET    | Hourly, DOW, resolution data         |
| `/api/risk_score`     | POST   | Compute AI risk score for a zone     |
| `/api/bulk_risk`      | GET    | Risk table for top 30 hotspots       |
| `/api/preprocessing`  | GET    | ML preprocessing info                |
| `/api/ml_train`       | POST   | Train + evaluate ML model            |

## Filter Query Params (`/api/kpis`)

```
?months=1&months=2&h_min=8&h_max=20&vfilter=NO+PARKING
```

## Features

- 🗺️ **Interactive Leaflet map** — Heatmap & Risk Grid layers
- 📊 **Plotly charts** — violation types, vehicles, trends
- 🔥 **Enforcement zones** — ranked by weighted congestion score
- ⏱️ **Temporal analysis** — hourly, DOW, resolution time
- 🤖 **AI Risk Scorer** — real-time zone risk with gauge
- 🧪 **ML Pipeline** — preprocessing → training → evaluation
  - Random Forest / Gradient Boosting
  - Confusion matrix, feature importance, 5-fold CV
  - Loads pre-trained `model.pkl` instantly for RF

## Tech Stack

- **Backend**: Flask (Python)
- **Maps**: Leaflet.js + leaflet-heat plugin
- **Charts**: Plotly.js
- **ML**: scikit-learn (RandomForest, GradientBoosting)
- **No Streamlit, no npm, no build step**

## Dataset

Download from HackerEarth and place at `data/violations.csv`.

Columns used: `latitude`, `longitude`, `violation_type`, `vehicle_type`,
`police_station`, `junction_name`, `created_datetime`, `closed_datetime`,
`validation_status`, `id`
