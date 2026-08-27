'use strict';

/* ---------------------------------------------------------------------- *
 * Storage layer
 * ---------------------------------------------------------------------- */

const STORE_KEY = 'mt_data_v1';
const SETTINGS_KEY = 'mt_settings_v1';

function loadStore() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* fall through to reseed */ }
  }
  return seedStore();
}

function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return { appsScriptUrl: '', syncToken: '', lastPush: null, lastPull: null };
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function seedStore() {
  const trainingLog = {};
  for (const row of PLANNED_SCHEDULE) {
    trainingLog[row.date] = {
      date: row.date, week: row.week, day: row.day, phase: row.phase,
      plannedWorkout: row.plannedWorkout, plannedDist: row.plannedDist,
      actualDist: null, durationMin: null, avgHR: null, rpe: null, soreness: null, notes: null
    };
  }
  for (const row of SEED_DATA.trainingLog) {
    if (!trainingLog[row.date]) {
      trainingLog[row.date] = { date: row.date, week: row.week, day: row.day, phase: row.phase,
        plannedWorkout: row.plannedWorkout, plannedDist: row.plannedDist,
        actualDist: null, durationMin: null, avgHR: null, rpe: null, soreness: null, notes: null };
    }
    Object.assign(trainingLog[row.date], {
      actualDist: row.actualDist, durationMin: row.durationMin, avgHR: row.avgHR,
      rpe: row.rpe, soreness: row.soreness, notes: row.notes
    });
  }

  const whoopRecovery = {};
  for (const row of SEED_DATA.whoopRecovery) {
    whoopRecovery[row.date] = { ...row };
  }

  const hooperIndex = {};
  for (const row of SEED_DATA.hooperIndex) {
    hooperIndex[row.date] = { ...row };
  }

  const fresh = { trainingLog, whoopRecovery, hooperIndex, meta: { seededAt: new Date().toISOString() } };
  localStorage.setItem(STORE_KEY, JSON.stringify(fresh));
  return fresh;
}

let store = loadStore();
let settings = loadSettings();

/* ---------------------------------------------------------------------- *
 * Date / plan lookup helpers
 * ---------------------------------------------------------------------- */

function todayISO() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayNameForDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function weekInfoForDate(dateStr) {
  for (const w of WEEKLY_PLANNED) {
    if (dateStr >= w.start && dateStr <= w.end) return w;
  }
  return null;
}

function daysUntilRace() {
  const race = new Date(RACE_DATE + 'T00:00:00');
  const now = new Date(todayISO() + 'T00:00:00');
  return Math.round((race - now) / 86400000);
}

/* ---------------------------------------------------------------------- *
 * CRUD
 * ---------------------------------------------------------------------- */

function upsertTrainingLog(date, fields) {
  const wi = weekInfoForDate(date) || {};
  const existing = store.trainingLog[date] || {
    date, week: wi.week ?? null, day: dayNameForDate(date), phase: wi.phase ?? null,
    plannedWorkout: null, plannedDist: null,
    actualDist: null, durationMin: null, avgHR: null, rpe: null, soreness: null, notes: null
  };
  store.trainingLog[date] = { ...existing, ...fields };
  saveStore();
}

function upsertWhoop(date, fields) {
  const existing = store.whoopRecovery[date] || { date, day: dayNameForDate(date),
    recovery: null, restingHR: null, hrv: null, respRate: null, sleepPerf: null, notes: null };
  store.whoopRecovery[date] = { ...existing, ...fields };
  saveStore();
}

function upsertHooper(date, fields) {
  const existing = store.hooperIndex[date] || { date, fatigue: null, stress: null, soreness: null, sleepQuality: null, notes: null };
  store.hooperIndex[date] = { ...existing, ...fields };
  saveStore();
}

/* ---------------------------------------------------------------------- *
 * Derived calculations (mirrors the original Google Sheet formulas)
 * ---------------------------------------------------------------------- */

function hooperTotal(e) {
  if (e.fatigue == null || e.stress == null || e.soreness == null || e.sleepQuality == null) return null;
  return Number(e.fatigue) + Number(e.stress) + Number(e.soreness) + Number(e.sleepQuality);
}

