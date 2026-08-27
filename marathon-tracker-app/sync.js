'use strict';

/* ---------------------------------------------------------------------- *
 * Google Sheets sync — client-side OAuth via Google Identity Services.
 *
 * This ONLY works when the app is hosted as a real static website (e.g.
 * GitHub Pages) with its origin registered in a Google Cloud OAuth Client.
 * It does NOT work inside the Claude Artifact sandbox, which blocks all
 * external network calls.
 *
 * No client secret is used or needed — this is the browser "token client"
 * flow, appropriate for a public single-page app. The access token lives
 * only in memory for this tab; reload the page and you'll need to
 * reconnect. Requires the sheet tabs to still be named exactly:
 * "Hooper Index", "Whoop Recovery", "Training Log" (Weekly Summary is left
 * alone — its formulas recompute automatically once the raw tabs update).
 * ---------------------------------------------------------------------- */

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let gisTokenClient = null;
let gisAccessToken = null;
let gisTokenExpiry = 0;

function googleStatus() {
  return { connected: !!gisAccessToken && Date.now() < gisTokenExpiry };
}

function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google Identity Services script.'));
    document.head.appendChild(s);
  });
}

async function googleConnect(clientId) {
  if (!clientId) throw new Error('Set a Google OAuth Client ID first.');
  await loadGisScript();
  return new Promise((resolve, reject) => {
    try {
      gisTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SHEETS_SCOPE,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          gisAccessToken = resp.access_token;
          gisTokenExpiry = Date.now() + (Number(resp.expires_in) || 3500) * 1000;
          resolve(true);
        }
      });
      gisTokenClient.requestAccessToken();
    } catch (err) { reject(err); }
  });
}

function ensureToken() {
  if (!gisAccessToken || Date.now() >= gisTokenExpiry) {
    throw new Error('Not connected — click Connect first.');
  }
  return gisAccessToken;
}

async function sheetsGetValues(spreadsheetId, range) {
  const token = ensureToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return json.values || [];
}

