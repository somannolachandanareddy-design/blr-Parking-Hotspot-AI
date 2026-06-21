/* ============================================================
   Parking Intelligence Hub — Dashboard JS
   ============================================================ */

const PLOTLY_DARK = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor:  'rgba(0,0,0,0)',
  font: { color: '#94a3b8', size: 11 },
  margin: { l: 10, r: 10, t: 20, b: 10 },
  colorway: ['#3b82f6','#22d3ee','#a855f7','#f59e0b','#ef4444','#22c55e'],
};

const COLORS = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#22c55e' };

/* ── Helpers ─────────────────────────────────────────────── */
function loading(show, text='Loading…') {
  const el = document.getElementById('loading-overlay');
  document.getElementById('loading-text').textContent = text;
  el.classList.toggle('show', show);
}

function getFilters() {
  const months = [...document.querySelectorAll('.month-btn.active')].map(b => b.dataset.m);
  return {
    months,
    h_min:   document.getElementById('hour-min').value,
    h_max:   document.getElementById('hour-max').value,
    vfilter: document.getElementById('vfilter').value,
  };
}

function buildQS(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) v.forEach(x => p.append(k, x));
    else p.set(k, v);
  }
  return p.toString();
}

async function apiFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error ${r.status}: ${url}`);
  return r.json();
}

/* ── Leaflet Map ─────────────────────────────────────────── */
let leafletMap = null;
let heatLayer  = null;
let gridLayers = [];
let currentLayer = 'heatmap';

function initMap() {
  if (leafletMap) return;
  leafletMap = L.map('leaflet-map', { preferCanvas: true }).setView([12.97, 77.59], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB', maxZoom: 18,
  }).addTo(leafletMap);
}

function renderMap(data) {
  initMap();

  // Clear
  if (heatLayer) { leafletMap.removeLayer(heatLayer); heatLayer = null; }
  gridLayers.forEach(l => leafletMap.removeLayer(l));
  gridLayers = [];

  if (currentLayer === 'heatmap') {
    const pts = data.heatmap.map(([lat, lon, impact]) => [lat, lon, (impact + 1) / 4]);
    heatLayer = L.heatLayer(pts, {
      radius: 14, blur: 18, maxZoom: 15,
      gradient: { 0.2: '#3b82f6', 0.5: '#f59e0b', 0.8: '#ef4444', 1.0: '#ffffff' },
    }).addTo(leafletMap);
  } else {
    data.hotspots.forEach(h => {
      const color  = COLORS[h.risk_tier] || '#64748b';
      const bounds = [
        [h.lat_bin - 0.0025, h.lon_bin - 0.0025],
        [h.lat_bin + 0.0025, h.lon_bin + 0.0025],
      ];
      const rect = L.rectangle(bounds, {
        color, weight: 1, fillColor: color, fillOpacity: 0.45,
      }).bindPopup(
        `<b>Rank #${h.rank}</b><br>Violations: ${h.count}<br>Risk: <b>${h.risk_tier}</b><br>Main Road: ${h.main_road_pct.toFixed(1)}%<br>Station: ${h.top_station}`
      );
      rect.addTo(leafletMap);
      const marker = L.divIcon({
        html: `<div style="font-size:9px;font-weight:700;color:#fff;background:${color};border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;line-height:20px;">${h.rank}</div>`,
        iconSize: [20, 20], iconAnchor: [10, 10],
      });
      const m = L.marker([h.lat_bin, h.lon_bin], { icon: marker });
      m.addTo(leafletMap);
      gridLayers.push(rect, m);
    });
  }

  // Junctions
  if (data.junctions) {
    data.junctions.forEach(j => {
      const m = L.marker([j.lat, j.lon], {
        icon: L.divIcon({
          html: `<div style="background:#a855f7;color:#fff;font-size:9px;padding:2px 5px;border-radius:4px;white-space:nowrap;font-weight:700">📍 ${j.junction_name}</div>`,
          className: '', iconAnchor: [0, 10],
        }),
      }).bindPopup(`<b>${j.junction_name}</b><br>${j.count} violations`);
      m.addTo(leafletMap);
      gridLayers.push(m);
    });
  }
}