function hooperWellness(total) {
  return total == null ? null : (28 - total) / 24 * 100;
}

function computeHooperDerived() {
  const rows = Object.values(store.hooperIndex).sort((a, b) => a.date.localeCompare(b.date));
  const totals = rows.map(hooperTotal);
  return rows.map((e, i) => {
    const total = totals[i];
    const windowVals = totals.slice(Math.max(0, i - 6), i).filter(v => v != null);
    const avg7 = windowVals.length ? windowVals.reduce((a, b) => a + b, 0) / windowVals.length : null;
    let flag = '';
    if (total != null && avg7 != null && total > avg7 + 3) flag = '⚠ Elevated vs recent baseline';
    return { ...e, total, wellness: hooperWellness(total), avg7, flag };
  });
}

function computeWeeklySummary() {
  const tlArr = Object.values(store.trainingLog);
  const whoopArr = Object.values(store.whoopRecovery);
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  let prevLR = null;
  return WEEKLY_PLANNED.map(w => {
    const inWeek = tlArr.filter(e => e.week === w.week);
    const actualMi = inWeek.reduce((s, e) => s + (Number(e.actualDist) || 0), 0);
    // "Actual Long Run" = the single longest run actually logged that week,
    // regardless of which day it fell on (so swapping the long run to a
    // different day, e.g. around travel, still tracks correctly).
    const actualLR = inWeek.reduce((max, e) => Math.max(max, Number(e.actualDist) || 0), 0);
    const whoopInRange = whoopArr.filter(e => e.date >= w.start && e.date <= w.end);
    const avgRecovery = avg(whoopInRange.map(e => e.recovery).filter(v => v != null));
    const avgHRV = avg(whoopInRange.map(e => e.hrv).filter(v => v != null));
    const avgRHR = avg(whoopInRange.map(e => e.restingHR).filter(v => v != null));

    let lrPctChange = null;
    if (prevLR != null && prevLR > 0 && actualLR > 0) lrPctChange = (actualLR - prevLR) / prevLR;

    let flag = '';
    if (actualLR > 0 && w.plannedLR > 0 && (actualLR - w.plannedLR) / w.plannedLR > 0.15) {
      flag = `⚠ LR beat plan by ${Math.round((actualLR - w.plannedLR) / w.plannedLR * 100)}%`;
    } else if (lrPctChange != null && lrPctChange > 0.15) {
      flag = '⚠ Spike >15% vs prior wk';
    } else if (avgRecovery != null && avgRecovery < 50) {
      flag = '⚠ Low recovery avg';
    }
    prevLR = actualLR;

    return { ...w, actualMi, actualLR, lrPctChange, avgRecovery, avgHRV, avgRHR, flag,
      hasActual: inWeek.some(e => e.actualDist != null) };
  });
}

/* ---------------------------------------------------------------------- *
 * App shell / navigation
 * ---------------------------------------------------------------------- */

const TABS = ['today', 'log', 'recovery', 'weekly', 'plan'];
const TAB_LABELS = { today: 'Today', log: 'Log', recovery: 'Recovery', weekly: 'Weekly', plan: 'Plan' };
const TAB_ICONS = {
  today: '☀️', log: '🏃', recovery: '💤', weekly: '📊', plan: '🗓️'
};

let state = { tab: 'today', settingsOpen: false };

function setTab(tab) {
  state.tab = tab;
  state.settingsOpen = false;
  render();
}

function openSettings() {
  state.settingsOpen = true;
  render();
}

function closeSettings() {
  state.settingsOpen = false;
  render();
}