async function sheetsBatchUpdate(spreadsheetId, valueRanges) {
  const token = ensureToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: valueRanges })
  });
  if (!res.ok) throw new Error(`Sheets write failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Google Sheets date serial -> 'YYYY-MM-DD' (UTC, date-only values).
function serialToISO(serial) {
  const utcMs = Math.round((Number(serial) - 25569) * 86400 * 1000);
  const d = new Date(utcMs);
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Best-effort bridge for legacy ambiguous Duration cells: a genuine plain-minutes
// value we write is always >= 1; a leftover Sheets time/duration serial (days
// fraction) for anything under ~24h is always < 1. See README for details.
function unserializeDuration(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (isNaN(n)) return null;
  return n < 1 ? Math.round(n * 1440 * 100) / 100 : n;
}

function buildDateRowMap(rows) {
  // rows[0] is the header; column A holds the date serial.
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i] && rows[i][0];
    if (cell === undefined || cell === '') continue;
    const iso = typeof cell === 'number' ? serialToISO(cell) : String(cell);
    map[iso] = i + 1; // 1-indexed sheet row
  }
  return map;
}

async function googlePush(spreadsheetId, store) {
  if (!spreadsheetId) throw new Error('Set your Spreadsheet ID first.');

  const [hooperRows, whoopRows, logRows] = await Promise.all([
    sheetsGetValues(spreadsheetId, "'Hooper Index'!A:A"),
    sheetsGetValues(spreadsheetId, "'Whoop Recovery'!A:A"),
    sheetsGetValues(spreadsheetId, "'Training Log'!A:A")
  ]);
  const hooperMap = buildDateRowMap(hooperRows);
  const whoopMap = buildDateRowMap(whoopRows);
  const logMap = buildDateRowMap(logRows);

  const data = [];

  for (const e of Object.values(store.hooperIndex)) {
    const row = hooperMap[e.date];
    if (!row) continue; // date outside the pre-templated 19-week range
    data.push({ range: `'Hooper Index'!C${row}:F${row}`, values: [[e.fatigue, e.stress, e.soreness, e.sleepQuality]] });
    data.push({ range: `'Hooper Index'!L${row}`, values: [[e.notes || '']] });
  }

  for (const e of Object.values(store.whoopRecovery)) {
    const row = whoopMap[e.date];
    if (!row) continue;
    data.push({ range: `'Whoop Recovery'!C${row}:G${row}`, values: [[e.recovery, e.restingHR, e.hrv, e.respRate, e.sleepPerf]] });
    data.push({ range: `'Whoop Recovery'!H${row}`, values: [[e.notes || '']] });
  }

  for (const e of Object.values(store.trainingLog)) {
    const row = logMap[e.date];
    if (!row || e.actualDist == null) continue; // don't clobber a template row you haven't logged
    data.push({ range: `'Training Log'!G${row}:L${row}`, values: [[e.actualDist, e.durationMin, e.avgHR, e.rpe, e.soreness, e.notes || '']] });
  }

  if (data.length === 0) return { updatedCells: 0 };
  // Sheets API caps a single batchUpdate at a few thousand ranges; chunk defensively.
  const CHUNK = 200;
  let updatedCells = 0;
  for (let i = 0; i < data.length; i += CHUNK) {
    const res = await sheetsBatchUpdate(spreadsheetId, data.slice(i, i + CHUNK));
    updatedCells += res.totalUpdatedCells || 0;
  }
  return { updatedCells };
}

async function googlePull(spreadsheetId) {
  if (!spreadsheetId) throw new Error('Set your Spreadsheet ID first.');

  const [hooperRows, whoopRows, logRows] = await Promise.all([
    sheetsGetValues(spreadsheetId, "'Hooper Index'!A2:L"),
    sheetsGetValues(spreadsheetId, "'Whoop Recovery'!A2:H"),
    sheetsGetValues(spreadsheetId, "'Training Log'!A2:L")
  ]);

  const hooperIndex = {};
  for (const r of hooperRows) {
    if (!r[0] && r[0] !== 0) continue;
    const date = typeof r[0] === 'number' ? serialToISO(r[0]) : String(r[0]);
    const [fatigue, stress, soreness, sleepQuality] = [r[2], r[3], r[4], r[5]];
    if (fatigue == null && stress == null && soreness == null && sleepQuality == null) continue;
    hooperIndex[date] = { date, fatigue: numOrNull(fatigue), stress: numOrNull(stress), soreness: numOrNull(soreness), sleepQuality: numOrNull(sleepQuality), notes: r[11] || null };
  }

  const whoopRecovery = {};
  for (const r of whoopRows) {
    if (!r[0] && r[0] !== 0) continue;
    const date = typeof r[0] === 'number' ? serialToISO(r[0]) : String(r[0]);
    if (r[2] == null || r[2] === '') continue;
    whoopRecovery[date] = { date, day: r[1] || dayNameForDate(date), recovery: numOrNull(r[2]), restingHR: numOrNull(r[3]), hrv: numOrNull(r[4]), respRate: numOrNull(r[5]), sleepPerf: numOrNull(r[6]), notes: r[7] || null };
  }

  const trainingLog = {};
  for (const row of PLANNED_SCHEDULE) {
    trainingLog[row.date] = { date: row.date, week: row.week, day: row.day, phase: row.phase,
      plannedWorkout: row.plannedWorkout, plannedDist: row.plannedDist,
      actualDist: null, durationMin: null, avgHR: null, rpe: null, soreness: null, notes: null };
  }
  for (const r of logRows) {
    if (!r[0] && r[0] !== 0) continue;
    const date = typeof r[0] === 'number' ? serialToISO(r[0]) : String(r[0]);
    const base = trainingLog[date] || { date, week: numOrNull(r[1]), day: r[2] || dayNameForDate(date), phase: r[3] || null, plannedWorkout: r[4] || null, plannedDist: numOrNull(r[5]) };
    trainingLog[date] = { ...base,
      actualDist: numOrNull(r[6]), durationMin: unserializeDuration(r[7]), avgHR: numOrNull(r[8]),
      rpe: numOrNull(r[9]), soreness: numOrNull(r[10]), notes: r[11] || null };
  }

  return { trainingLog, whoopRecovery, hooperIndex, meta: { pulledAt: new Date().toISOString() } };
}

// app.js defines the global numOrNull() and dayNameForDate() helpers used above;
// app.js is loaded before sync.js in index.html.