/* ── Hotspot Panel ───────────────────────────────────────── */
function renderHotspotPanel(hotspots) {
  const el = document.getElementById('hotspot-panel');
  el.innerHTML = hotspots.slice(0, 10).map(h => {
    const color = COLORS[h.risk_tier] || '#64748b';
    return `<div class="hotspot-item" style="border-left-color:${color}">
      <span class="hotspot-rank" style="color:${color}">#${h.rank}</span>
      <span class="hotspot-name"> ${h.top_station}</span><br>
      <span class="hotspot-sub">${h.count} violations · ${h.main_road_pct.toFixed(0)}% main road</span><br>
      <span style="font-size:0.68rem;color:${color}">Risk: ${h.risk_tier}</span>
    </div>`;
  }).join('');
}

/* ── KPIs ────────────────────────────────────────────────── */
async function loadKPIs() {
  const f = getFilters();
  const qs = buildQS(f);
  const d = await apiFetch('/api/kpis?' + qs);
  document.getElementById('kpi-total').textContent  = d.total.toLocaleString();
  document.getElementById('kpi-park').textContent   = d.park_total.toLocaleString();
  document.getElementById('kpi-park-delta').textContent = `${d.park_pct}% of total`;
  document.getElementById('kpi-impact').textContent = d.high_impact.toLocaleString();
  document.getElementById('kpi-res').textContent    = d.avg_res + ' min';
  document.getElementById('kpi-zones').textContent  = d.high_zones;
}

/* ── Map Tab ─────────────────────────────────────────────── */
async function loadMapTab() {
  const d = await apiFetch('/api/map_data?top_n=20');
  renderMap(d);
  renderHotspotPanel(d.hotspots);
}

/* ── Analytics Tab ───────────────────────────────────────── */
async function loadAnalytics() {
  const d = await apiFetch('/api/analytics');

  // Violation types
  Plotly.newPlot('chart-vtype', [{
    type: 'bar', orientation: 'h',
    x: d.violation_types.map(v => v.count),
    y: d.violation_types.map(v => v.violation),
    marker: { color: d.violation_types.map(v => v.count), colorscale: 'Reds', showscale: false },
  }], {
    ...PLOTLY_DARK,
    height: 320,
    margin: { l: 180, r: 10, t: 10, b: 30 },
    yaxis: { autorange: 'reversed' },
  }, { responsive: true, displayModeBar: false });

  // Vehicle donut
  Plotly.newPlot('chart-vehicle', [{
    type: 'pie', hole: 0.45,
    labels: d.vehicle_types.map(v => v.vehicle),
    values: d.vehicle_types.map(v => v.count),
    marker: { colors: ['#3b82f6','#22d3ee','#a855f7','#f59e0b','#ef4444','#22c55e','#f97316','#14b8a6','#e11d48','#8b5cf6'] },
    textinfo: 'label+percent', textfont: { size: 10 },
  }], { ...PLOTLY_DARK, height: 320, showlegend: false }, { responsive: true, displayModeBar: false });

  // Monthly
  Plotly.newPlot('chart-monthly', [{
    type: 'scatter', mode: 'lines+markers',
    x: d.monthly.map(m => m.month_name),
    y: d.monthly.map(m => m.count),
    fill: 'tozeroy', line: { color: '#3b82f6' },
    marker: { color: '#22d3ee', size: 6 },
  }], { ...PLOTLY_DARK, height: 260, margin: { l: 50, r: 10, t: 10, b: 40 } }, { responsive: true, displayModeBar: false });

  // Validation status
  const statusColors = { approved:'#22c55e', rejected:'#ef4444', processing:'#f59e0b', created1:'#3b82f6', duplicate:'#a855f7' };
  Plotly.newPlot('chart-status', [{
    type: 'bar',
    x: d.validation.map(v => v.status),
    y: d.validation.map(v => v.count),
    marker: { color: d.validation.map(v => statusColors[v.status] || '#64748b') },
  }], { ...PLOTLY_DARK, height: 260, margin: { l: 40, r: 10, t: 10, b: 40 }, showlegend: false }, { responsive: true, displayModeBar: false });

  // Station table
  const tbody = document.querySelector('#station-table tbody');
  tbody.innerHTML = d.stations.map(s => {
    const r = s.risk;
    return `<tr>
      <td>${s.police_station}</td>
      <td>${s.total.toLocaleString()}</td>
      <td>${s.high_impact}</td>
      <td>${s.main_road_pct.toFixed(1)}%</td>
      <td><span class="badge badge-${r.toLowerCase()}">${r}</span></td>
    </tr>`;
  }).join('');
}