function render() {
  const app = document.getElementById('app');
  const wi = weekInfoForDate(todayISO());
  const headerSub = wi ? `Week ${wi.week} · ${wi.phase} · ${daysUntilRace()}d to race` : `${daysUntilRace()}d to race`;

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-title">Marathon Tracker</div>
        <div class="brand-sub">${headerSub}</div>
      </div>
      <button class="icon-btn" id="settingsBtn" aria-label="Settings">⚙️</button>
    </header>
    <main id="view" class="view"></main>
    <nav class="bottomnav">
      ${TABS.map(t => `
        <button class="navbtn ${state.tab === t ? 'active' : ''}" data-tab="${t}">
          <span class="navicon">${TAB_ICONS[t]}</span>
          <span class="navlabel">${TAB_LABELS[t]}</span>
        </button>`).join('')}
    </nav>
    <div id="modalRoot"></div>
  `;

  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  app.querySelectorAll('.navbtn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  const view = document.getElementById('view');
  if (state.settingsOpen) {
    view.innerHTML = renderSettings();
    wireSettings();
    return;
  }

  switch (state.tab) {
    case 'today': view.innerHTML = renderToday(); wireToday(); break;
    case 'log': view.innerHTML = renderLog(); wireLog(); break;
    case 'recovery': view.innerHTML = renderRecovery(); wireRecovery(); break;
    case 'weekly': view.innerHTML = renderWeekly(); break;
    case 'plan': view.innerHTML = renderPlan(); wirePlan(); break;
  }
}

/* ---------------------------------------------------------------------- *
 * Today tab
 * ---------------------------------------------------------------------- */

function renderToday() {
  const today = todayISO();
  const dayName = dayNameForDate(today);
  const wi = weekInfoForDate(today);
  const run = store.trainingLog[today];
  const whoop = store.whoopRecovery[today];
  const hooper = store.hooperIndex[today];
  const yestWhoop = store.whoopRecovery[shiftDate(today, -1)];

  let liftBlock = '';
  if (wi) {
    const phaseKey = liftingPhaseForWeek(wi.week);
    if (phaseKey) {
      const prog = LIFTING_PROGRAM[phaseKey];
      if (dayName === 'Monday') liftBlock = renderLiftCard(prog.monday);
      else if (dayName === 'Thursday') liftBlock = renderLiftCard(prog.thursday);
      else if (dayName === 'Tuesday' && tuesdayLiftApplies(wi.week)) liftBlock = renderLiftCard(prog.tuesday, true);
    }
  }

  const runCard = run
    ? `
      <div class="card">
        <div class="card-title">Today's Run · ${run.plannedWorkout || 'Unscheduled'}</div>
        ${run.plannedDist != null ? `<div class="card-sub">Planned: ${run.plannedDist} mi</div>` : ''}
        ${run.actualDist != null ? `
          <div class="logged-summary">
            <span class="pill pill-good">Logged: ${run.actualDist} mi</span>
            ${run.durationMin != null ? `<span class="pill">${minToClock(run.durationMin)}</span>` : ''}
            ${run.avgHR != null ? `<span class="pill">${run.avgHR} bpm</span>` : ''}
          </div>` : `<div class="not-logged">Not logged yet</div>`}
        <button class="btn btn-primary" data-open-run="${today}">${run.actualDist != null ? 'Edit Entry' : 'Log This Run'}</button>
      </div>`
    : (dayName === 'Sunday'
        ? `<div class="card"><div class="card-title">Rest Day</div><div class="card-sub">Rest / mobility / optional light hockey.</div></div>`
        : `<div class="card"><div class="card-title">No run scheduled today</div><button class="btn btn-secondary" data-open-run="${today}">Log an extra workout</button></div>`);

  const recoveryCard = `
    <div class="card">
      <div class="card-title">Recovery & Wellness</div>
      ${whoop ? `
        <div class="logged-summary">
          <span class="pill pill-good">Recovery ${whoop.recovery}%</span>
          ${whoop.hrv != null ? `<span class="pill">HRV ${whoop.hrv}ms</span>` : ''}
          ${whoop.restingHR != null ? `<span class="pill">RHR ${whoop.restingHR}bpm</span>` : ''}
        </div>` : `<div class="not-logged">Not logged yet</div>`}
      ${yestWhoop ? `<div class="card-sub">Yesterday: ${yestWhoop.recovery}% recovery</div>` : ''}
      <button class="btn btn-primary" data-open-recovery="${today}">${whoop || hooper ? 'Edit Entry' : 'Log Today'}</button>
    </div>`;

  return `
    <div class="tabhead">Today · ${fmtDate(today)}</div>
    ${runCard}
    ${liftBlock}
    ${recoveryCard}
  `;
}

function renderLiftCard(session, optional) {
  if (!session) return '';
  return `
    <div class="card card-lift">
      <div class="card-title">${optional ? 'Optional: ' : ''}${session.title}</div>
      <ul class="exlist">
        ${session.exercises.map(x => `<li>${x}</li>`).join('')}
      </ul>
      ${session.note ? `<div class="card-note">${session.note}</div>` : ''}
    </div>`;
}

function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function minToClock(min) {
  if (min == null) return '';
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function wireToday() {
  document.querySelectorAll('[data-open-run]').forEach(btn =>
    btn.addEventListener('click', () => openRunForm(btn.dataset.openRun)));
  document.querySelectorAll('[data-open-recovery]').forEach(btn =>
    btn.addEventListener('click', () => openRecoveryForm(btn.dataset.openRecovery)));
}

/* ---------------------------------------------------------------------- *
 * Log tab (training log)
 * ---------------------------------------------------------------------- */

function renderLog() {
  const rows = Object.values(store.trainingLog).sort((a, b) => b.date.localeCompare(a.date));
  const byWeek = {};
  for (const r of rows) {
    (byWeek[r.week] = byWeek[r.week] || []).push(r);
  }
  const weekKeys = Object.keys(byWeek).sort((a, b) => b - a);

  return `
    <div class="tabhead">Training Log <button class="fab" id="addRunBtn">+</button></div>
    ${weekKeys.map(wk => `
      <div class="weekgroup">
        <div class="weekgroup-title">Week ${wk} — ${byWeek[wk][0].phase || ''}</div>
        ${byWeek[wk].map(r => `
          <div class="logrow" data-open-run="${r.date}">
            <div class="logrow-date">${fmtDate(r.date)}</div>
            <div class="logrow-main">
              <div class="logrow-workout">${r.plannedWorkout || 'Unscheduled'}</div>
              ${r.actualDist != null
                ? `<div class="logrow-actual">${r.actualDist} mi${r.durationMin != null ? ' · ' + minToClock(r.durationMin) : ''}</div>`
                : `<div class="logrow-notlogged">Not logged</div>`}
            </div>
            <div class="logrow-chevron">›</div>
          </div>`).join('')}
      </div>`).join('')}
  `;
}

function wireLog() {
  document.querySelectorAll('[data-open-run]').forEach(el =>
    el.addEventListener('click', () => openRunForm(el.dataset.openRun)));
  const addBtn = document.getElementById('addRunBtn');
  if (addBtn) addBtn.addEventListener('click', () => openRunForm(todayISO(), true));
}

/* ---------------------------------------------------------------------- *
 * Recovery tab (whoop + hooper)
 * ---------------------------------------------------------------------- */

function renderRecovery() {
  const dates = new Set([...Object.keys(store.whoopRecovery), ...Object.keys(store.hooperIndex)]);
  const sorted = [...dates].sort((a, b) => b.localeCompare(a));
  const hooperDerived = Object.fromEntries(computeHooperDerived().map(h => [h.date, h]));

  return `
    <div class="tabhead">Recovery <button class="fab" id="addRecoveryBtn">+</button></div>
    ${sorted.map(date => {
      const w = store.whoopRecovery[date];
      const h = hooperDerived[date];
      return `
        <div class="logrow" data-open-recovery="${date}">
          <div class="logrow-date">${fmtDate(date)}</div>
          <div class="logrow-main">
            <div class="logrow-workout">
              ${w ? `Recovery ${w.recovery}%` : 'No Whoop data'}
              ${h && h.wellness != null ? ` · Wellness ${Math.round(h.wellness)}%` : ''}
            </div>
            ${h && h.flag ? `<div class="logrow-flag">${h.flag}</div>` : ''}
          </div>
          <div class="logrow-chevron">›</div>
        </div>`;
    }).join('') || '<div class="empty">No entries yet.</div>'}
  `;
}

function wireRecovery() {
  document.querySelectorAll('[data-open-recovery]').forEach(el =>
    el.addEventListener('click', () => openRecoveryForm(el.dataset.openRecovery)));
  const addBtn = document.getElementById('addRecoveryBtn');
  if (addBtn) addBtn.addEventListener('click', () => openRecoveryForm(todayISO(), true));
}

/* ---------------------------------------------------------------------- *
 * Weekly summary tab
 * ---------------------------------------------------------------------- */

function renderWeekly() {
  const summary = computeWeeklySummary();
  const today = todayISO();
  return `
    <div class="tabhead">Weekly Summary</div>
    ${summary.map(w => {
      const isCurrent = today >= w.start && today <= w.end;
      const pctMi = w.plannedMi ? Math.round(w.actualMi / w.plannedMi * 100) : null;
      return `
        <div class="card weekcard ${isCurrent ? 'weekcard-current' : ''}">
          <div class="card-title">Week ${w.week} · ${w.phase}${isCurrent ? ' <span class="pill pill-now">This week</span>' : ''}</div>
          <div class="card-sub">${fmtDate(w.start)} – ${fmtDate(w.end)}</div>
          <div class="weekstats">
            <div class="stat">
              <div class="stat-label">Mileage</div>
              <div class="stat-value">${w.actualMi.toFixed(1)} <span class="stat-of">/ ${w.plannedMi}</span></div>
              ${pctMi != null ? `<div class="stat-pct">${pctMi}%</div>` : ''}
            </div>
            <div class="stat">
              <div class="stat-label">Long Run</div>
              <div class="stat-value">${w.actualLR.toFixed(1)} <span class="stat-of">/ ${w.plannedLR}</span></div>
              ${w.lrPctChange != null ? `<div class="stat-pct">${w.lrPctChange >= 0 ? '+' : ''}${Math.round(w.lrPctChange * 100)}% vs prior</div>` : ''}
            </div>
            <div class="stat">
              <div class="stat-label">Avg Recovery</div>
              <div class="stat-value">${w.avgRecovery != null ? Math.round(w.avgRecovery) + '%' : '—'}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Avg HRV / RHR</div>
              <div class="stat-value">${w.avgHRV != null ? Math.round(w.avgHRV) : '—'} / ${w.avgRHR != null ? Math.round(w.avgRHR) : '—'}</div>
            </div>
          </div>
          ${w.flag ? `<div class="flagbanner">${w.flag}</div>` : ''}
        </div>`;
    }).join('')}
  `;
}

/* ---------------------------------------------------------------------- *
 * Plan tab (reference)
 * ---------------------------------------------------------------------- */

function renderPlan() {
  return `
    <div class="tabhead">Plan Reference</div>
    <div class="card">
      <div class="card-title">Goal</div>
      <div class="card-sub">${PROGRAM_META.goal}</div>
      <div class="card-note">${PROGRAM_META.peakLongRun}</div>
    </div>
    <div class="card">
      <div class="card-title">Race Day Pacing</div>
      <div class="card-sub">${PROGRAM_META.raceDayPacing}</div>
    </div>
    <div class="card">
      <div class="card-title">Wednesday Variety Rotation</div>
      ${WEDNESDAY_VARIETY.map(v => `<div class="listitem"><b>${v.name}</b> — ${v.detail}</div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Autoregulation Rules</div>
      ${AUTOREGULATION_RULES.map(r => `<div class="listitem"><b>${r.trigger}</b> → ${r.action}</div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Milestones</div>
      ${MILESTONES.map(m => `<div class="listitem"><b>${m.label}:</b> ${m.target}</div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">Full 19-Week Schedule</div>
      <div class="accordion" id="weekAccordion">
        ${WEEKLY_PLANNED.map(w => `
          <details ${w.week === (weekInfoForDate(todayISO())||{}).week ? 'open' : ''}>
            <summary>Week ${w.week} · ${w.phase} · ${w.plannedMi} mi (LR ${w.plannedLR})</summary>
            ${PLANNED_SCHEDULE.filter(r => r.week === w.week).map(r => `
              <div class="planrow">${dayNameForDate(r.date)} (${fmtDate(r.date)}) — ${r.plannedWorkout}</div>`).join('')}
          </details>`).join('')}
      </div>
    </div>
  `;
}

function wirePlan() {}

/* ---------------------------------------------------------------------- *
 * Forms (modals)
 * ---------------------------------------------------------------------- */

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function parseDuration(text) {
  if (text == null || text === '') return null;
  const t = String(text).trim();
  if (t.includes(':')) {
    const parts = t.split(':').map(Number);
    if (parts.length === 2) return parts[0] + parts[1] / 60;
    if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function openRunForm(date, isNew) {
  const wi = weekInfoForDate(date) || {};
  const existing = store.trainingLog[date] || {
    date, week: wi.week ?? null, day: dayNameForDate(date), phase: wi.phase ?? null,
    plannedWorkout: null, plannedDist: null, actualDist: null, durationMin: null, avgHR: null, rpe: null, soreness: null, notes: null
  };
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="modal-overlay" id="overlay">
      <div class="modal">
        <div class="modal-header">
          <div>${fmtDate(date)}${existing.plannedWorkout ? ' · ' + existing.plannedWorkout : ''}</div>
          <button class="icon-btn" id="closeBtn">✕</button>
        </div>
        <div class="modal-body">
          <label>Date <input type="date" id="f_date" value="${date}"></label>
          <label>Actual Distance (mi) <input type="number" step="0.01" id="f_dist" value="${existing.actualDist ?? ''}" placeholder="${existing.plannedDist ?? ''}"></label>
          <label>Duration (mm:ss or minutes) <input type="text" id="f_dur" value="${existing.durationMin != null ? minToClock(existing.durationMin) : ''}" placeholder="e.g. 42:30"></label>
          <label>Avg HR (bpm) <input type="number" id="f_hr" value="${existing.avgHR ?? ''}"></label>
          <label>RPE (1-10) <input type="range" min="1" max="10" id="f_rpe" value="${existing.rpe ?? 5}">
            <span class="range-val" id="f_rpe_val">${existing.rpe ?? 5}</span></label>
          <label>Soreness (1-10) <input type="range" min="1" max="10" id="f_sore" value="${existing.soreness ?? 3}">
            <span class="range-val" id="f_sore_val">${existing.soreness ?? 3}</span></label>
          <label>Notes <textarea id="f_notes" rows="3">${existing.notes ?? ''}</textarea></label>
        </div>
        <div class="modal-footer">
          ${existing.actualDist != null ? '<button class="btn btn-danger" id="deleteBtn">Delete</button>' : '<span></span>'}
          <button class="btn btn-primary" id="saveBtn">Save</button>
        </div>
      </div>
    </div>`;

  document.getElementById('overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
  document.getElementById('closeBtn').addEventListener('click', closeModal);
  document.getElementById('f_rpe').addEventListener('input', e => document.getElementById('f_rpe_val').textContent = e.target.value);
  document.getElementById('f_sore').addEventListener('input', e => document.getElementById('f_sore_val').textContent = e.target.value);

  const del = document.getElementById('deleteBtn');
  if (del) del.addEventListener('click', () => {
    if (!confirm('Delete this logged entry? Planned workout info stays.')) return;
    upsertTrainingLog(date, { actualDist: null, durationMin: null, avgHR: null, rpe: null, soreness: null, notes: null });
    closeModal(); render();
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const newDate = document.getElementById('f_date').value || date;
    const fields = {
      actualDist: numOrNull(document.getElementById('f_dist').value),
      durationMin: parseDuration(document.getElementById('f_dur').value),
      avgHR: numOrNull(document.getElementById('f_hr').value),
      rpe: numOrNull(document.getElementById('f_rpe').value),
      soreness: numOrNull(document.getElementById('f_sore').value),
      notes: document.getElementById('f_notes').value || null
    };
    upsertTrainingLog(newDate, fields);
    closeModal(); render();
  });
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function openRecoveryForm(date) {
  const w = store.whoopRecovery[date] || {};
  const h = store.hooperIndex[date] || {};
  const modal = document.getElementById('modalRoot');
  modal.innerHTML = `
    <div class="modal-overlay" id="overlay">
      <div class="modal">
        <div class="modal-header">
          <div>${fmtDate(date)} · Recovery & Wellness</div>
          <button class="icon-btn" id="closeBtn">✕</button>
        </div>
        <div class="modal-body">
          <label>Date <input type="date" id="f_date" value="${date}"></label>
          <div class="modal-section">Whoop</div>
          <label>Recovery (%) <input type="number" id="f_rec" value="${w.recovery ?? ''}"></label>
          <label>Resting HR (bpm) <input type="number" id="f_rhr" value="${w.restingHR ?? ''}"></label>
          <label>HRV (ms) <input type="number" id="f_hrv" value="${w.hrv ?? ''}"></label>
          <label>Respiratory Rate (rpm) <input type="number" step="0.1" id="f_resp" value="${w.respRate ?? ''}"></label>
          <label>Sleep Performance (%) <input type="number" id="f_sleepperf" value="${w.sleepPerf ?? ''}"></label>
          <label>Whoop Notes <textarea id="f_wnotes" rows="2">${w.notes ?? ''}</textarea></label>
          <div class="modal-section">Hooper Index (1 = very low/good, 7 = very high/poor)</div>
          <label>Fatigue (1-7) <input type="range" min="1" max="7" id="f_fatigue" value="${h.fatigue ?? 3}">
            <span class="range-val" id="f_fatigue_val">${h.fatigue ?? 3}</span></label>
          <label>Stress (1-7) <input type="range" min="1" max="7" id="f_stress" value="${h.stress ?? 3}">
            <span class="range-val" id="f_stress_val">${h.stress ?? 3}</span></label>
          <label>Muscle Soreness (1-7) <input type="range" min="1" max="7" id="f_hsore" value="${h.soreness ?? 3}">
            <span class="range-val" id="f_hsore_val">${h.soreness ?? 3}</span></label>
          <label>Sleep Quality (1-7, 1=very good) <input type="range" min="1" max="7" id="f_sleepq" value="${h.sleepQuality ?? 3}">
            <span class="range-val" id="f_sleepq_val">${h.sleepQuality ?? 3}</span></label>
          <label>Hooper Notes <textarea id="f_hnotes" rows="2">${h.notes ?? ''}</textarea></label>
        </div>
        <div class="modal-footer">
          <span></span>
          <button class="btn btn-primary" id="saveBtn">Save</button>
        </div>
      </div>
    </div>`;

  document.getElementById('overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
  document.getElementById('closeBtn').addEventListener('click', closeModal);
  ['fatigue', 'stress', 'hsore', 'sleepq'].forEach(id => {
    document.getElementById('f_' + id).addEventListener('input', e =>
      document.getElementById('f_' + id + '_val').textContent = e.target.value);
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const newDate = document.getElementById('f_date').value || date;
    upsertWhoop(newDate, {
      recovery: numOrNull(document.getElementById('f_rec').value),
      restingHR: numOrNull(document.getElementById('f_rhr').value),
      hrv: numOrNull(document.getElementById('f_hrv').value),
      respRate: numOrNull(document.getElementById('f_resp').value),
      sleepPerf: numOrNull(document.getElementById('f_sleepperf').value),
      notes: document.getElementById('f_wnotes').value || null
    });
    upsertHooper(newDate, {
      fatigue: numOrNull(document.getElementById('f_fatigue').value),
      stress: numOrNull(document.getElementById('f_stress').value),
      soreness: numOrNull(document.getElementById('f_hsore').value),
      sleepQuality: numOrNull(document.getElementById('f_sleepq').value),
      notes: document.getElementById('f_hnotes').value || null
    });
    closeModal(); render();
  });
}

/* ---------------------------------------------------------------------- *
 * Settings (export/import, Google Sheets sync, reset)
 * ---------------------------------------------------------------------- */

function renderSettings() {
  const configured = !!(settings.appsScriptUrl && settings.syncToken);
  return `
    <div class="tabhead">Settings <button class="icon-btn" id="backBtn">‹ Back</button></div>

    <div class="card">
      <div class="card-title">Backup</div>
      <div class="card-sub">Export your data as a JSON file (e.g. to save into your Google Drive Marathon folder), or import a previous backup.</div>
      <button class="btn btn-secondary" id="exportBtn">Export Backup (JSON)</button>
      <label class="btn btn-secondary filebtn">Import Backup
        <input type="file" id="importFile" accept="application/json" style="display:none">
      </label>
    </div>

    <div class="card">
      <div class="card-title">Google Sheets Sync</div>
      <div class="card-sub">${configured ? 'Push writes local data into your sheet; Pull loads your sheet into this app.' : 'Not configured yet. Requires deploying the Code.gs Apps Script as a Web App in your sheet (see README) — copy the resulting URL and your chosen token below.'}</div>
      <label>Apps Script Web App URL <input type="text" id="f_scriptUrl" value="${settings.appsScriptUrl || ''}" placeholder="https://script.google.com/macros/s/.../exec"></label>
      <label>Sync Token <input type="text" id="f_syncToken" value="${settings.syncToken || ''}" placeholder="must match SYNC_TOKEN in Code.gs"></label>
      <button class="btn btn-secondary" id="saveSyncConfigBtn">Save Config</button>
      <div class="sync-actions">
        <button class="btn btn-secondary" id="testBtn">Test Connection</button>
        <button class="btn btn-primary" id="pushBtn">Push to Sheet</button>
        <button class="btn btn-secondary" id="pullBtn">Pull from Sheet</button>
      </div>
      <div class="card-note" id="syncStatus">${settings.lastPush ? 'Last push: ' + new Date(settings.lastPush).toLocaleString() : ''} ${settings.lastPull ? '· Last pull: ' + new Date(settings.lastPull).toLocaleString() : ''}</div>
    </div>

    <div class="card">
      <div class="card-title">Reset</div>
      <div class="card-sub">Clears all locally stored data and reseeds from your original historical export.</div>
      <button class="btn btn-danger" id="resetBtn">Reset to Seed Data</button>
    </div>

    <div class="card">
      <div class="card-title">About</div>
      <div class="card-note">Charlotte Marathon Tracker · Race day ${fmtDate(RACE_DATE)} · Goal pace ${GOAL_PACE}</div>
    </div>
  `;
}

function wireSettings() {
  document.getElementById('backBtn').addEventListener('click', closeSettings);

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marathon-tracker-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.trainingLog || !parsed.whoopRecovery || !parsed.hooperIndex) throw new Error('bad shape');
        if (!confirm('Import will replace all current data with this backup. Continue?')) return;
        store = parsed;
        saveStore();
        render();
      } catch (err) {
        alert('Could not read that file as a valid backup.');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('saveSyncConfigBtn').addEventListener('click', () => {
    settings.appsScriptUrl = document.getElementById('f_scriptUrl').value.trim();
    settings.syncToken = document.getElementById('f_syncToken').value.trim();
    saveSettings();
    render();
  });

  document.getElementById('testBtn').addEventListener('click', async () => {
    if (typeof googlePing !== 'function') { alert('Sync module not loaded.'); return; }
    const status = document.getElementById('syncStatus');
    status.textContent = 'Testing…';
    try {
      const ok = await googlePing(settings.appsScriptUrl, settings.syncToken);
      status.textContent = ok ? 'Connection OK.' : 'Reached endpoint but got an unexpected response.';
    } catch (err) { status.textContent = 'Test failed: ' + err.message; }
  });

  document.getElementById('pushBtn').addEventListener('click', async () => {
    if (typeof googlePush !== 'function') { alert('Sync module not loaded.'); return; }
    try {
      document.getElementById('syncStatus').textContent = 'Pushing…';
      const result = await googlePush(settings.appsScriptUrl, settings.syncToken, store);
      settings.lastPush = new Date().toISOString();
      saveSettings(); render();
      alert(`Pushed. Rows updated: ${result.updatedRows}`);
    } catch (err) { alert('Push failed: ' + err.message); }
  });

  document.getElementById('pullBtn').addEventListener('click', async () => {
    if (typeof googlePull !== 'function') { alert('Sync module not loaded.'); return; }
    if (!confirm('Pull will overwrite local data with what is in the Google Sheet. Continue?')) return;
    try {
      document.getElementById('syncStatus').textContent = 'Pulling…';
      const pulled = await googlePull(settings.appsScriptUrl, settings.syncToken);
      store = pulled;
      saveStore();
      settings.lastPull = new Date().toISOString();
      saveSettings(); render();
    } catch (err) { alert('Pull failed: ' + err.message); }
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('This wipes all data you have logged since seeding and restores the original historical export. Are you sure?')) return;
    localStorage.removeItem(STORE_KEY);
    store = seedStore();
    render();
  });
}

/* ---------------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
