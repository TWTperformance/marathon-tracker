'use strict';

/* ---------------------------------------------------------------------- *
 * Google Sheets sync — via a Google Apps Script Web App bound to your
 * sheet (see Code.gs). No Google Cloud project, no OAuth client, no
 * sign-in popup: the script runs with your own Google account's access
 * to the sheet, and this app just calls its URL with a shared token.
 *
 * This ONLY works when the app is hosted as a real static website (e.g.
 * GitHub Pages), not inside the Claude Artifact sandbox, which blocks all
 * external network calls.
 *
 * Uses text/plain as the request content-type (not application/json) so
 * the browser sends it as a "simple request" and skips a CORS preflight —
 * Apps Script Web Apps don't handle preflighted OPTIONS requests well.
 * ---------------------------------------------------------------------- */

async function callAppsScript(url, token, action, data) {
    if (!url) throw new Error('Set your Apps Script Web App URL first.');
    if (!token) throw new Error('Set your Sync Token first (must match Code.gs).');

  const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token, action, data })
  });
    if (!res.ok) throw new Error(`Sync endpoint returned HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown sync error.');
    return json;
}

async function googlePing(url, token) {
    const res = await callAppsScript(url, token, 'ping');
    return res.pong === true;
}

// Sends data in small batches instead of one large request. Some mobile
// Chrome builds fail ("Failed to fetch") on a large POST body to Apps
// Script's /exec URL (which internally redirects to a different Google
// domain to serve the response) even though the same request works fine
// on desktop Chrome with a small body. Batching sidesteps that regardless
// of the exact cause, and means earlier batches are saved even if a later
// one fails.
const PUSH_BATCH_SIZE = 12;

async function googlePush(url, token, store, onProgress) {
  const items = [];
  for (const e of Object.values(store.hooperIndex || {})) items.push({ type: 'hooperIndex', entry: e });
  for (const e of Object.values(store.whoopRecovery || {})) items.push({ type: 'whoopRecovery', entry: e });
  for (const e of Object.values(store.trainingLog || {})) {
    if (e.actualDist != null) items.push({ type: 'trainingLog', entry: e }); // skip un-logged template rows — Code.gs skips these anyway
  }

  const totalBatches = Math.max(1, Math.ceil(items.length / PUSH_BATCH_SIZE));
  let updatedRows = 0;

  for (let i = 0, batchNum = 1; i < items.length; i += PUSH_BATCH_SIZE, batchNum++) {
    const chunk = items.slice(i, i + PUSH_BATCH_SIZE);
    const partial = { hooperIndex: {}, whoopRecovery: {}, trainingLog: {} };
    for (const { type, entry } of chunk) partial[type][entry.date] = entry;

    if (onProgress) onProgress(batchNum, totalBatches);

    // One retry on a transient failure before giving up on this batch.
    let res;
    try {
      res = await callAppsScript(url, token, 'push', partial);
    } catch (err) {
      res = await callAppsScript(url, token, 'push', partial);
    }
    updatedRows += (res.result && res.result.updatedRows) || 0;
  }

  if (items.length === 0) return { updatedRows: 0 };
  return { updatedRows };
}

async function googlePull(url, token) {
    const res = await callAppsScript(url, token, 'pull');
    const pulled = res.data;

  // Fill in any plan-template rows the sheet didn't have data for yet (e.g.
  // future weeks), same as the local seeding logic, so the shape always
  // matches what the rest of the app expects.
  const trainingLog = { ...pulled.trainingLog };
    for (const row of PLANNED_SCHEDULE) {
          if (!trainingLog[row.date]) {
                  trainingLog[row.date] = { date: row.date, week: row.week, day: row.day, phase: row.phase,
                                                   plannedWorkout: row.plannedWorkout, plannedDist: row.plannedDist,
                                                   actualDist: null, durationMin: null, avgHR: null, rpe: null, soreness: null, notes: null };
          }
    }

  return { trainingLog, whoopRecovery: pulled.whoopRecovery, hooperIndex: pulled.hooperIndex, meta: { pulledAt: new Date().toISOString() } };
}