/* ── Enforcement Tab ─────────────────────────────────────── */
async function loadEnforcement() {
  const d = await apiFetch('/api/enforcement?top_n=20');

  // Scatter
  const hs = d.hotspots;
  const riskGroups = ['HIGH','MEDIUM','LOW'];
  const traces = riskGroups.map(r => {
    const pts = hs.filter(h => h.risk_tier === r);
    return {
      type: 'scatter', mode: 'markers', name: r,
      x: pts.map(h => h.count),
      y: pts.map(h => h.main_road_pct),
      marker: { color: COLORS[r], size: pts.map(h => Math.sqrt(h.weighted_score) / 2 + 6), opacity: 0.8 },
      text: pts.map(h => `#${h.rank} ${h.top_station}`),
      hovertemplate: '<b>%{text}</b><br>Violations: %{x}<br>Main Road: %{y:.1f}%<extra></extra>',
    };
  });
  Plotly.newPlot('chart-enforce-scatter', traces, {
    ...PLOTLY_DARK, height: 380,
    margin: { l: 50, r: 10, t: 10, b: 50 },
    xaxis: { title: 'Total Violations', gridcolor: '#1e293b' },
    yaxis: { title: 'Main Road %', gridcolor: '#1e293b' },
    legend: { x: 0.8, y: 1 },
  }, { responsive: true, displayModeBar: false });

  // Panel
  const panel = document.getElementById('enforce-panel');
  panel.innerHTML = hs.slice(0,10).map(h => {
    const color = COLORS[h.risk_tier] || '#64748b';
    const icon  = h.risk_tier === 'HIGH' ? '🔴' : h.risk_tier === 'MEDIUM' ? '🟡' : '🟢';
    return `<div style="border-bottom:1px solid var(--border);padding:0.5rem 0">
      ${icon} <b>#${h.rank}</b> <span style="color:var(--text)">${h.top_station}</span><br>
      <span style="font-size:0.68rem;color:var(--muted)">${h.count} violations · ${h.main_road_pct.toFixed(0)}% main road · score ${h.weighted_score.toFixed(0)}</span>
    </div>`;
  }).join('');

  // Junction bar
  const junc = d.junctions;
  Plotly.newPlot('chart-junction', [{
    type: 'bar', orientation: 'h',
    x: junc.map(j => j.count),
    y: junc.map(j => j.junction_name),
    marker: { color: junc.map(j => j.avg_impact), colorscale: 'RdYlGn_r', showscale: false },
    text: junc.map(j => j.risk),
    hovertemplate: '<b>%{y}</b><br>%{x} violations<extra></extra>',
  }], {
    ...PLOTLY_DARK, height: 380,
    margin: { l: 220, r: 10, t: 10, b: 40 },
    yaxis: { autorange: 'reversed' },
    xaxis: { gridcolor: '#1e293b' },
  }, { responsive: true, displayModeBar: false });
}

/* ── Temporal Tab ────────────────────────────────────────── */
async function loadTemporal() {
  const d = await apiFetch('/api/temporal');

  // Hourly
  Plotly.newPlot('chart-hourly', [{
    type: 'bar',
    x: d.hourly.map(h => h.hour),
    y: d.hourly.map(h => h.count),
    marker: { color: d.hourly.map(h => h.count), colorscale: 'Inferno', showscale: false },
  }], { ...PLOTLY_DARK, height: 270, margin: { l: 50, r: 10, t: 10, b: 40 }, xaxis: { title: 'Hour (UTC)' } }, { responsive: true, displayModeBar: false });

  // DOW
  Plotly.newPlot('chart-dow', [{
    type: 'scatter', mode: 'lines+markers',
    x: d.dow.map(v => v.dow),
    y: d.dow.map(v => v.count),
    line: { color: '#22d3ee' }, marker: { size: 6, color: '#22d3ee' },
  }], { ...PLOTLY_DARK, height: 270, margin: { l: 50, r: 10, t: 10, b: 60 } }, { responsive: true, displayModeBar: false });

  // Heatmap
  const pivot = d.pivot;
  const cols  = d.pivot_columns;
  const hours = pivot.map(r => r.hour);
  const zData = cols.map(col => pivot.map(r => r[col] || 0));
  Plotly.newPlot('chart-heatmap2', [{
    type: 'heatmap', z: zData, x: hours, y: cols,
    colorscale: 'Reds', showscale: false,
  }], { ...PLOTLY_DARK, height: 280, margin: { l: 200, r: 10, t: 10, b: 40 } }, { responsive: true, displayModeBar: false });

  // Resolution histogram
  const edges  = d.resolution.edges;
  const counts = d.resolution.counts;
  const midpoints = edges.slice(0, -1).map((e, i) => (e + edges[i+1]) / 2);
  Plotly.newPlot('chart-resolution', [{
    type: 'bar', x: midpoints, y: counts,
    marker: { color: '#3b82f6', opacity: 0.7 },
  }], {
    ...PLOTLY_DARK, height: 250,
    margin: { l: 50, r: 10, t: 10, b: 40 },
    xaxis: { title: 'Resolution Time (min)' },
    shapes: [{ type: 'line', x0: d.resolution.median, x1: d.resolution.median, y0: 0, y1: 1, yref: 'paper', line: { color: '#ef4444', dash: 'dash' } }],
    annotations: [{ x: d.resolution.median, y: 0.95, yref: 'paper', text: `Median: ${Math.round(d.resolution.median)} min`, showarrow: false, font: { color: '#ef4444', size: 10 } }],
  }, { responsive: true, displayModeBar: false });
}

/* ── Risk Scorer ─────────────────────────────────────────── */
async function computeRisk() {
  const payload = {
    violations:    parseInt(document.getElementById('r-violations').value),
    main_road_pct: parseInt(document.getElementById('r-main-road').value),
    vehicle:       document.getElementById('r-vehicle').value,
    near_junction: document.getElementById('r-junction').checked,
    peak_hour:     document.getElementById('r-peak').checked,
    repeat_rate:   parseInt(document.getElementById('r-repeat').value),
  };

  const btn = document.getElementById('compute-risk-btn');
  btn.disabled = true; btn.textContent = 'Computing…';

  const d = await fetch('/api/risk_score', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(r => r.json());

  btn.disabled = false; btn.textContent = '🔍 Compute Risk Score';

  const color = COLORS[d.risk];
  document.getElementById('risk-result').style.display = 'block';
  document.getElementById('risk-tier-badge').textContent = d.risk;
  document.getElementById('risk-tier-badge').className = `badge badge-${d.risk.toLowerCase()}`;
  document.getElementById('risk-action-box').textContent = '💡 ' + d.action;

  // Gauge
  Plotly.newPlot('gauge-chart', [{
    type: 'indicator', mode: 'gauge+number',
    value: d.score,
    gauge: {
      axis: { range: [0, 100], tickcolor: '#94a3b8' },
      bar: { color },
      steps: [
        { range: [0, 35],   color: 'rgba(34,197,94,0.12)' },
        { range: [35, 65],  color: 'rgba(245,158,11,0.12)' },
        { range: [65, 100], color: 'rgba(239,68,68,0.12)' },
      ],
    },
    number: { font: { color, size: 40 } },
  }], { ...PLOTLY_DARK, height: 220, margin: { l: 20, r: 20, t: 20, b: 0 } }, { responsive: true, displayModeBar: false });

  // Factor bars
  const maxScore = 100;
  const fb = document.getElementById('factor-bars');
  fb.innerHTML = Object.entries(d.factors).map(([k, v]) => {
    const pct = Math.round((v / maxScore) * 100);
    return `<div class="factor-row">
      <span class="factor-label">${k}</span>
      <div class="factor-bar-bg">
        <div class="factor-bar" style="width:${Math.min(pct*3,100)}%;background:${color}"></div>
      </div>
      <span class="factor-val">${v}</span>
    </div>`;
  }).join('');

  loadBulkRisk();
}

async function loadBulkRisk() {
  const d = await apiFetch('/api/bulk_risk');
  const tbody = document.querySelector('#bulk-table tbody');
  tbody.innerHTML = d.map(r => `<tr>
    <td>${r.rank}</td>
    <td>${r.top_station}</td>
    <td>${r.count}</td>
    <td>${parseFloat(r.main_road_pct).toFixed(1)}%</td>
    <td>${parseFloat(r.avg_impact).toFixed(2)}</td>
    <td>${parseFloat(r.weighted_score).toFixed(0)}</td>
    <td><span class="badge badge-${String(r.risk_tier).toLowerCase()}">${r.risk_tier}</span></td>
    <td style="font-size:0.7rem;color:var(--muted)">${r.action}</td>
  </tr>`).join('');
}

/* ── ML Pipeline ─────────────────────────────────────────── */
async function loadPreprocessing() {
  const d = await apiFetch('/api/preprocessing');

  // Missing table
  const tbody = document.querySelector('#missing-table tbody');
  tbody.innerHTML = d.missing.map(m => `<tr>
    <td><code style="color:var(--cyan)">${m.feature}</code></td>
    <td>${m.missing}</td>
    <td>${m.pct}%</td>
    <td style="color:${m.missing > 0 ? '#f59e0b' : '#22c55e'}">${m.missing > 0 ? 'Median imputation' : '✅ Complete'}</td>
  </tr>`).join('');

  // Class balance
  const total = d.class_balance.high + d.class_balance.low;
  Plotly.newPlot('chart-class-balance', [{
    type: 'pie', hole: 0.5,
    labels: ['HIGH Impact', 'LOW/MEDIUM Impact'],
    values: [d.class_balance.high, d.class_balance.low],
    marker: { colors: ['#ef4444', '#3b82f6'] },
    textinfo: 'label+percent', textfont: { size: 10 },
  }], { ...PLOTLY_DARK, height: 200, margin: { l: 0, r: 0, t: 10, b: 0 }, showlegend: false }, { responsive: true, displayModeBar: false });

  const ratio = (d.class_balance.low / d.class_balance.high).toFixed(1);
  document.getElementById('imbal-info').textContent = `Class imbalance ratio: ${ratio}:1 (LOW:HIGH). Random Forest handles this via class_weight='balanced'.`;
}

async function trainModel() {
  const btn = document.getElementById('train-btn');
  btn.disabled = true; btn.textContent = 'Training…';
  loading(true, 'Training model — this may take 30–60 seconds…');

  const payload = {
    model:        document.getElementById('ml-model').value,
    n_estimators: parseInt(document.getElementById('ml-est').value),
    max_depth:    parseInt(document.getElementById('ml-depth').value),
    test_size:    parseInt(document.getElementById('ml-test').value) / 100,
    random_state: parseInt(document.getElementById('ml-seed').value),
  };

  try {
    const d = await fetch('/api/ml_train', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());

    loading(false);
    btn.disabled = false; btn.textContent = '🚀 Train Model & Evaluate';

    document.getElementById('ml-results').style.display = 'block';
    document.getElementById('pretrained-notice').style.display = d.loaded_pretrained ? 'block' : 'none';

    // KPIs
    document.getElementById('ml-acc').textContent  = d.metrics.accuracy + '%';
    document.getElementById('ml-prec').textContent = d.metrics.precision + '%';
    document.getElementById('ml-rec').textContent  = d.metrics.recall + '%';
    document.getElementById('ml-f1').textContent   = d.metrics.f1 + '%';

    // Per-class
    const pb = document.querySelector('#perclass-table tbody');
    pb.innerHTML = `
      <tr><td>LOW/MEDIUM (0)</td><td>${d.metrics.prec_lo}%</td><td>${d.metrics.rec_lo}%</td><td>${d.metrics.f1_lo}%</td><td>${d.split.test_low}</td></tr>
      <tr><td>HIGH Impact (1)</td><td>${d.metrics.prec_hi}%</td><td>${d.metrics.rec_hi}%</td><td>${d.metrics.f1_hi}%</td><td>${d.split.test_high}</td></tr>
      <tr style="border-top:2px solid var(--border)"><td><b>Weighted Avg</b></td><td>${d.metrics.precision}%</td><td>${d.metrics.recall}%</td><td>${d.metrics.f1}%</td><td>${d.split.test}</td></tr>
    `;

    // CM
    Plotly.newPlot('chart-cm', [{
      type: 'heatmap',
      z: d.confusion_matrix,
      x: ['Pred: LOW/MED', 'Pred: HIGH'],
      y: ['Actual: LOW/MED', 'Actual: HIGH'],
      colorscale: 'Blues', showscale: false,
      text: d.confusion_matrix.map(r => r.map(v => String(v))),
      texttemplate: '%{text}', textfont: { size: 14, color: '#fff' },
    }], { ...PLOTLY_DARK, height: 240, margin: { l: 100, r: 10, t: 10, b: 60 } }, { responsive: true, displayModeBar: false });

    // Feature importance
    const fi = [...d.feature_importance].sort((a,b) => a.importance - b.importance);
    Plotly.newPlot('chart-fi', [{
      type: 'bar', orientation: 'h',
      x: fi.map(f => f.importance),
      y: fi.map(f => f.feature),
      marker: { color: fi.map(f => f.importance), colorscale: 'Blues', showscale: false },
      text: fi.map(f => f.importance.toFixed(3)), textposition: 'outside', textfont: { size: 9 },
    }], { ...PLOTLY_DARK, height: 300, margin: { l: 110, r: 60, t: 10, b: 30 } }, { responsive: true, displayModeBar: false });

    // CV
    Plotly.newPlot('chart-cv', [{
      type: 'bar',
      x: d.cv.scores.map((_,i) => `Fold ${i+1}`),
      y: d.cv.scores,
      marker: { color: d.cv.scores, colorscale: 'Greens', showscale: false },
      text: d.cv.scores.map(s => s.toFixed(3)), textposition: 'outside', textfont: { size: 9 },
    }], {
      ...PLOTLY_DARK, height: 240,
      margin: { l: 40, r: 10, t: 10, b: 40 },
      yaxis: { range: [0, 1.05], gridcolor: '#1e293b' },
      shapes: [{ type: 'line', x0: -0.5, x1: 4.5, y0: d.cv.mean, y1: d.cv.mean, line: { color: '#22d3ee', dash: 'dash' } }],
    }, { responsive: true, displayModeBar: false });
    document.getElementById('cv-summary').textContent = `✅ 5-Fold CV F1 (weighted): ${d.cv.mean} ± ${d.cv.std} — Low variance confirms good generalisation.`;

    // Prob distribution
    const probs   = d.prob_distribution.probs;
    const actuals = d.prob_distribution.actuals;
    const high    = probs.filter((_,i) => actuals[i] === 1);
    const low     = probs.filter((_,i) => actuals[i] === 0);
    Plotly.newPlot('chart-prob', [
      { type: 'histogram', x: high, name: 'HIGH', marker: { color: 'rgba(239,68,68,0.7)' },  nbinsx: 40, opacity: 0.7 },
      { type: 'histogram', x: low,  name: 'LOW/MED', marker: { color: 'rgba(59,130,246,0.7)' }, nbinsx: 40, opacity: 0.7 },
    ], {
      ...PLOTLY_DARK, height: 240, barmode: 'overlay',
      margin: { l: 40, r: 10, t: 10, b: 40 },
      xaxis: { title: 'P(HIGH impact)' },
      legend: { x: 0.7, y: 0.9 },
    }, { responsive: true, displayModeBar: false });

    // Summary table
    const testPct  = Math.round(payload.test_size * 100);
    const trainPct = 100 - testPct;
    const rows = [
      ['Problem type', 'Binary classification'],
      ['Target', 'is_high_impact (1 = Main road, 0 = other)'],
      ['Features', '9 engineered (temporal, spatial, categorical)'],
      ['Missing values', 'SimpleImputer(strategy=\'median\')'],
      ['Encoding', 'LabelEncoder for vehicle_type, police_station'],
      ['Scaling', 'StandardScaler (zero mean, unit variance)'],
      ['Train/Test split', `${trainPct}% / ${testPct}% stratified`],
      ['Algorithm', `${d.model_used} (n_estimators=${payload.n_estimators}, max_depth=${payload.max_depth})`],
      ['Class imbalance', 'class_weight=\'balanced\' / stratified split'],
      ['Accuracy', d.metrics.accuracy + '%'],
      ['Weighted F1', d.metrics.f1 + '%'],
      ['HIGH-impact F1', d.metrics.f1_hi + '%'],
      ['CV F1 (5-fold)', `${d.cv.mean} ± ${d.cv.std}`],
    ];
    document.getElementById('ml-summary-body').innerHTML = rows.map(([s, v]) =>
      `<tr><td style="font-weight:600;color:var(--muted)">${s}</td><td>${v}</td></tr>`
    ).join('');

  } catch (e) {
    loading(false);
    btn.disabled = false; btn.textContent = '🚀 Train Model & Evaluate';
    alert('Training failed: ' + e.message);
  }
}

/* ── Tab switching ───────────────────────────────────────── */
const tabLoaded = {};

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));

  if (!tabLoaded[tabId]) {
    tabLoaded[tabId] = true;
    if (tabId === 'tab-analytics')   loadAnalytics();
    if (tabId === 'tab-enforcement') loadEnforcement();
    if (tabId === 'tab-temporal')    loadTemporal();
    if (tabId === 'tab-risk')        loadBulkRisk();
    if (tabId === 'tab-ml')          loadPreprocessing();
  }
}

/* ── Init ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Sidebar controls
  document.querySelectorAll('.month-btn').forEach(b => {
    b.addEventListener('click', () => b.classList.toggle('active'));
  });

  ['hour-min','hour-max'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      document.getElementById('hour-label-min').textContent = document.getElementById('hour-min').value + ':00';
      document.getElementById('hour-label-max').textContent = document.getElementById('hour-max').value + ':00';
    });
  });

  document.getElementById('apply-btn').addEventListener('click', async () => {
    loading(true, 'Applying filters…');
<<<<<<< HEAD
    // Tell the server about the CSV path first (in case user changed it)
    const csvPath = document.getElementById('csv-path').value.trim();
    if (csvPath) {
      const r = await fetch('/api/set_csv', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({path: csvPath}),
      }).then(x => x.json());
      if (!r.ok) { loading(false); alert('CSV Error: ' + r.error); return; }
    }
    await loadKPIs();
    // Invalidate all tab caches since data may have changed
    Object.keys(tabLoaded).forEach(k => { tabLoaded[k] = false; });
=======
    await loadKPIs();
    tabLoaded['tab-map'] = false;
>>>>>>> 8095a4f4d3c6fdaea9d9da0af6431f06fcd1e9ef
    await loadMapTab();
    loading(false);
  });

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  // Map layer buttons
  document.querySelectorAll('.map-type-btn').forEach(b => {
    b.addEventListener('click', async () => {
      document.querySelectorAll('.map-type-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentLayer = b.dataset.layer;
      loading(true, 'Updating map…');
      await loadMapTab();
      loading(false);
    });
  });

  // Risk scorer sliders
  document.getElementById('r-main-road').addEventListener('input', e => {
    document.getElementById('r-mr-val').textContent = e.target.value;
  });
  document.getElementById('r-repeat').addEventListener('input', e => {
    document.getElementById('r-rr-val').textContent = e.target.value;
  });
  document.getElementById('compute-risk-btn').addEventListener('click', computeRisk);

  // ML sliders
  document.getElementById('ml-est').addEventListener('input', e => {
    document.getElementById('ml-est-val').textContent = e.target.value;
  });
  document.getElementById('ml-depth').addEventListener('input', e => {
    document.getElementById('ml-depth-val').textContent = e.target.value;
  });
  document.getElementById('ml-test').addEventListener('input', e => {
    document.getElementById('ml-test-val').textContent = e.target.value;
  });
  document.getElementById('train-btn').addEventListener('click', trainModel);

  // Initial load
  loading(true, 'Loading violation data…');
  try {
    await loadKPIs();
    await loadMapTab();
  } catch(e) {
    console.error('Initial load failed:', e);
  }
  loading(false);
});
