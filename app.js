(function () {
'use strict';

/* ================= helpers ================= */
const KEY = 'gateTracker.v2', META = 'gateTracker.meta', TOKEN_KEY = 'gt_auth';
const LOCAL_AUTH = 'YXJjaGVyOnBhc3N3b3Jk'; // base64("archer:password"): only used when the sync API is unreachable
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dkey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseD = k => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const today = () => dkey(new Date());
const addDays = (k, n) => { const d = parseD(k); d.setDate(d.getDate() + n); return dkey(d); };
const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const num = v => Math.max(0, Math.round(+v || 0));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hm = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (h + 'h' + (r ? ' ' + r + 'm' : '')) : (m + 'm'); };
const fmtPct = p => { const v = p * 100; return (v > 0 && v < 10 ? v.toFixed(1) : Math.round(v)) + '%'; };
const fmtDate = (k, long) => parseD(k).toLocaleDateString('en-IN', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' });
const subColor = s => 'hsl(' + s.hue + ' 62% 56%)';
const SUB = {}; SUBJECTS.forEach(s => SUB[s.id] = s);
const EPS = 1e-6;
/* Book numbers can be edited on the Subjects tab. BASE keeps the PDF defaults; S.edits holds your changes. */
const BASE = SUBJECTS.map(s => ({ pages: s.pages, questions: s.questions, topics: s.topics.map(t => ({ n: t.n, q: t.q, s: t.s })) }));
function applyEdits() {
  SUBJECTS.forEach((sub, i) => {
    const b = BASE[i], e = (S.edits && S.edits[sub.id]) || null;
    sub.pages = e && e.pages > 0 ? e.pages : b.pages;
    sub.topics = (e && Array.isArray(e.topics) && e.topics.length ? e.topics : b.topics).map(t => ({ n: t.n, q: t.q, s: t.s }));
    sub.questions = sub.topics.length ? sub.topics.reduce((x, t) => x + t.q, 0) : (e && e.questions > 0 ? e.questions : b.questions);
  });
}

function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================= state ================= */
const defaults = () => ({
  v: 2, logs: [], topicDone: {}, pageStart: {}, plans: {}, edits: {}, todos: {}, deleted: [], updatedAt: 0,
  settings: { examDate: '2027-02-06', dailyMin: 360, dailyGA: 5, blocks: 3, revisionDays: 21, theme: 'dark' }
});
function normalize(r) {
  const o = Object.assign(defaults(), r && typeof r === 'object' ? r : {});
  o.settings = Object.assign(defaults().settings, (r && r.settings) || {});
  ['logs', 'deleted'].forEach(k => { if (!Array.isArray(o[k])) o[k] = []; });
  ['topicDone', 'pageStart', 'plans', 'edits', 'todos'].forEach(k => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; });
  o.logs = o.logs.filter(l => l && l.id && SUB[l.sid] && (l.mode === 'p' || l.mode === 'q'));
  return o;
}
function readLocal() { try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return normalize(null); } }
let S = readLocal();
applyEdits();

/* ================= sync (optional cloud copy via /api/data) ================= */
const sync = { mode: 'local', tok: null, rev: 0, dirty: false, inflight: false, ver: 0, timer: null };
try { const m = JSON.parse(localStorage.getItem(META)); if (m) { sync.rev = m.rev || 0; sync.dirty = !!m.dirty; } } catch (e) { /* ignore */ }
function persistMeta() { try { localStorage.setItem(META, JSON.stringify({ rev: sync.rev, dirty: sync.dirty })); } catch (e) { /* ignore */ } }
function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch (e) { toast('Could not save on this device: browser storage is blocked or full'); return false; } }
function setStatus(text, cls) { const b = $('#sync'); if (!b) return; b.textContent = text; b.className = 'chip' + (cls ? ' ' + cls : ''); sync.text = text; }

async function apiCall(method, tok, body) {
  try {
    const json = body ? JSON.stringify(body) : undefined;
    const res = await fetch('/api/data', {
      method, cache: 'no-store', body: json,
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      keepalive: !!json && json.length < 60000
    });
    if (res.status === 401) return { status: 'unauth' };
    if (res.status === 503) return { status: 'nostore' };
    const ct = res.headers.get('content-type') || '';
    if (ct.indexOf('json') < 0) return { status: 'offline' };
    if (res.status === 409) return { status: 'conflict', data: await res.json() };
    if (!res.ok) return { status: 'offline' };
    return { status: 'ok', data: await res.json() };
  } catch (e) { return { status: 'offline' }; }
}

function mergeStates(local, server) {
  const del = new Set([].concat(local.deleted || [], server.deleted || []));
  const map = new Map();
  [].concat(server.logs || [], local.logs || []).forEach(l => { if (l && l.id && !del.has(l.id)) map.set(l.id, l); });
  const out = Object.assign({}, server, local);
  out.logs = Array.from(map.values());
  out.deleted = Array.from(del).slice(-2000);
  out.plans = Object.assign({}, server.plans || {}, local.plans || {});
  out.todos = Object.assign({}, server.todos || {}, local.todos || {});
  out.edits = Object.assign({}, server.edits || {}, local.edits || {});
  out.topicDone = {};
  [server.topicDone || {}, local.topicDone || {}].forEach(src => Object.keys(src).forEach(sid => { out.topicDone[sid] = Object.assign(out.topicDone[sid] || {}, src[sid]); }));
  out.pageStart = {};
  [server.pageStart || {}, local.pageStart || {}].forEach(src => Object.keys(src).forEach(sid => { out.pageStart[sid] = Object.assign(out.pageStart[sid] || {}, src[sid]); }));
  out.updatedAt = Math.max(local.updatedAt || 0, server.updatedAt || 0);
  return normalize(out);
}

function save() {
  S.updatedAt = Date.now();
  writeLocal();
  sync.dirty = true; sync.ver++; persistMeta();
  if (sync.mode === 'cloud') { setStatus('Saving...', 'warn'); clearTimeout(sync.timer); sync.timer = setTimeout(push, 700); }
  else setStatus(sync.text && /not set up|Offline/.test(sync.text) ? sync.text : 'This device only', 'warn');
}
async function push() {
  if (sync.mode !== 'cloud' || !sync.tok) return;
  if (sync.inflight) { clearTimeout(sync.timer); sync.timer = setTimeout(push, 500); return; }
  sync.inflight = true; const v = sync.ver;
  const r = await apiCall('PUT', sync.tok, { baseRev: sync.rev, state: S });
  sync.inflight = false;
  if (r.status === 'ok') {
    sync.rev = r.data.rev;
    if (sync.ver === v) { sync.dirty = false; setStatus('Synced', 'ok'); } else { clearTimeout(sync.timer); sync.timer = setTimeout(push, 300); }
    persistMeta();
  } else if (r.status === 'conflict') {
    S = mergeStates(S, normalize(r.data.state)); sync.rev = r.data.rev; sync.ver++;
    writeLocal(); persistMeta(); render();
    clearTimeout(sync.timer); sync.timer = setTimeout(push, 100);
  } else if (r.status === 'unauth') { doLogout(); }
  else { sync.mode = 'local'; setStatus('Offline - saved on this device', 'warn'); }
}
async function pull() {
  if (!sync.tok) return;
  setStatus('Syncing...', 'warn');
  const r = await apiCall('GET', sync.tok);
  if (r.status === 'ok') {
    sync.mode = 'cloud';
    const srv = r.data;
    if (!srv.state) { sync.rev = srv.rev || 0; sync.dirty = true; await push(); }
    else if (sync.dirty) { S = mergeStates(S, normalize(srv.state)); sync.rev = srv.rev; sync.ver++; writeLocal(); persistMeta(); render(); await push(); }
    else { S = normalize(srv.state); sync.rev = srv.rev; writeLocal(); persistMeta(); setStatus('Synced', 'ok'); applyTheme(); render(); }
  } else if (r.status === 'nostore') { sync.mode = 'local'; setStatus('Cloud not set up - this device only', 'warn'); }
  else if (r.status === 'unauth') { doLogout(); }
  else { sync.mode = 'local'; setStatus('Offline - this device only', 'warn'); }
}

/* ================= page <-> question mapping ================= */
/* Each subject is a list of segments (topics). qs/qe: question axis (0-based, qe exclusive).
   ps/pe: page axis (0-based). Pages for a topic start at an estimate (spread by question count)
   unless you enter the real start page in the Subjects tab. */
const QDATA = typeof QD !== 'undefined' ? QD : {};
const BASE_BY = {}; SUBJECTS.forEach((s, i) => { BASE_BY[s.id] = BASE[i]; });
/* The per-question directory is only trusted while the book still has its PDF numbers (no edits on the Subjects tab). */
function exactFor(sub) {
  const q = QDATA[sub.id], b = BASE_BY[sub.id];
  if (!q || !b || sub.pages !== b.pages || sub.questions !== b.questions || q.p.length !== b.questions) return null;
  if (sub.topics.length !== b.topics.length) return null;
  for (let i = 0; i < b.topics.length; i++) { const t = sub.topics[i]; if (t.n !== b.topics[i].n || t.q !== b.topics[i].q || t.s !== b.topics[i].s) return null; }
  return q;
}
/* Edge (0-based page position) where each question starts. A topic's first question starts where the topic starts;
   other questions start at the top of their own page. Questions sharing a page split that page evenly. */
function exactBounds(sub, segs, q) {
  const Q = sub.questions, P = sub.pages, e = new Array(Q);
  let prev = 0;
  segs.forEach(s => {
    for (let k = s.qs; k < s.qe; k++) {
      let v = k === s.qs ? s.ps : q.p[k] - 1;
      v = clamp(Math.max(prev, v), 0, P - 0.5); e[k] = v; prev = v;
    }
  });
  const B = new Array(Q + 1); B[Q] = P;
  let i = 0;
  while (i < Q) {
    let j = i; while (j + 1 < Q && e[j + 1] === e[i]) j++;
    const y = j + 1 < Q ? e[j + 1] : P, n = j - i + 1;
    const w = Math.min(1, y - e[i]) / n;   // questions that share a page split that page, so each still starts on its own page
    for (let k = 0; k < n; k++) B[i + k] = e[i] + k * w;
    i = j + 1;
  }
  return B;
}
function buildMap(sub) {
  const P = sub.pages, Q = sub.questions, exact = exactFor(sub), ov = exact ? {} : (S.pageStart[sub.id] || {});
  const tops = sub.topics.length ? sub.topics : [{ n: sub.name, q: Q }];
  const segs = []; let qs = 0, prev = 0;
  tops.forEach((t, i) => {
    const est = P * qs / Q;
    let ps = ov[i] != null && ov[i] !== '' ? clamp(+ov[i] - 1, 0, P) : (t.s ? clamp(t.s - 1, 0, P) : est);
    if (exact && !sub.topics.length) ps = clamp((exact.p[0] || 1) - 1, 0, P);
    ps = Math.max(prev, ps); prev = ps;
    segs.push({ i, n: t.n, q: t.q, qs, qe: qs + t.q, ps, pe: P, ov: ov[i] != null && ov[i] !== '' });
    qs += t.q;
  });
  segs.forEach((s, k) => { s.pe = k + 1 < segs.length ? segs[k + 1].ps : P; });
  if (exact) { segs.B = exactBounds(sub, segs, exact); segs.exact = true; }
  return segs;
}
function p2q(m, p) {
  const last = m[m.length - 1], Q = last.qe, P = last.pe;
  if (p >= P - EPS) return Q;
  if (m.B) {
    const B = m.B; if (p <= B[0] + EPS) return 0;
    let lo = 0, hi = Q - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (B[mid] <= p + EPS) lo = mid; else hi = mid - 1; }
    return lo + clamp((p - B[lo]) / (B[lo + 1] - B[lo]), 0, 1);
  }
  if (p <= m[0].ps + EPS) return 0;
  for (let k = m.length - 1; k >= 0; k--) {
    const s = m[k];
    if (s.pe > s.ps && p >= s.ps) return s.qs + Math.min(1, (p - s.ps) / (s.pe - s.ps)) * s.q;
  }
  return 0;
}
function q2p(m, q) {
  if (m.B) {
    const B = m.B, Q = B.length - 1; if (q >= Q - EPS) return B[Q];
    const k = clamp(Math.floor(q + EPS), 0, Q - 1); return B[k] + clamp(q - k, 0, 1) * (B[k + 1] - B[k]);
  }
  for (let k = 0; k < m.length; k++) { const s = m[k]; if (q <= s.qe + EPS) return s.ps + clamp((q - s.qs) / s.q, 0, 1) * (s.pe - s.ps); }
  return m[m.length - 1].pe;
}
/* Exam identifier + page of the k-th question (0-based), or null when the exact directory does not apply. */
function qinfo(sub, k) {
  const q = exactFor(sub); if (!q || k < 0 || k >= q.p.length) return null;
  return { src: q.s[k], page: q.p[k] };
}
function mergeIv(list) {
  const a = list.filter(x => x[1] > x[0] + EPS).sort((x, y) => x[0] - y[0]), out = [];
  a.forEach(x => { const l = out[out.length - 1]; if (l && x[0] <= l[1] + EPS) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); });
  return out;
}
const ivLen = m => m.reduce((a, x) => a + (x[1] - x[0]), 0);
const ivOverlap = (m, a, b) => m.reduce((t, x) => t + Math.max(0, Math.min(x[1], b) - Math.max(x[0], a)), 0);
function firstGap(m, a, b) { let p = a; m.forEach(x => { if (x[0] <= p + EPS && x[1] > p) p = x[1]; }); return Math.min(p, b); }

function logIv(m, sub, l) {
  const P = sub.pages, Q = sub.questions; let qa, qb, pa, pb;
  if (l.mode === 'q') { qa = clamp(l.from - 1, 0, Q); qb = clamp(l.to, 0, Q); pa = q2p(m, qa); pb = q2p(m, qb); }
  else { pa = clamp(l.from - 1, 0, P); pb = clamp(l.to, 0, P); qa = p2q(m, pa); qb = p2q(m, pb); }
  return { qa, qb, pa, pb };
}

/* ================= computation ================= */
function compute() {
  applyEdits();
  const subs = {}, byDay = {};
  SUBJECTS.forEach(sub => { subs[sub.id] = { sub, map: buildMap(sub), qI: [], pI: [], min: 0, last: null }; });
  S.logs.forEach(l => {
    const r = subs[l.sid]; if (!r) return;
    const iv = logIv(r.map, r.sub, l);
    r.qI.push([iv.qa, iv.qb]); r.pI.push([iv.pa, iv.pb]);
    r.min += l.min || 0;
    if (!r.last || l.date > r.last) r.last = l.date;
    const d = byDay[l.date] || (byDay[l.date] = { min: 0, pages: 0, q: 0, subs: {} });
    d.min += l.min || 0; d.pages += iv.pb - iv.pa; d.q += iv.qb - iv.qa;
    d.subs[l.sid] = (d.subs[l.sid] || 0) + (l.min || 0);
  });
  Object.keys(byDay).forEach(k => { byDay[k].pages = Math.round(byDay[k].pages); byDay[k].q = Math.round(byDay[k].q); });

  const T = { pages: 0, pagesDone: 0, q: 0, qDone: 0, topics: 0, topicsDone: 0, min: 0 };
  Object.keys(subs).forEach(id => {
    const r = subs[id], sub = r.sub, tickd = S.topicDone[id] || {};
    r.map.forEach(s => { if (tickd[s.i] && sub.topics.length) { r.qI.push([s.qs, s.qe]); r.pI.push([s.ps, s.pe]); } });
    r.qM = mergeIv(r.qI); r.pM = mergeIv(r.pI);
    r.qDone = Math.min(sub.questions, ivLen(r.qM)); r.pagesDone = Math.min(sub.pages, ivLen(r.pM));
    r.nt = sub.topics.length;
    r.topics = r.nt ? r.map.map(s => {
      const cov = ivOverlap(r.qM, s.qs, s.qe);
      return { i: s.i, n: s.n, q: s.q, qs: s.qs, qe: s.qe, ps: s.ps, pe: s.pe, ov: s.ov, qDone: cov, pDone: ivOverlap(r.pM, s.ps, s.pe),
        complete: cov >= s.q - 0.05, manual: !!tickd[s.i], pct: cov / s.q };
    }) : [];
    r.topicsDone = r.topics.filter(t => t.complete).length;
    r.pctP = r.pagesDone / sub.pages; r.pctQ = r.qDone / sub.questions; r.pct = (r.pctP + r.pctQ) / 2;
    r.remP = sub.pages - r.pagesDone; r.remQ = sub.questions - r.qDone;
    const f = r.qM[0]; r.nextQ = f && f[0] <= EPS ? f[1] : 0;
    r.finished = r.nextQ >= sub.questions - 0.05;
    r.nextQnum = Math.min(sub.questions, Math.floor(r.nextQ + EPS) + 1);
    r.nextPage = Math.min(sub.pages, Math.floor(q2p(r.map, r.nextQ) + EPS) + 1);
    T.pages += sub.pages; T.pagesDone += r.pagesDone; T.q += sub.questions; T.qDone += r.qDone;
    T.topics += r.nt; T.topicsDone += r.topicsDone; T.min += r.min;
  });
  T.pctP = T.pagesDone / T.pages; T.pctQ = T.qDone / T.q; T.pct = (T.pctP + T.pctQ) / 2;
  return { subs, byDay, T };
}
function topicAtQ(r, q) {
  if (!r.nt) return null;
  return r.topics.find(t => q < t.qe - EPS) || r.topics[r.topics.length - 1];
}
function logCounts(l) {
  const sub = SUB[l.sid], iv = logIv(buildMap(sub), sub, l);
  return { q: Math.round(iv.qb - iv.qa), p: Math.round(iv.pb - iv.pa) };
}
function describeLog(l) {
  const sub = SUB[l.sid], m = buildMap(sub), iv = logIv(m, sub, l);
  const qn = (a, b) => 'Q' + (Math.floor(a + EPS) + 1) + (Math.ceil(b - EPS) > Math.floor(a + EPS) + 1 ? '-' + Math.ceil(b - EPS) : '');
  const pn = (a, b) => 'p' + (Math.floor(a + EPS) + 1) + (Math.ceil(b - EPS) > Math.floor(a + EPS) + 1 ? '-' + Math.ceil(b - EPS) : '');
  const ab = m.exact ? '' : 'about ';
  return l.mode === 'q' ? qn(iv.qa, iv.qb) + ' (' + ab + pn(iv.pa, iv.pb) + ')' : pn(iv.pa, iv.pb) + ' (' + ab + qn(iv.qa, iv.qb) + ')';
}

function getStreak(C) {
  let k = today(); if (!C.byDay[k]) k = addDays(k, -1);
  let n = 0; while (C.byDay[k]) { n++; k = addDays(k, -1); }
  const days = Object.keys(C.byDay).sort(); let best = 0, run = 0, prev = null;
  days.forEach(d => { run = (prev && diffDays(prev, d) === 1) ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  return { cur: n, best };
}
function avgPerDay(C, n) {
  const days = Object.keys(C.byDay).sort(), first = days[0];
  if (!first) return { min: 0, pages: 0, q: 0, n: 0 };
  n = Math.max(1, Math.min(n, diffDays(first, today()) + 1));
  let m = 0, p = 0, q = 0;
  for (let i = 0; i < n; i++) { const d = C.byDay[addDays(today(), -i)]; if (d) { m += d.min; p += d.pages; q += d.q; } }
  return { min: m / n, pages: p / n, q: q / n, n };
}
function projection(C) {
  const a = avgPerDay(C, 14), units = (a.pages / C.T.pages + a.q / C.T.q) / 2;
  if (units <= 0) return null;
  const rem = 1 - C.T.pct; if (rem <= 0) return { date: today(), days: 0 };
  const days = Math.ceil(rem / units); return { date: addDays(today(), days), days };
}
function coreRemaining(C) {
  let rp = 0, rq = 0;
  Object.values(C.subs).forEach(r => { if (r.sub.id !== 'ga') { rp += r.remP; rq += r.remQ; } });
  return { rp, rq };
}
function pacing(from, C) {
  const left = Math.max(1, diffDays(from, S.settings.examDate) - S.settings.revisionDays + 1), c = coreRemaining(C);
  return { left, reqP: c.rp / left, reqQ: c.rq / left };
}
function qOnDay(C, date, sid) {
  let q = 0; S.logs.forEach(l => { if (l.date === date && l.sid === sid) q += logCounts(l).q; }); return q;
}

/* ================= plan suggestion (flexible, you can ignore it) ================= */
function suggest(date) {
  const C = compute(), pc = pacing(date, C), st = S.settings, items = [];
  const ga = C.subs.ga;
  let gaMin = 0;
  if (ga && !ga.finished && st.dailyGA > 0) {
    const q = Math.min(st.dailyGA, Math.round(ga.remQ));
    gaMin = Math.max(10, Math.round(q * 4 / 5) * 5);
    items.push({ id: uid(), sid: 'ga', q, pages: Math.max(1, Math.round(q * ga.sub.pages / ga.sub.questions)), min: gaMin, startQ: ga.nextQnum });
  }
  const cand = Object.values(C.subs).filter(r => r.sub.id !== 'ga' && !r.finished);
  if (!cand.length) return items;
  cand.forEach(r => { r.work = r.remP / C.T.pages + r.remQ / C.T.q; });
  const maxWork = Math.max.apply(null, cand.map(r => r.work)) || 1;
  cand.forEach(r => {
    const since = r.last ? clamp(diffDays(r.last, date), 0, 14) : 14;
    r.prio = 0.55 * (r.work / maxWork) + 0.45 * (since / 14) + 0.001;
  });
  cand.sort((a, b) => b.prio - a.prio);
  const picked = cand.slice(0, clamp(st.blocks, 1, cand.length)), sumPrio = picked.reduce((a, r) => a + r.prio, 0);
  const budget = Math.max(30, st.dailyMin - gaMin);
  picked.forEach(r => {
    const minutes = Math.max(30, Math.round(budget * r.prio / sumPrio / 15) * 15);
    const qT = Math.min(Math.round(r.remQ), Math.max(1, Math.ceil(pc.reqQ * minutes / budget)));
    items.push({ id: uid(), sid: r.sub.id, q: qT, pages: Math.min(Math.round(r.remP), Math.max(1, Math.round(qT * r.sub.pages / r.sub.questions))), min: minutes, startQ: r.nextQnum });
  });
  return items;
}
function planActual(date, it) {
  let p = 0, q = 0, m = 0;
  S.logs.forEach(l => { if (l.date === date && l.sid === it.sid) { const c = logCounts(l); p += c.p; q += c.q; m += l.min || 0; } });
  return { p, q, m };
}
const planDone = (date, it) => !!it.q && planActual(date, it).q >= it.q;

/* ================= small renderers ================= */
/* ================= carry-forward targets and checklist ================= */
function overdueBlocks(date) {
  const out = [];
  for (let i = 1; i <= 7; i++) {
    const k = addDays(date, -i);
    (S.plans[k] || []).forEach(it => {
      if (it.carried || !it.q) return;
      const a = planActual(k, it); if (a.q >= it.q) return;
      out.push({ k, it, q: it.q - a.q, pages: Math.max(0, it.pages - a.p), min: Math.max(0, it.min - a.m) });
    });
  }
  return out;
}
function overdueTodos(date) {
  const out = [];
  for (let i = 1; i <= 14; i++) { const k = addDays(date, -i); (S.todos[k] || []).forEach(t => { if (!t.done && !t.moved) out.push({ k, t }); }); }
  return out;
}
function carryBlock(date, k, id) {
  const src = (S.plans[k] || []).find(x => x.id === id); if (!src || src.carried) return;
  const a = planActual(k, src), r = compute().subs[src.sid];
  (S.plans[date] = S.plans[date] || []).push({ id: uid(), sid: src.sid, q: Math.max(1, src.q - a.q), pages: Math.max(0, src.pages - a.p), min: Math.max(0, src.min - a.m), startQ: r.nextQnum, from: k });
  src.carried = date;
}
function carryTodo(date, k, id) {
  const src = (S.todos[k] || []).find(x => x.id === id); if (!src || src.moved) return;
  (S.todos[date] = S.todos[date] || []).push({ id: uid(), text: src.text, done: false, from: k });
  src.moved = date;
}
function carryAll(date) { overdueBlocks(date).forEach(o => carryBlock(date, o.k, o.it.id)); overdueTodos(date).forEach(o => carryTodo(date, o.k, o.t.id)); }
function todoRows(date, withDel) {
  return (S.todos[date] || []).filter(t => !t.moved).map(t => '<div class="item"><label class="check grow" style="margin:0"><input type="checkbox" data-act="todo-toggle" data-day="' + date + '" data-id="' + t.id + '"' + (t.done ? ' checked' : '') + '> <span' + (t.done ? ' class="muted" style="text-decoration:line-through"' : '') + '>' + esc(t.text) + '</span>' +
    (t.from ? ' <span class="badge">from ' + fmtDate(t.from) + '</span>' : '') + '</label>' +
    (withDel ? '<button class="btn small danger" data-act="todo-del" data-day="' + date + '" data-id="' + t.id + '">Remove</button>' : '') + '</div>').join('');
}
function viewCarry(date) {
  if (date < today()) return '';
  const ob = overdueBlocks(date), ot = overdueTodos(date); if (!ob.length && !ot.length) return '';
  return '<div class="card mt" style="border-color:var(--warn)"><div class="row between"><h2 style="margin:0">Not finished from earlier days</h2><button class="btn small primary" data-act="carry-all" data-to="' + date + '">Carry all to ' + (date === today() ? 'today' : fmtDate(date)) + '</button></div>' +
    '<p class="muted small">Only the unfinished part is carried. Once carried, it shows up as a normal block or task on this day.</p>' +
    ob.map(o => '<div class="item"><div class="grow"><b>' + esc(SUB[o.it.sid].name) + '</b><div class="muted small">' + Math.round(o.q) + ' questions' + (o.pages ? ', ' + Math.round(o.pages) + ' pages' : '') + (o.min ? ', ' + hm(o.min) : '') + ' left &middot; planned for ' + fmtDate(o.k) + '</div></div><button class="btn small" data-act="carry-block" data-day="' + o.k + '" data-id="' + o.it.id + '" data-to="' + date + '">Carry</button></div>').join('') +
    ot.map(o => '<div class="item"><div class="grow"><b>' + esc(o.t.text) + '</b><div class="muted small">Task from ' + fmtDate(o.k) + '</div></div><button class="btn small" data-act="carry-todo" data-day="' + o.k + '" data-id="' + o.t.id + '" data-to="' + date + '">Carry</button></div>').join('') + '</div>';
}
function viewTodos(date) {
  return '<div class="card mt"><h2>Checklist for ' + fmtDate(date, true) + '</h2>' + (todoRows(date, true) || '<p class="muted small">Nothing yet. Add small targets like "revise normalization notes". Unchecked ones can be carried to the next day.</p>') +
    '<form id="todo-form" class="row mt"><input type="text" id="t-text" maxlength="140" placeholder="Add a target or task" style="flex:1;min-width:160px"><button class="btn primary" type="submit">Add</button></form></div>';
}

/* ================= editing book numbers ================= */
let EDIT = null;
function openEdit(sid) {
  const sub = SUB[sid], m = buildMap(sub);
  EDIT = { sid, pages: sub.pages, questions: sub.questions, topics: sub.topics.map((t, i) => ({ n: t.n, q: t.q, s: Math.round(m[i].ps) + 1 })) };
}
function readEdit() {
  if (!EDIT || !$('#edit-form')) return;
  EDIT.pages = $('#e-pages').value;
  if (!EDIT.topics.length) EDIT.questions = $('#e-q').value;
  EDIT.topics.forEach((t, i) => { t.n = $('#e-n' + i).value; t.q = $('#e-tq' + i).value; t.s = $('#e-s' + i).value; });
}
function saveEdit() {
  readEdit(); const E = EDIT, sub = SUB[E.sid], pages = Math.round(+E.pages), rec = { pages };
  if (!(pages >= 1)) return toast('Pages must be at least 1');
  if (E.topics.length) {
    const tops = []; let prev = 0;
    for (let i = 0; i < E.topics.length; i++) {
      const t = E.topics[i], q = Math.round(+t.q), s = Math.round(+t.s), n = String(t.n).trim(), w = 'Topic ' + (i + 1) + ': ';
      if (!n) return toast(w + 'needs a name');
      if (!(q >= 1)) return toast(w + 'needs at least 1 question');
      if (!(s >= 1 && s <= pages)) return toast(w + 'start page must be between 1 and ' + pages);
      if (s < prev) return toast(w + 'starts before the previous topic');
      tops.push({ n, q, s }); prev = s;
    }
    rec.topics = tops;
  } else {
    const q = Math.round(+E.questions); if (!(q >= 1)) return toast('Questions must be at least 1'); rec.questions = q;
  }
  const oldQ = sub.topics.map(t => t.q).join(',') + '|' + sub.questions, newQ = (rec.topics ? rec.topics.map(t => t.q).join(',') : '') + '|' + (rec.topics ? rec.topics.reduce((x, t) => x + t.q, 0) : rec.questions);
  if (oldQ !== newQ && S.logs.some(l => l.sid === E.sid) && !confirm('Changing question counts shifts which question numbers belong to which topic. Your logs keep their numbers. Continue?')) return;
  S.edits[E.sid] = rec; delete S.pageStart[E.sid]; EDIT = null; applyEdits(); save(); render(); toast('Book numbers saved');
}
function viewEditBook(sub) {
  if (!EDIT || EDIT.sid !== sub.id) return '<div class="row mt"><button class="btn" data-act="edit-open">Edit numbers for this book</button>' + (S.edits[sub.id] ? '<span class="badge">edited</span>' : '') + '</div>';
  const rows = EDIT.topics.map((t, i) => '<tr><td>' + (i + 1) + '</td><td><input type="text" id="e-n' + i + '" value="' + esc(t.n) + '" style="min-width:180px"></td>' +
    '<td><input class="pg" type="number" min="1" id="e-tq' + i + '" value="' + esc(t.q) + '"></td><td><input class="pg" type="number" min="1" id="e-s' + i + '" value="' + esc(t.s) + '"></td></tr>').join('');
  return '<form id="edit-form" class="card mt stack" style="border-color:var(--accent)"><h2>Edit numbers: ' + esc(sub.name) + '</h2>' +
    '<div class="form-grid"><label>Total pages in the PDF<input type="number" min="1" id="e-pages" value="' + esc(EDIT.pages) + '"></label>' +
    (EDIT.topics.length ? '<label>Total questions<input type="number" value="' + EDIT.topics.reduce((x, t) => x + (+t.q || 0), 0) + '" disabled title="Sum of the topic question counts"></label>' : '<label>Total questions<input type="number" min="1" id="e-q" value="' + esc(EDIT.questions) + '"></label>') + '</div>' +
    (EDIT.topics.length ? '<div class="scroll"><table><thead><tr><th>#</th><th>Topic name</th><th>Questions</th><th>Starts at page</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="row"><button type="button" class="btn small" data-act="edit-add">Add topic at the end</button><button type="button" class="btn small" data-act="edit-rm">Remove last topic</button></div>' : '') +
    '<p class="muted small">Total questions is the sum of the topic counts. Saving replaces the start pages you edited in the table below. Existing logs keep their question and page numbers.</p>' +
    '<div class="row"><button class="btn primary" type="submit">Save</button><button type="button" class="btn" data-act="edit-cancel">Cancel</button><button type="button" class="btn danger" data-act="edit-reset">Reset to PDF defaults</button></div></form>';
}

function ring(pct, size, stroke) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, h = size / 2, f = clamp(pct, 0, 1);
  return '<svg class="ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle class="ring-bg" cx="' + h + '" cy="' + h + '" r="' + r + '" stroke-width="' + stroke + '"/>' +
    '<circle class="ring-fg" cx="' + h + '" cy="' + h + '" r="' + r + '" stroke-width="' + stroke + '" stroke-dasharray="' + (c * f) + ' ' + c + '" transform="rotate(-90 ' + h + ' ' + h + ')"/>' +
    '<text class="ring-t" x="' + h + '" y="' + h + '">' + fmtPct(pct) + '</text></svg>';
}
function bar(p, color, tall) { return '<div class="bar' + (tall ? ' tall' : '') + '"><i style="width:' + clamp(p * 100, 0, 100).toFixed(1) + '%;' + (color ? '--c:' + color : '') + '"></i></div>'; }
function metric(label, done, total, color) {
  const left = total - done;
  return '<div class="metric"><div class="ml"><span>' + label + '</span><span>' + Math.round(done).toLocaleString() + ' / ' + total.toLocaleString() +
    ' &middot; ' + (left < 0.5 ? 'complete' : Math.round(left).toLocaleString() + ' left') + '</span></div>' + bar(total ? done / total : 0, color) + '</div>';
}
function tile(k, v, s) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
const subjectOptions = sel => SUBJECTS.map(s => '<option value="' + s.id + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');

/* ================= charts (inline SVG) ================= */
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function chartFrame(W, H, ml, mr, mt, mb, max, fmt) {
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = mt + (H - mt - mb) * (1 - i / 4);
    g += '<line class="grid-l" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (ml - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + fmt(max * i / 4) + '</text>';
  }
  return g;
}
function barChart(items, o) {
  o = o || {};
  const W = 720, H = o.h || 230, ml = 44, mr = 10, mt = 10, mb = 26, fmt = o.fmt || (v => Math.round(v));
  const max = niceMax(Math.max(o.goal || 0, Math.max.apply(null, items.map(i => i.total).concat([1]))) * 1.05);
  const iw = W - ml - mr, ih = H - mt - mb, n = items.length, bw = iw / n, step = Math.ceil(n / 10);
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">' + chartFrame(W, H, ml, mr, mt, mb, max, fmt);
  items.forEach((it, i) => {
    const x = ml + i * bw + bw * 0.15, w = bw * 0.7; let y = mt + ih;
    s += '<g><title>' + esc(it.tip) + '</title>';
    (it.segs || []).forEach(sg => { const h = ih * sg.v / max; y -= h; if (h > 0) s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + sg.color + '"/>'; });
    s += '<rect x="' + (ml + i * bw).toFixed(1) + '" y="' + mt + '" width="' + bw.toFixed(1) + '" height="' + ih + '" fill="transparent"/></g>';
    if (i % step === 0 || i === n - 1) s += '<text x="' + (ml + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(it.label) + '</text>';
  });
  if (o.goal) { const gy = mt + ih * (1 - o.goal / max); s += '<line class="goal" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + gy + '" y2="' + gy + '"/>'; }
  return s + '</svg>';
}
function lineChart(labels, series, o) {
  o = o || {};
  const W = 720, H = o.h || 230, ml = 44, mr = 10, mt = 10, mb = 26, fmt = o.fmt || (v => Math.round(v));
  const max = niceMax(Math.max.apply(null, series.reduce((a, s) => a.concat(s.values), [1])) * 1.05);
  const iw = W - ml - mr, ih = H - mt - mb, n = labels.length, step = Math.ceil(n / 10);
  const px = i => ml + (n === 1 ? iw / 2 : iw * i / (n - 1)), py = v => mt + ih * (1 - v / max);
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">' + chartFrame(W, H, ml, mr, mt, mb, max, fmt);
  labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) s += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(l) + '</text>'; });
  series.forEach(se => {
    s += '<polyline fill="none" stroke="' + se.color + '" stroke-width="2.2" stroke-linejoin="round" points="' + se.values.map((v, i) => px(i).toFixed(1) + ',' + py(v).toFixed(1)).join(' ') + '"/>';
    if (n <= 45) se.values.forEach((v, i) => { s += '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(v).toFixed(1) + '" r="3" fill="' + se.color + '"><title>' + esc(labels[i] + ' - ' + se.name + ': ' + Math.round(v)) + '</title></circle>'; });
  });
  return s + '</svg>';
}
function heatmap(C, weeks) {
  const cell = 13, gap = 3, ml = 28, mt = 18, end = parseD(today());
  const start = new Date(end); start.setDate(start.getDate() - end.getDay() - (weeks - 1) * 7);
  const W = ml + weeks * (cell + gap), H = mt + 7 * (cell + gap), goal = S.settings.dailyMin || 360;
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">', lastMonth = -1;
  ['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach((l, i) => { if (l) s += '<text x="0" y="' + (mt + i * (cell + gap) + 10) + '">' + l + '</text>'; });
  for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
    const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d); if (dt > end) continue;
    const k = dkey(dt), m = (C.byDay[k] || {}).min || 0, lv = m <= 0 ? 0 : m < goal * 0.25 ? 1 : m < goal * 0.5 ? 2 : m < goal ? 3 : 4;
    if (d === 0 && dt.getMonth() !== lastMonth) { lastMonth = dt.getMonth(); s += '<text x="' + (ml + w * (cell + gap)) + '" y="11">' + dt.toLocaleDateString('en-IN', { month: 'short' }) + '</text>'; }
    s += '<rect class="h' + lv + '" x="' + (ml + w * (cell + gap)) + '" y="' + (mt + d * (cell + gap)) + '" width="' + cell + '" height="' + cell + '" rx="3"><title>' + fmtDate(k) + ': ' + hm(m) + '</title></rect>';
  }
  return s + '</svg>';
}
const rangeDays = n => { const o = []; for (let i = n - 1; i >= 0; i--) o.push(addDays(today(), -i)); return o; };
function dayItem(C, k) {
  const d = C.byDay[k] || { min: 0, pages: 0, q: 0, subs: {} };
  const segs = Object.keys(d.subs).map(sid => ({ v: d.subs[sid], color: subColor(SUB[sid]) }));
  const bd = Object.keys(d.subs).map(sid => SUB[sid].short + ' ' + hm(d.subs[sid])).join(', ');
  return { label: parseD(k).getDate() + '/' + (parseD(k).getMonth() + 1), segs, total: d.min, tip: fmtDate(k) + ': ' + hm(d.min) + ' | ' + d.pages + ' pages | ' + d.q + ' questions' + (bd ? ' | ' + bd : '') };
}
function progressChart(C, metricKey) {
  const T = C.T;
  const val = r => metricKey === 'questions' ? [r.qDone, r.sub.questions] : metricKey === 'pages' ? [r.pagesDone, r.sub.pages] : [r.topicsDone, r.nt];
  const tot = metricKey === 'questions' ? [T.qDone, T.q] : metricKey === 'pages' ? [T.pagesDone, T.pages] : [T.topicsDone, T.topics];
  const row = (label, d, t, color, cls) => '<div class="pb ' + (cls || '') + '"><span>' + esc(label) + '</span>' + bar(t ? d / t : 0, color, true) +
    '<span><b>' + Math.round(d).toLocaleString() + '</b> / ' + t.toLocaleString() + ' &middot; ' + (t - d < 0.5 ? 'done' : Math.round(t - d).toLocaleString() + ' left') + '</span></div>';
  let h = row('All', tot[0], tot[1], 'var(--accent)', 'total');
  Object.values(C.subs).forEach(r => { if (metricKey === 'topics' && !r.nt) return; const v = val(r); h += row(r.sub.short, v[0], v[1], subColor(r.sub)); });
  return h;
}

/* ================= log preview ================= */
function previewLog(d) {
  const sub = SUB[d.sid], P = sub.pages, Q = sub.questions, isQ = d.mode === 'q', max = isQ ? Q : P;
  let a = parseInt(d.from, 10), b = d.to === '' || d.to == null ? a : parseInt(d.to, 10);
  if (!(a >= 1)) return '<span class="muted">Enter where you started and where you stopped. This shows which topics that covers and how many questions it counts.</span>';
  if (!(b >= 1)) b = a;
  if (b < a) { const t = a; a = b; b = t; }
  if (b > max) return '<span class="err">' + (isQ ? 'Question' : 'Page') + ' numbers for ' + esc(sub.name) + ' run from 1 to ' + max + '.</span>';
  const m = buildMap(sub), iv = logIv(m, sub, { mode: d.mode, from: a, to: b });
  const others = S.logs.filter(l => l.sid === sub.id && l.id !== d.id).map(l => logIv(m, sub, l));
  const tick = S.topicDone[sub.id] || {};
  const qB = [], pB = [];
  others.forEach(o => { qB.push([o.qa, o.qb]); pB.push([o.pa, o.pb]); });
  if (sub.topics.length) m.forEach(s => { if (tick[s.i]) { qB.push([s.qs, s.qe]); pB.push([s.ps, s.pe]); } });
  const qBefore = mergeIv(qB), pBefore = mergeIv(pB);
  const qAfter = mergeIv(qB.concat([[iv.qa, iv.qb]])), pAfter = mergeIv(pB.concat([[iv.pa, iv.pb]]));
  const qCnt = iv.qb - iv.qa, pCnt = iv.pb - iv.pa, qNew = ivLen(qAfter) - ivLen(qBefore), pNew = ivLen(pAfter) - ivLen(pBefore);
  const qr = (x, y) => { const f = Math.floor(x + EPS) + 1, l = Math.ceil(y - EPS); return 'Q' + f + (l > f ? '-' + l : ''); };
  const pr = (x, y) => { const f = Math.floor(x + EPS) + 1, l = Math.ceil(y - EPS); return 'pages ' + f + (l > f ? '-' + l : ''); };
  const ab = m.exact ? '' : 'about ';
  let h = '<b>' + (isQ ? qr(iv.qa, iv.qb) + ' &middot; ' + ab + pr(iv.pa, iv.pb) : pr(iv.pa, iv.pb) + ' &middot; ' + ab + qr(iv.qa, iv.qb)) + '</b>' +
    '<div class="muted small">Counts as ' + Math.round(qCnt) + ' question' + (Math.round(qCnt) === 1 ? '' : 's') + ' and ' + Math.round(pCnt) + ' page' + (Math.round(pCnt) === 1 ? '' : 's') + '.' +
    (Math.round(qCnt - qNew) > 0 || Math.round(pCnt - pNew) > 0 ? ' New progress: ' + Math.round(qNew) + ' questions, ' + Math.round(pNew) + ' pages (the rest you had already covered).' : '') + '</div>';
  const fq = Math.floor(iv.qa + EPS), lq = Math.ceil(iv.qb - EPS) - 1, qiA = qinfo(sub, fq), qiB = qinfo(sub, lq);
  if (qiA && qiB && lq >= fq) {
    const qd = (i, k) => esc(i.src) + ' (Q' + (k + 1) + ', page ' + i.page + ')';
    h += '<div class="muted small">' + (lq > fq ? 'From ' + qd(qiA, fq) + ' to ' + qd(qiB, lq) : 'Question: ' + qd(qiA, fq)) + '</div>';
  }
  if (sub.topics.length) {
    const rows = m.filter(s => Math.min(iv.qb, s.qe) - Math.max(iv.qa, s.qs) > EPS).map(s => {
      const x = Math.max(iv.qa, s.qs), y = Math.min(iv.qb, s.qe), cnt = Math.round(y - x);
      return '<li>' + (s.i + 1) + '. ' + esc(s.n) + ': ' + qr(x, y) + ' (' + cnt + (cnt === 1 ? ' question' : ' questions') + (y - x >= s.q - 0.05 ? ', whole topic' : ', ' + Math.round((y - x) / s.q * 100) + '% of it') + ')</li>';
    }).join('');
    h += '<ul>' + (rows || '<li class="muted">No question content in this range (check the page start numbers in Subjects).</li>') + '</ul>';
  }
  if (!isQ && !sub.topics.length) { /* GA pages only */ }
  return h;
}

/* ================= views ================= */
let route = 'dashboard', routeArg = '';
let dashSort = 'default', insightRange = 30, progMetric = 'questions';
const blankLog = () => ({ id: null, date: today(), sid: SUBJECTS[0].id, mode: 'q', from: '', to: '', min: '', note: '' });
let LOG = blankLog();
let PLAN = { date: addDays(today(), 1), form: { sid: SUBJECTS[0].id, pages: '', q: '', min: '' } };
let subjSel = SUBJECTS[0].id;

function viewDashboard(C) {
  const T = C.T, st = S.settings, td = today(), left = diffDays(td, st.examDate);
  const a7 = avgPerDay(C, 7), pr = projection(C), sk = getStreak(C), pc = pacing(td, C);
  const started = S.logs.length > 0 || Object.keys(S.topicDone).some(id => Object.keys(S.topicDone[id] || {}).length > 0);
  const dd = C.byDay[td] || { min: 0, pages: 0, q: 0 }, ga = C.subs.ga;
  let subs = Object.values(C.subs);
  if (dashSort === 'least') subs.sort((a, b) => a.pct - b.pct);
  else if (dashSort === 'remaining') subs.sort((a, b) => (b.remP / T.pages + b.remQ / T.q) - (a.remP / T.pages + a.remQ / T.q));
  else if (dashSort === 'stale') subs.sort((a, b) => (a.last || '') < (b.last || '') ? -1 : 1);
  const projTxt = pr ? (pr.days === 0 ? 'Done' : fmtDate(pr.date)) : 'No data yet';
  const gaToday = qOnDay(C, td, 'ga');
  const gaDays = st.dailyGA > 0 ? Math.ceil(ga.remQ / st.dailyGA) : 0;
  const plans = [td, addDays(td, 1)].map(k => {
    const items = S.plans[k] || [], lab = k === td ? 'Today' : 'Tomorrow';
    if (!items.length) return '<div class="item"><div class="grow"><b>' + lab + '</b><div class="muted small">No plan yet.</div></div><a class="btn small" href="#plan" data-plan-date="' + k + '">Plan it</a></div>';
    const dn = items.filter(it => planDone(k, it)).length;
    return '<div class="item"><div class="grow"><b>' + lab + '</b><div class="muted small">' + dn + ' of ' + items.length + ' blocks done &middot; ' + items.map(it => esc(SUB[it.sid].short)).join(', ') + '</div></div><a class="btn small" href="#plan" data-plan-date="' + k + '">Open</a></div>';
  }).join('');
  const nCarry = overdueBlocks(td).length + overdueTodos(td).length;
  const carryRow = nCarry ? '<div class="item"><div class="grow"><b>Not finished</b><div class="muted small">' + nCarry + ' item' + (nCarry === 1 ? '' : 's') + ' from earlier days</div></div><button class="btn small primary" data-act="carry-all" data-to="' + td + '">Carry to today</button></div>' : '';
  const taskRows = [td, addDays(td, 1)].map(k => { const r = todoRows(k, false); return r ? '<div class="small muted mt">' + (k === td ? 'Today' : 'Tomorrow') + ' tasks</div>' + r : ''; }).join('');

  return '<div class="page-head"><h1>Dashboard</h1><span class="muted">' + fmtDate(td, true) + '</span></div>' +
    (!started ? '<div class="card welcome-card"><div class="welcome-kicker">Your study space</div><h2>Ready when you are.</h2><p class="muted">Nothing has been logged yet. Add your first session from the Log tab and your dashboard will start reflecting your actual progress.</p><a class="btn primary" href="#log">Log your first session</a></div>' : '') +
    '<div class="card hero">' + ring(T.pct, 160, 16) + '<div class="stack" style="width:100%"><div class="tiles">' +
    tile('Pages', Math.round(T.pagesDone).toLocaleString(), 'of ' + T.pages.toLocaleString() + ' &middot; ' + Math.round(T.pages - T.pagesDone).toLocaleString() + ' left') +
    tile('Questions', Math.round(T.qDone).toLocaleString(), 'of ' + T.q.toLocaleString() + ' &middot; ' + Math.round(T.q - T.qDone).toLocaleString() + ' left') +
    tile('Topics', T.topicsDone + ' / ' + T.topics, (T.topics - T.topicsDone) + ' left (GA has no topics)') +
    tile('Time studied', hm(T.min), 'all time') +
    tile('Streak', sk.cur + ' day' + (sk.cur === 1 ? '' : 's'), 'best ' + sk.best) +
    tile('Exam in', left >= 0 ? left + ' days' : 'passed', fmtDate(st.examDate)) + '</div></div></div>' +

    '<div class="card mt"><div class="row between"><h2 style="margin:0">Solved vs remaining</h2><div class="chips">' +
    [['questions', 'Questions'], ['pages', 'Pages'], ['topics', 'Topics']].map(x => '<button data-act="prog" data-v="' + x[0] + '" class="' + (progMetric === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') +
    '</div></div><div class="mt">' + progressChart(C, progMetric) + '</div></div>' +

    '<div class="grid g2 mt"><div class="card"><h2>Today</h2>' +
    metric('Minutes studied', Math.min(dd.min, st.dailyMin), st.dailyMin, 'var(--accent)') +
    (st.dailyGA > 0 ? metric('General Aptitude questions', Math.min(gaToday, st.dailyGA), st.dailyGA, subColor(SUB.ga)) : '') +
    '<div class="row mt small muted"><span>' + hm(dd.min) + ' studied</span><span>' + dd.pages + ' pages</span><span>' + dd.q + ' questions</span></div>' +
    '<div class="mt">' + carryRow + plans + taskRows + '</div></div>' +
    '<div class="card"><h2>Pace</h2><div class="tiles">' +
    tile('Needed per day', Math.ceil(pc.reqQ) + ' q', Math.ceil(pc.reqP) + ' pages, core subjects, ' + pc.left + ' study days') +
    tile('Your 7-day avg', Math.round(a7.q) + ' q', Math.round(a7.pages) + ' pages, ' + hm(a7.min)) +
    tile('Projected finish', projTxt, 'at your 14-day pace') +
    (st.dailyGA > 0 ? tile('GA at ' + st.dailyGA + '/day', ga.finished ? 'Done' : gaDays + ' days', ga.finished ? '' : 'finishes ' + fmtDate(addDays(td, gaDays))) : '') +
    '</div></div></div>' +

    '<div class="card mt"><h2>Last 14 days</h2>' + (started ? barChart(rangeDays(14).map(k => dayItem(C, k)), { goal: st.dailyMin, h: 190, fmt: v => hm(v) }) : '<p class="muted">Your study history will appear here after your first logged session.</p>') + '</div>' +
    '<div class="row between mt"><h2 style="margin:0">Subjects</h2><label class="row small" style="flex-direction:row;align-items:center">Sort&nbsp;' +
    '<select id="dash-sort" style="width:auto"><option value="default">Syllabus order</option><option value="least"' + (dashSort === 'least' ? ' selected' : '') + '>Least complete</option><option value="remaining"' + (dashSort === 'remaining' ? ' selected' : '') + '>Most work left</option><option value="stale"' + (dashSort === 'stale' ? ' selected' : '') + '>Least recently studied</option></select></label></div>' +
    '<div class="grid cards mt">' + subs.map(r => {
      const c = subColor(r.sub);
      return '<div class="card scard" data-act="open-subject" data-id="' + r.sub.id + '" style="--c:' + c + '"><div class="shead"><span class="dot"></span><b>' + esc(r.sub.name) + '</b><span class="pct">' + fmtPct(r.pct) + '</span></div>' +
        metric('Pages', r.pagesDone, r.sub.pages, c) + metric('Questions', r.qDone, r.sub.questions, c) + (r.nt ? metric('Topics', r.topicsDone, r.nt, c) : '') +
        '<div class="foot"><span>' + (r.finished ? 'All questions covered' : 'Next gap: Q' + r.nextQnum + ' / page ' + r.nextPage) + '</span><span>' + (r.last ? fmtDate(r.last) : 'Not started') + '</span></div></div>';
    }).join('') + '</div>';
}

function viewLog(C) {
  const d = LOG, r = C.subs[d.sid], sub = r.sub, isQ = d.mode === 'q', max = isQ ? sub.questions : sub.pages;
  const dates = Object.keys(C.byDay).sort().reverse().slice(0, 14), by = {};
  S.logs.forEach(l => { (by[l.date] = by[l.date] || []).push(l); });
  const hist = dates.map(k => '<div class="daytitle"><span>' + fmtDate(k, true) + '</span><span class="muted small">' + hm(C.byDay[k].min) + ' &middot; ' + C.byDay[k].pages + ' pages &middot; ' + C.byDay[k].q + ' q</span></div>' +
    by[k].slice().reverse().map(l => {
      const s = SUB[l.sid], c = logCounts(l), m = buildMap(s), iv = logIv(m, s, l);
      const tps = s.topics.length ? m.filter(x => Math.min(iv.qb, x.qe) - Math.max(iv.qa, x.qs) > EPS).map(x => x.i + 1) : [];
      return '<div class="item"><span class="dot" style="--c:' + subColor(s) + '; margin-top:7px"></span><div class="grow"><b>' + esc(s.name) + '</b> <span class="muted small">' + describeLog(l) + '</span>' +
        '<div class="muted small">' + c.q + ' questions &middot; ' + c.p + ' pages' + (l.min ? ' &middot; ' + hm(l.min) : '') + (tps.length ? ' &middot; topic' + (tps.length > 1 ? 's ' + tps[0] + '-' + tps[tps.length - 1] : ' ' + tps[0]) : '') + (l.note ? ' &middot; ' + esc(l.note) : '') + '</div></div>' +
        '<button class="btn small" data-act="edit-log" data-id="' + l.id + '">Edit</button> <button class="btn small danger" data-act="del-log" data-id="' + l.id + '">Delete</button></div>';
    }).join('')).join('');

  return '<div class="page-head"><h1>' + (d.id ? 'Edit entry' : 'Update progress') + '</h1><span class="muted">Say where you got to. Any order, any day.</span></div>' +
    '<form id="log-form" class="card stack"><div class="form-grid">' +
    '<label>Date<input type="date" id="f-date" value="' + d.date + '" max="' + today() + '" required></label>' +
    '<label>Subject<select id="f-sid">' + subjectOptions(d.sid) + '</select></label>' +
    '<div class="wide row"><span class="muted small">I am tracking by</span><div class="seg"><label><input type="radio" name="f-mode" value="p"' + (isQ ? '' : ' checked') + '>Pages</label><label><input type="radio" name="f-mode" value="q"' + (isQ ? ' checked' : '') + '>Questions</label></div></div>' +
    '<label>From ' + (isQ ? 'question' : 'page') + '<input type="number" id="f-from" min="1" max="' + max + '" inputmode="numeric" placeholder="1 to ' + max + '" value="' + esc(d.from) + '"></label>' +
    '<label>To ' + (isQ ? 'question' : 'page') + '<input type="number" id="f-to" min="1" max="' + max + '" inputmode="numeric" placeholder="same as from" value="' + esc(d.to) + '"></label>' +
    '<label>Minutes (optional)<input type="number" id="f-min" min="0" inputmode="numeric" value="' + esc(d.min) + '"></label>' +
    '<label class="wide">Notes (optional)<textarea id="f-note" placeholder="What was tricky, what to revise...">' + esc(d.note) + '</textarea></label></div>' +
    '<div class="row"><button type="button" class="btn small" data-act="continue">' + (r.finished ? 'Subject is fully covered' : 'Start from my next gap (' + (isQ ? 'Q' + r.nextQnum : 'page ' + r.nextPage) + ')') + '</button>' +
    '<span class="muted small">Add minutes:</span><button type="button" class="btn small" data-act="add-min" data-v="30">+30</button><button type="button" class="btn small" data-act="add-min" data-v="60">+60</button></div>' +
    (isQ ? '<p class="muted small" style="margin:0">Question numbers here mean the position in the book (1st, 2nd, ... in the order the PDF lists them), not the number stamped on the page. In Algorithms, Compiler Design, Networks, COA, Digital Logic, Graph Theory, OS and TOC the stamped numbers are scrambled, so for those books pages are the easier way to log. The preview below names the exam question each number refers to, and the Subjects tab has a finder to look a question up by its exam name.</p>' : '') +
    '<div id="preview" class="preview">' + previewLog(d) + '</div>' +
    '<div class="row"><button class="btn primary" type="submit">' + (d.id ? 'Update entry' : 'Save progress') + '</button>' + (d.id ? '<button type="button" class="btn" data-act="cancel-edit">Cancel</button>' : '') +
    '<span class="muted small">' + esc(sub.short) + ' so far: ' + Math.round(r.qDone) + '/' + sub.questions + ' questions, ' + Math.round(r.pagesDone) + '/' + sub.pages + ' pages</span></div></form>' +
    '<h2 class="mt">Recent days</h2>' + (hist ? '<div class="card">' + hist + '</div>' : '<p class="muted">Nothing logged yet. Your first update shows up here.</p>');
}

function viewPlan(C) {
  const k = PLAN.date, items = S.plans[k] || [], st = S.settings, pc = pacing(k, C), a7 = avgPerDay(C, 7), f = PLAN.form;
  const tot = items.reduce((a, it) => ({ min: a.min + it.min, p: a.p + it.pages, q: a.q + it.q }), { min: 0, p: 0, q: 0 });
  const rows = items.map(it => {
    const s = SUB[it.sid], r = C.subs[it.sid], a = planActual(k, it), ok = planDone(k, it), t = it.startQ ? topicAtQ(r, it.startQ - 1) : null;
    return '<div class="item"><span class="dot" style="--c:' + subColor(s) + '; margin-top:7px"></span><div class="grow"><div class="row between"><b>' + esc(s.name) + '</b>' + (it.from ? '<span class="badge">Carried from ' + fmtDate(it.from) + '</span> ' : '') + (ok ? '<span class="badge ok">Done</span>' : '') + '</div>' +
      (it.startQ ? '<div class="small">Suggested start: Q' + it.startQ + (t ? ' (' + (t.i + 1) + '. ' + esc(t.n) + ')' : '') + '. Any order is fine, just log what you do.</div>' : '') +
      metric('Questions', Math.min(a.q, it.q), it.q, subColor(s)) + metric('Pages', Math.min(a.p, it.pages), it.pages, subColor(s)) +
      '<div class="muted small" style="margin-top:6px">Target ' + hm(it.min) + ' &middot; logged ' + hm(a.m) + '</div></div>' +
      '<div class="stack" style="gap:6px"><button class="btn small" data-act="plan-log" data-id="' + it.id + '">Log it</button><button class="btn small danger" data-act="plan-del" data-id="' + it.id + '">Remove</button></div></div>';
  }).join('');
  return '<div class="page-head"><h1>Plan</h1><div class="row"><button class="btn small" data-act="plan-prev">&larr;</button><input type="date" id="plan-date" value="' + k + '" style="width:auto"><button class="btn small" data-act="plan-next">&rarr;</button><button class="btn small" data-act="plan-tomorrow">Tomorrow</button></div></div>' +
    '<div class="grid g2"><div class="card"><h2>' + fmtDate(k, true) + '</h2><div class="tiles">' + tile('Planned', hm(tot.min), 'goal ' + hm(st.dailyMin)) + tile('Questions', tot.q, 'planned') + tile('Pages', tot.p, 'planned') + '</div>' +
    '<div class="row mt"><button class="btn primary" data-act="plan-gen">' + (items.length ? 'Regenerate suggestion' : 'Suggest a plan') + '</button>' + (items.length ? '<button class="btn danger" data-act="plan-clear">Clear day</button>' : '') + '</div>' +
    '<p class="muted small">Suggestions include ' + st.dailyGA + ' General Aptitude questions, plus the subjects with the most work left or the longest gap. The suggested start is only a hint; log whatever you actually do.</p></div>' +
    '<div class="card"><h2>Pace check</h2><div class="tiles">' + tile('Needed per day', Math.ceil(pc.reqQ) + ' q', Math.ceil(pc.reqP) + ' pages (core subjects)') + tile('Your 7-day avg', Math.round(a7.q) + ' q', Math.round(a7.pages) + ' pages') + '</div>' +
    '<p class="muted small">' + pc.left + ' study days before the ' + st.revisionDays + '-day revision buffer (exam ' + fmtDate(st.examDate) + ').</p></div></div>' +
    '<div class="card mt"><h2>Blocks</h2>' + (rows || '<p class="muted">No blocks yet. Generate a suggestion or add your own below.</p>') + '</div>' +
    viewCarry(k) + viewTodos(k) + '<form id="plan-form" class="card mt stack"><h2>Add a block</h2><div class="form-grid"><label>Subject<select id="p-sid">' + subjectOptions(f.sid) + '</select></label>' +
    '<label>Questions<input type="number" id="p-q" min="0" value="' + esc(f.q) + '"></label><label>Pages<input type="number" id="p-pages" min="0" value="' + esc(f.pages) + '"></label><label>Minutes<input type="number" id="p-min" min="0" value="' + esc(f.min) + '"></label></div>' +
    '<div><button class="btn primary" type="submit">Add block</button></div></form>';
}

let FIND = '';
function finderResults(sub, txt) {
  const q = exactFor(sub), toks = txt.toLowerCase().split(/\s+/).filter(Boolean);
  if (!q) return '';
  if (!toks.length || txt.trim().length < 2) return '<span class="muted small">Type at least two characters.</span>';
  const C = compute(), r = C.subs[sub.id], m = r.map, hits = [];
  for (let k = 0; k < q.s.length && hits.length < 12; k++) { const L = q.s[k].toLowerCase(); if (toks.every(t => L.indexOf(t) >= 0)) hits.push(k); }
  if (!hits.length) return '<span class="muted small">No question in this book matches that.</span>';
  return hits.map(k => {
    const t = m.find(x => k < x.qe) || m[m.length - 1], done = ivOverlap(r.qM, k, k + 1) >= 0.99;
    return '<div class="item"><div class="grow"><b>Q' + (k + 1) + '</b> &middot; ' + esc(q.s[k]) + '<div class="muted small">page ' + q.p[k] + (sub.topics.length ? ' &middot; ' + esc(t.n) : '') + '</div></div><span class="muted small">' + (done ? 'covered' : 'not yet') + '</span></div>';
  }).join('');
}
function viewFinder(sub) {
  if (!exactFor(sub)) return '';
  return '<div class="card mt"><h2>Find a question</h2><p class="muted small">Type part of an exam name, such as 2013 Q31 or IT 2004, to see where it sits in this book (its position number, page and topic).</p>' +
    '<input id="finder" type="search" autocomplete="off" placeholder="e.g. 2013 Q31" value="' + esc(FIND) + '"><div id="finder-out" class="mt">' + finderResults(sub, FIND) + '</div></div>';
}
function viewSubjects(C) {
  const r = C.subs[subjSel], sub = r.sub, c = subColor(sub), nq = r.finished ? null : qinfo(sub, r.nextQnum - 1);
  const chips = '<div class="chips">' + SUBJECTS.map(s => '<button data-act="pick-subject" data-id="' + s.id + '" class="' + (s.id === subjSel ? 'on' : '') + '">' + esc(s.short) + '</button>').join('') + '</div>';
  const days = rangeDays(30).map(k => { const m = (C.byDay[k] && C.byDay[k].subs[sub.id]) || 0; return { label: parseD(k).getDate() + '/' + (parseD(k).getMonth() + 1), segs: [{ v: m, color: c }], total: m, tip: fmtDate(k) + ': ' + hm(m) }; });
  const rows = r.topics.map(t => '<tr class="' + (t.complete ? 'done' : '') + '"><td>' + (t.i + 1) + '</td><td>' + esc(t.n) + '</td>' +
    '<td>Q' + (Math.round(t.qs) + 1) + (t.q > 1 ? '-' + Math.round(t.qe) : '') + '</td>' +
    (r.map.exact ? '<td title="Exact, from the question directory">' + (Math.round(t.ps) + 1) + '&ndash;' + Math.round(t.pe) + '</td>' : '<td><input class="pg' + (t.ov ? ' ov' : '') + '" type="number" min="1" max="' + sub.pages + '" data-act="page-start" data-ti="' + t.i + '" value="' + (Math.round(t.ps) + 1) + '" title="Page where this topic starts"></td>') +
    '<td style="min-width:120px">' + bar(t.pct, c) + '</td><td>' + Math.round(t.qDone) + ' / ' + t.q + '</td>' +
    '<td><label class="check" style="margin:0"><input type="checkbox" data-act="topic-toggle" data-ti="' + t.i + '"' + (t.complete ? ' checked' : '') + (t.complete && !t.manual ? ' disabled title="Completed through your logged progress"' : '') + '> Done</label></td>' +
    '<td><button class="btn small" data-act="topic-log" data-ti="' + t.i + '">Log</button></td></tr>').join('');
  return '<div class="page-head"><h1>Subjects</h1></div>' + chips +
    '<div class="card mt" style="border-color:' + c + '"><div class="row between"><h2 style="margin:0">' + esc(sub.name) + '</h2><span class="pct">' + fmtPct(r.pct) + '</span></div>' +
    '<div class="grid g3 mt">' + metric('Pages', r.pagesDone, sub.pages, c) + metric('Questions', r.qDone, sub.questions, c) + (r.nt ? metric('Topics', r.topicsDone, r.nt, c) : '<div class="muted small mt">No topic split for this book. Track it by question number or page.</div>') + '</div>' +
    '<p class="muted small">' + hm(r.min) + ' studied in total' + (r.last ? ', last on ' + fmtDate(r.last) : '') + '. ' + (r.finished ? 'Every question is covered.' : 'First gap: Q' + r.nextQnum + ' / page ' + r.nextPage + (nq ? ' (' + esc(nq.src) + ')' : '') + '.') + '</p>' +
    '<button class="btn" data-act="topic-log" data-ti="-1">Update progress for this book</button></div>' +
    viewEditBook(sub) + (r.nt ? '<div class="card mt scroll"><table><thead><tr><th>#</th><th>Topic</th><th>Questions</th><th>' + (r.map.exact ? 'Pages' : 'Starts at page') + '</th><th>Progress</th><th>Done</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (r.map.exact ? '<p class="muted small">Page numbers for every question come from the PYQ directory, so logging by page or by question gives the same answer. If you edit this book\'s numbers above, it falls back to an even-spread estimate.</p></div>' :
      '<p class="muted small">Topic start pages come from your PDFs. Inside a topic, pages are spread evenly across its questions. Edit a start page here if one looks wrong (edited ones turn outlined). ' +
      '<button class="btn small" data-act="reset-pages">Reset to PDF defaults</button></p></div>') : '') + viewFinder(sub) +
    '<div class="card mt"><h2>Time on ' + esc(sub.short) + ', last 30 days</h2>' + barChart(days, { h: 170, fmt: v => hm(v) }) + '</div>';
}

function insightsExtra(C, ds) {
  const st = S.settings, n = ds.length, td = today();
  const sp = {}; S.logs.forEach(l => { if (!(l.min > 0)) return; const c = logCounts(l), o = sp[l.sid] || (sp[l.sid] = { m: 0, q: 0, p: 0 }); o.m += l.min; o.q += c.q; o.p += c.p; });
  const work = r => r.remP / C.T.pages + r.remQ / C.T.q, totWork = Object.values(C.subs).reduce((x, r) => x + work(r), 0) || 1;
  let needH = 0, untimed = 0;
  const rows = SUBJECTS.map(sub => {
    const r = C.subs[sub.id], o = sp[sub.id], qph = o && o.q > 0 ? o.q / (o.m / 60) : 0, pph = o && o.p > 0 ? o.p / (o.m / 60) : 0;
    let left = 0; if (r.remQ > 0.5) { if (qph > 0) { left = r.remQ / qph; needH += left; } else { left = null; untimed++; } }
    return '<tr><td>' + esc(sub.short) + '</td><td>' + fmtPct(r.pct) + '</td><td>' + hm(r.min) + '</td><td>' + (C.T.min ? Math.round(100 * r.min / C.T.min) + '%' : '-') + '</td><td>' + Math.round(100 * work(r) / totWork) + '%</td><td>' + (qph ? qph.toFixed(1) : '-') + '</td><td>' + (pph ? pph.toFixed(1) : '-') + '</td><td>' + (left === null ? '-' : hm(left * 60)) + '</td></tr>';
  }).join('');
  const availH = Math.max(0, diffDays(td, st.examDate) - st.revisionDays + 1) * st.dailyMin / 60;
  const dow = (parseD(td).getDay() + 6) % 7, start0 = addDays(td, -dow), weeks = [];
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(start0, -7 * i); let m = 0, q = 0, pg = 0;
    for (let d = 0; d < 7; d++) { const x = C.byDay[addDays(ws, d)]; if (x) { m += x.min; q += x.q; pg += x.pages; } }
    weeks.push({ ws, m, q, pg });
  }
  const wItems = weeks.map(w => ({ label: parseD(w.ws).getDate() + '/' + (parseD(w.ws).getMonth() + 1), segs: [{ v: w.m, color: 'var(--accent)' }], total: w.m, tip: 'Week of ' + fmtDate(w.ws) + ': ' + hm(w.m) + ' | ' + w.q + ' questions | ' + w.pg + ' pages' }));
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], sum = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
  ds.forEach(k => { const w = (parseD(k).getDay() + 6) % 7; cnt[w]++; sum[w] += (C.byDay[k] || {}).min || 0; });
  const wdItems = names.map((nm, i) => { const v = cnt[i] ? sum[i] / cnt[i] : 0; return { label: nm, segs: [{ v, color: 'var(--accent2)' }], total: v, tip: nm + ' average: ' + hm(v) }; });
  const hit = ds.filter(k => ((C.byDay[k] || {}).min || 0) >= st.dailyMin).length;
  let best = null; ds.forEach(k => { const m = (C.byDay[k] || {}).min || 0; if (m > 0 && (!best || m > best.m)) best = { k, m }; });
  const tw = weeks[11], lw = weeks[10], diff = tw.m - lw.m;
  let pb = 0, pd = 0; for (let i = 1; i <= 30; i++) { (S.plans[addDays(td, -i)] || []).forEach(it => { if (it.q > 0) { pb++; if (planDone(addDays(td, -i), it)) pd++; } }); }
  let tt = 0, tdn = 0; for (let i = 0; i <= 30; i++) { (S.todos[addDays(td, -i)] || []).forEach(t => { if (!t.moved) { tt++; if (t.done) tdn++; } }); }
  return '<h2 class="mt">Deeper analytics</h2><div class="tiles">' +
    tile('Goal reached', hit + ' / ' + n + ' days', 'at least ' + hm(st.dailyMin) + ' studied') +
    tile('Best day', best ? hm(best.m) : '-', best ? fmtDate(best.k) : 'no data') +
    tile('This week', hm(tw.m), (diff >= 0 ? '+' : '-') + hm(Math.abs(diff)) + ' vs last week') +
    tile('Blocks done (30 days)', pb ? pd + ' / ' + pb : '-', pb ? fmtPct(pd / pb) + ' of planned blocks' : 'no plans yet') +
    tile('Tasks done (30 days)', tt ? tdn + ' / ' + tt : '-', tt ? fmtPct(tdn / tt) : 'no tasks yet') + '</div>' +
    '<div class="grid g2 mt"><div class="card"><h2>Weekly study time</h2>' + barChart(wItems, { goal: st.dailyMin * 7, fmt: v => hm(v), h: 200 }) + '<p class="muted small">Last 12 weeks, Monday to Sunday. The line is your daily goal times seven.</p></div>' +
    '<div class="card"><h2>Which weekdays you study</h2>' + barChart(wdItems, { goal: st.dailyMin, fmt: v => hm(v), h: 200 }) + '<p class="muted small">Average minutes per weekday over the selected range.</p></div></div>' +
    '<div class="card mt scroll"><h2>Speed and time left, by subject</h2><div class="tiles">' + tile('Hours needed', hm(needH * 60), 'for all remaining questions at your speed' + (untimed ? ' (' + untimed + ' subjects have no timed logs yet)' : '')) +
    tile('Hours available', hm(availH * 60), 'until revision starts, at your daily goal') + tile('Verdict', needH <= availH ? 'On track' : 'Short by ' + hm((needH - availH) * 60), needH <= availH ? 'at current speeds' : 'speed up or add hours') + '</div>' +
    '<table class="mt"><thead><tr><th>Subject</th><th>Done</th><th>Time</th><th>Time share</th><th>Work left</th><th>Q/hour</th><th>Pages/hour</th><th>Hours left</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="muted small">Speed comes from logs where you entered minutes. Compare time share with work left to spot subjects you are neglecting.</p></div>';
}

function viewInsights(C) {
  const n = insightRange, ds = rangeDays(n), st = S.settings;
  const total = ds.reduce((a, k) => { const d = C.byDay[k] || { min: 0, pages: 0, q: 0 }; return { m: a.m + d.min, p: a.p + d.pages, q: a.q + d.q, days: a.days + (d.min > 0 || d.q > 0 || d.pages > 0 ? 1 : 0) }; }, { m: 0, p: 0, q: 0, days: 0 });
  let cp = 0, cq = 0; Object.keys(C.byDay).forEach(k => { if (k < ds[0]) { cp += C.byDay[k].pages; cq += C.byDay[k].q; } });
  const cumP = [], cumQ = []; ds.forEach(k => { const d = C.byDay[k]; if (d) { cp += d.pages; cq += d.q; } cumP.push(cp); cumQ.push(cq); });
  const dayP = ds.map(k => (C.byDay[k] || {}).pages || 0), dayQ = ds.map(k => (C.byDay[k] || {}).q || 0);
  const labels = ds.map(k => parseD(k).getDate() + '/' + (parseD(k).getMonth() + 1));
  const bySub = {}; ds.forEach(k => { const d = C.byDay[k]; if (d) Object.keys(d.subs).forEach(s => bySub[s] = (bySub[s] || 0) + d.subs[s]); });
  const subList = Object.keys(bySub).sort((a, b) => bySub[b] - bySub[a]), maxS = subList.length ? bySub[subList[0]] : 1;
  const planDays = Object.keys(S.plans).filter(k => S.plans[k].length && k <= today()).sort().reverse().slice(0, 7);
  const pva = planDays.map(k => {
    const items = S.plans[k], pq = items.reduce((a, i) => a + i.q, 0); let aq = 0; items.forEach(i => { aq += Math.min(planActual(k, i).q, i.q); });
    const pct = pq ? aq / pq : 0;
    return '<tr><td>' + fmtDate(k) + '</td><td>' + aq + ' / ' + pq + '</td><td style="min-width:120px">' + bar(pct, 'var(--accent2)') + '</td><td>' + fmtPct(pct) + '</td></tr>';
  }).join('');
  const legend = '<div class="legend"><span><i style="background:var(--accent)"></i>Questions</span><span><i style="background:var(--accent2)"></i>Pages</span></div>';
  return '<div class="page-head"><h1>Insights</h1><div class="chips">' + [14, 30, 90].map(v => '<button data-act="range" data-v="' + v + '" class="' + (v === n ? 'on' : '') + '">' + v + ' days</button>').join('') + '</div></div>' +
    '<div class="tiles">' + tile('Study time', hm(total.m), 'in range') + tile('Active days', total.days + ' / ' + n, '') + tile('Avg per day', hm(total.m / n), 'goal ' + hm(st.dailyMin)) + tile('Questions', total.q, Math.round(total.q / n) + ' per day') + tile('Pages', total.p, Math.round(total.p / n) + ' per day') + '</div>' +
    '<div class="card mt"><h2>Study time per day</h2>' + barChart(ds.map(k => dayItem(C, k)), { goal: st.dailyMin, fmt: v => hm(v) }) + '<div class="legend"><span><i style="background:var(--warn)"></i>Daily goal</span><span>Bars are coloured by subject. Hover for details.</span></div></div>' +
    '<div class="grid g2 mt"><div class="card"><h2>Questions and pages per day</h2>' + lineChart(labels, [{ name: 'Questions', color: 'var(--accent)', values: dayQ }, { name: 'Pages', color: 'var(--accent2)', values: dayP }]) + legend + '</div>' +
    '<div class="card"><h2>Cumulative work</h2>' + lineChart(labels, [{ name: 'Questions', color: 'var(--accent)', values: cumQ }, { name: 'Pages', color: 'var(--accent2)', values: cumP }]) + legend + '<p class="muted small">Counts every logged update, including repeats. Solved vs remaining on the dashboard counts each question once.</p></div></div>' +
    '<div class="grid g2 mt"><div class="card"><h2>Time by subject</h2>' + (subList.length ? subList.map(s => '<div class="hb"><span>' + esc(SUB[s].short) + '</span>' + bar(bySub[s] / maxS, subColor(SUB[s])) + '<span>' + hm(bySub[s]) + '</span></div>').join('') : '<p class="muted">No study time logged in this range.</p>') + '</div>' +
    '<div class="card"><h2>Consistency</h2>' + heatmap(C, 26) + '<div class="legend"><span><i style="background:var(--h0)"></i>none</span><span><i style="background:var(--h2)"></i>some</span><span><i style="background:var(--h4)"></i>goal reached</span></div></div></div>' +
    '<div class="card mt scroll"><h2>Plan vs actual</h2>' + (pva ? '<table><thead><tr><th>Day</th><th>Questions</th><th>Completion</th><th></th></tr></thead><tbody>' + pva + '</tbody></table>' : '<p class="muted">Once you plan a day and log work against it, the comparison appears here.</p>') + '</div>' + insightsExtra(C, ds);
}

function viewSettings() {
  const st = S.settings;
  return '<div class="page-head"><h1>Settings</h1></div><div class="grid g2">' +
    '<form id="set-form" class="card stack"><h2>Targets</h2><div class="form-grid">' +
    '<label>Exam date<input type="date" id="s-exam" value="' + st.examDate + '"></label>' +
    '<label>Daily study goal (minutes)<input type="number" id="s-min" min="30" value="' + st.dailyMin + '"></label>' +
    '<label>General Aptitude questions per day<input type="number" id="s-ga" min="0" value="' + st.dailyGA + '"></label>' +
    '<label>Subjects per day in plans<input type="number" id="s-blocks" min="1" max="6" value="' + st.blocks + '"></label>' +
    '<label>Revision buffer (days)<input type="number" id="s-rev" min="0" value="' + st.revisionDays + '"></label></div>' +
    '<p class="muted small">GATE 2027 (IIT Madras) runs on 6, 7, 13, 14, 20 and 21 February 2027, and dates are liable to change. The default is the first day; set it to your own paper\'s date once your admit card or the branch-wise schedule shows it.</p><div><button class="btn primary" type="submit">Save settings</button></div></form>' +
    '<div class="card stack"><h2>Sync and backup</h2><p class="muted small" id="sync-note">Status: ' + esc(sync.text || 'This device only') + '. With the Vercel function and Redis set up, your progress follows you across devices. Otherwise it stays in this browser.</p>' +
    '<div class="row"><button class="btn" data-act="sync-now">Sync now</button><button class="btn" data-act="export">Export backup (JSON)</button><label class="btn" style="cursor:pointer">Import backup<input type="file" id="import-file" accept="application/json" hidden></label></div>' +
    '<hr style="border:0;border-top:1px solid var(--line);width:100%"><button class="btn danger" data-act="reset">Erase all data</button></div></div>' +
    '<div class="card stack mt"><h2>Check my setup</h2><p class="muted small">Tests the Vercel function, the Redis storage, your login and a real write, and tells you what to fix if something is off. Run it after deploying.</p>' +
    '<div><button class="btn" data-act="diag">Run checks</button></div><div id="diag">' + DIAG + '</div></div>';
}

/* ================= setup check ================= */
async function fetchHealth(tok) {
  let lastErr = 'unreachable';
  const urls = ['/api/health', '/api/data?health=1'];
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], { cache: 'no-store', headers: { Authorization: 'Bearer ' + tok } });
      if (res.status === 429) return { blocked: true };
      const ct = res.headers.get('content-type') || '';
      if (ct.indexOf('json') < 0) { lastErr = res.status === 401 || res.status === 403 ? 'protected' : res.status === 404 ? 'missing' : 'notjson'; continue; }
      return { h: await res.json() };
    } catch (e) { lastErr = 'network'; }
  }
  return { err: lastErr };
}
let DIAG = '';
async function runDiag() {
  const show = h => { DIAG = h; const o = $('#diag'); if (o) o.innerHTML = h; };
  show('<span class="muted small">Checking...</span>');
  const rows = [], add = (st, title, detail) => rows.push({ st, title, detail });
  let store = true; try { localStorage.setItem('gt_probe', '1'); localStorage.removeItem('gt_probe'); } catch (e) { store = false; }
  add(store ? 'ok' : 'bad', 'Saving on this device', store ? 'Browser storage works.' : 'Browser storage is blocked (private mode or a strict setting). Progress will not be kept.');
  const r = await fetchHealth(sync.tok || '');
  if (r.blocked) add('bad', 'Too many wrong attempts', 'The server is blocking this network for 15 minutes after repeated wrong passwords. Wait and try again.');
  else if (r.err) {
    const why = { protected: 'Vercel is answering with a login page instead of the function. Turn off Deployment Protection for Production (Project -> Settings -> Deployment Protection), or use your production domain, not a preview link.',
      missing: 'The /api folder is not part of this deployment. Make sure the api/data.js file is in the repo root next to index.html, then redeploy.',
      notjson: 'The server answered, but not from the function. Check the deployment logs in Vercel.',
      network: 'Could not reach the server. You may be offline, or this page is not running on Vercel (for example opened as a file).' }[r.err] || 'No answer from the server.';
    add('bad', 'Sync function', why);
  } else {
    const h = r.h; add('ok', 'Sync function', 'Reachable' + (h.node ? ' (Node ' + esc(h.node) + ')' : '') + '.');
    add(h.storage.configured ? 'ok' : 'bad', 'Redis storage connected to the project', h.storage.configured ? 'Found variable ' + esc(h.storage.variable) + '.' : esc(h.storage.hint || 'Not configured.'));
    if (h.storage.configured) {
      add(h.storage.reachable ? 'ok' : 'bad', 'Redis answers', h.storage.reachable ? 'Connection works.' : esc(h.storage.hint || 'No answer.'));
      if (h.auth && h.auth.signedIn) add(h.storage.canWrite ? 'ok' : 'bad', 'Redis accepts writes', h.storage.canWrite ? 'A test write and read-back succeeded.' : esc(h.storage.hint || 'Write failed.'));
    }
    if (!(h.auth && h.auth.signedIn)) add('bad', 'Login', 'The server does not accept the saved login. If you changed APP_PASS or APP_USER, sign out and sign in again.');
    else {
      add(h.auth.defaultPassword ? 'warn' : 'ok', 'Password', h.auth.defaultPassword ? 'The server is still using the default password. Add APP_PASS (and optionally APP_USER) in Vercel -> Settings -> Environment Variables, then redeploy.' : 'A custom password is set on the server.');
      if (h.data) {
        const here = S.logs.length, there = h.data.logs;
        add(here === there && !sync.dirty ? 'ok' : 'warn', 'Data in the cloud', 'Cloud has ' + there + ' log entries (revision ' + h.data.rev + '); this device has ' + here + '.' + (here === there && !sync.dirty ? ' In sync.' : ' Press Sync now to reconcile.'));
      }
    }
    add(sync.mode === 'cloud' ? 'ok' : 'warn', 'This browser', sync.mode === 'cloud' ? 'Syncing with the cloud (' + esc(sync.text || '') + ').' : 'Currently ' + esc(sync.text || 'working locally') + '. Press Sync now once the problems above are fixed.');
  }
  const col = { ok: 'var(--accent2)', warn: 'var(--warn)', bad: 'var(--bad)' }, lab = { ok: 'OK', warn: 'Check', bad: 'Fix' };
  show(rows.map(x => '<div class="item"><span class="dot" style="--c:' + col[x.st] + '; margin-top:6px"></span><div class="grow"><b>' + x.title + '</b> <span class="muted small">' + lab[x.st] + '</span><div class="muted small">' + x.detail + '</div></div></div>').join(''));
}

/* ================= router / render ================= */
const view = $('#view');
function render() {
  const C = compute();
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.route === route));
  const left = diffDays(today(), S.settings.examDate);
  $('#countdown').textContent = left >= 0 ? left + ' days to exam' : 'Exam date passed';
  view.innerHTML = route === 'log' ? viewLog(C) : route === 'plan' ? viewPlan(C) : route === 'subjects' ? viewSubjects(C) : route === 'insights' ? viewInsights(C) : route === 'settings' ? viewSettings() : viewDashboard(C);
}
function go(r, arg) { location.hash = '#' + r + (arg ? '/' + arg : ''); }
function onHash() {
  const h = (location.hash || '#dashboard').slice(1).split('/');
  route = ['dashboard', 'log', 'plan', 'subjects', 'insights', 'settings'].indexOf(h[0]) >= 0 ? h[0] : 'dashboard';
  routeArg = h[1] || ''; if (route === 'subjects' && SUB[routeArg]) subjSel = routeArg;
  render(); try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
}

/* ================= form readers ================= */
function readLog() {
  if (!$('#f-date')) return;
  const mode = $('input[name="f-mode"]:checked');
  LOG.date = $('#f-date').value || today(); LOG.sid = $('#f-sid').value; LOG.mode = mode ? mode.value : LOG.mode;
  LOG.from = $('#f-from').value; LOG.to = $('#f-to').value; LOG.min = $('#f-min').value; LOG.note = $('#f-note').value;
}
function readPlanForm() { if ($('#p-sid')) PLAN.form = { sid: $('#p-sid').value, q: $('#p-q').value, pages: $('#p-pages').value, min: $('#p-min').value }; }

/* ================= events ================= */
view.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  if (t.tagName === 'INPUT') return;
  if (act === 'open-subject') { subjSel = id; go('subjects', id); }
  else if (act === 'pick-subject') { subjSel = id; render(); }
  else if (act === 'prog') { progMetric = t.dataset.v; render(); }
  else if (act === 'add-min') { readLog(); LOG.min = num(LOG.min) + num(t.dataset.v); render(); }
  else if (act === 'continue') { readLog(); const r = compute().subs[LOG.sid]; LOG.from = String(LOG.mode === 'q' ? r.nextQnum : r.nextPage); LOG.to = ''; render(); }
  else if (act === 'cancel-edit') { LOG = blankLog(); render(); }
  else if (act === 'edit-log') {
    const l = S.logs.find(x => x.id === id); if (!l) return;
    LOG = { id: l.id, date: l.date, sid: l.sid, mode: l.mode, from: String(l.from), to: String(l.to), min: l.min || '', note: l.note || '' };
    render(); try { window.scrollTo(0, 0); } catch (err) { /* ignore */ }
  }
  else if (act === 'del-log') {
    if (!confirm('Delete this entry?')) return;
    S.logs = S.logs.filter(x => x.id !== id); S.deleted.push(id); save(); if (LOG.id === id) LOG = blankLog(); render(); toast('Entry deleted');
  }
  else if (act === 'range') { insightRange = +t.dataset.v; render(); }
  else if (act === 'diag') { runDiag(); }
  else if (act === 'plan-prev') { PLAN.date = addDays(PLAN.date, -1); render(); }
  else if (act === 'plan-next') { PLAN.date = addDays(PLAN.date, 1); render(); }
  else if (act === 'plan-tomorrow') { PLAN.date = addDays(today(), 1); render(); }
  else if (act === 'plan-gen') {
    if ((S.plans[PLAN.date] || []).length && !confirm('Replace the existing plan for this day?')) return;
    const items = suggest(PLAN.date); S.plans[PLAN.date] = items; save(); render(); toast(items.length ? 'Plan ready' : 'Everything is complete');
  }
  else if (act === 'plan-clear') { if (!confirm('Clear this day\'s plan?')) return; delete S.plans[PLAN.date]; save(); render(); }
  else if (act === 'plan-del') { S.plans[PLAN.date] = (S.plans[PLAN.date] || []).filter(x => x.id !== id); save(); render(); }
  else if (act === 'plan-log') {
    const it = (S.plans[PLAN.date] || []).find(x => x.id === id); if (!it) return;
    const r = compute().subs[it.sid], a = planActual(PLAN.date, it), left = Math.max(1, it.q - a.q);
    LOG = blankLog(); LOG.date = PLAN.date <= today() ? PLAN.date : today(); LOG.sid = it.sid; LOG.mode = 'q';
    LOG.from = String(r.nextQnum); LOG.to = String(Math.min(r.sub.questions, r.nextQnum + left - 1)); LOG.min = Math.max(0, it.min - a.m) || '';
    go('log');
  }
  else if (act === 'topic-log') {
    const r = compute().subs[subjSel]; LOG = blankLog(); LOG.sid = subjSel; LOG.mode = 'q';
    const ti = +t.dataset.ti;
    if (ti >= 0 && r.topics[ti]) { const tp = r.topics[ti], g = firstGap(r.qM, tp.qs, tp.qe); LOG.from = String(Math.floor((g >= tp.qe - 0.05 ? tp.qs : g) + EPS) + 1); LOG.to = String(Math.round(tp.qe)); }
    go('log');
  }
  else if (act === 'edit-open') { openEdit(subjSel); render(); }
  else if (act === 'edit-cancel') { EDIT = null; render(); }
  else if (act === 'edit-add') { readEdit(); const l = EDIT.topics[EDIT.topics.length - 1]; EDIT.topics.push({ n: 'New topic', q: 1, s: l ? l.s : 1 }); render(); }
  else if (act === 'edit-rm') { readEdit(); if (EDIT.topics.length > 1) EDIT.topics.pop(); render(); }
  else if (act === 'edit-reset') {
    if (!confirm('Reset pages, topics and question counts for this book to the PDF defaults?')) return;
    delete S.edits[subjSel]; delete S.pageStart[subjSel]; EDIT = null; applyEdits(); save(); render(); toast('Reset to PDF defaults');
  }
  else if (act === 'carry-all') { carryAll(t.dataset.to); save(); render(); toast('Carried over'); }
  else if (act === 'carry-block') { carryBlock(t.dataset.to, t.dataset.day, id); save(); render(); }
  else if (act === 'carry-todo') { carryTodo(t.dataset.to, t.dataset.day, id); save(); render(); }
  else if (act === 'todo-del') { S.todos[t.dataset.day] = (S.todos[t.dataset.day] || []).filter(x => x.id !== id); save(); render(); }
  else if (act === 'reset-pages') { if (!confirm('Reset all page starts for this subject to the PDF defaults?')) return; delete S.pageStart[subjSel]; save(); render(); }
  else if (act === 'sync-now') { pull().then(() => { const n = $('#sync-note'); if (n) n.textContent = 'Status: ' + (sync.text || ''); }); }
  else if (act === 'export') {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'gate-tracker-backup-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Backup downloaded');
  }
  else if (act === 'reset') {
    if (prompt('This erases every log, plan and setting (on all synced devices). Type ERASE to confirm.') !== 'ERASE') return;
    const th = S.settings.theme; S = defaults(); S.settings.theme = th; save(); LOG = blankLog(); render(); toast('All data erased');
  }
});
view.addEventListener('click', e => { const a = e.target.closest('[data-plan-date]'); if (a) PLAN.date = a.dataset.planDate; });

view.addEventListener('input', e => {
  if (e.target.closest && e.target.closest('#log-form') && /^f-(from|to|min|note)$/.test(e.target.id)) {
    readLog(); const p = $('#preview'); if (p) p.innerHTML = previewLog(LOG);
  }
});
view.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'dash-sort') { dashSort = t.value; render(); }
  else if (t.id === 'f-sid') { readLog(); LOG.from = ''; LOG.to = ''; render(); }
  else if (t.id === 'f-date') { readLog(); render(); }
  else if (t.name === 'f-mode') { readLog(); LOG.from = ''; LOG.to = ''; render(); }
  else if (t.id === 'p-sid') { readPlanForm(); render(); }
  else if (t.id === 'plan-date') { if (t.value) { PLAN.date = t.value; render(); } }
  else if (t.dataset && t.dataset.act === 'page-start') {
    const ti = +t.dataset.ti, sub = SUB[subjSel]; S.pageStart[subjSel] = S.pageStart[subjSel] || {};
    if (t.value === '') delete S.pageStart[subjSel][ti]; else S.pageStart[subjSel][ti] = clamp(Math.round(+t.value) || 1, 1, sub.pages);
    save(); render();
  }
  else if (t.dataset && t.dataset.act === 'todo-toggle') {
    const it = (S.todos[t.dataset.day] || []).find(x => x.id === t.dataset.id); if (it) { it.done = t.checked; save(); render(); }
  }
  else if (t.dataset && t.dataset.act === 'topic-toggle') {
    const ti = +t.dataset.ti; S.topicDone[subjSel] = S.topicDone[subjSel] || {};
    if (t.checked) S.topicDone[subjSel][ti] = true; else delete S.topicDone[subjSel][ti];
    save(); render();
  }
  else if (t.id === 'import-file') {
    const f = t.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => {
      try {
        const j = JSON.parse(rd.result);
        if (!j || !Array.isArray(j.logs)) throw new Error('bad');
        if (j.v !== 2) { toast('This backup is from an older version and cannot be imported'); return; }
        if (!confirm('Replace your current data with this backup (' + j.logs.length + ' entries)?')) return;
        S = normalize(j); save(); applyTheme(); render(); toast('Backup imported');
      } catch (err) { toast('That file is not a valid backup'); }
    };
    rd.readAsText(f);
  }
});
view.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'log-form') {
    readLog();
    const sub = SUB[LOG.sid], max = LOG.mode === 'q' ? sub.questions : sub.pages, word = LOG.mode === 'q' ? 'Question' : 'Page';
    let a = parseInt(LOG.from, 10), b = LOG.to === '' ? a : parseInt(LOG.to, 10);
    if (!(a >= 1)) { toast('Enter where you started'); return; }
    if (!(b >= 1)) b = a; if (b < a) { const x = a; a = b; b = x; }
    if (a > max || b > max) { toast(word + ' numbers for this book run from 1 to ' + max); return; }
    if (LOG.date > today()) { toast('Date cannot be in the future'); return; }
    const entry = { id: LOG.id || uid(), date: LOG.date, sid: LOG.sid, mode: LOG.mode, from: a, to: b, min: num(LOG.min), note: LOG.note.trim() };
    if (LOG.id) S.logs = S.logs.map(l => l.id === LOG.id ? entry : l); else S.logs.push(entry);
    const was = !!LOG.id; save(); LOG = Object.assign(blankLog(), { date: LOG.date, sid: LOG.sid, mode: LOG.mode }); render(); toast(was ? 'Entry updated' : 'Saved. Nice work.');
  }
  else if (e.target.id === 'edit-form') { saveEdit(); }
  else if (e.target.id === 'todo-form') {
    const tx = $('#t-text').value.trim(); if (!tx) return;
    (S.todos[PLAN.date] = S.todos[PLAN.date] || []).push({ id: uid(), text: tx, done: false }); save(); render();
  }
  else if (e.target.id === 'plan-form') {
    readPlanForm(); const f = PLAN.form;
    if (!num(f.q) && !num(f.pages) && !num(f.min)) { toast('Enter a target'); return; }
    (S.plans[PLAN.date] = S.plans[PLAN.date] || []).push({ id: uid(), sid: f.sid, q: num(f.q), pages: num(f.pages), min: num(f.min) });
    PLAN.form = { sid: f.sid, q: '', pages: '', min: '' }; save(); render(); toast('Block added');
  }
  else if (e.target.id === 'set-form') {
    const st = S.settings;
    st.examDate = $('#s-exam').value || st.examDate; st.dailyMin = Math.max(30, num($('#s-min').value) || 360);
    st.dailyGA = num($('#s-ga').value); st.blocks = clamp(num($('#s-blocks').value) || 3, 1, 6); st.revisionDays = num($('#s-rev').value);
    save(); render(); toast('Settings saved');
  }
});

view.addEventListener('input', e => {
  if (e.target && e.target.id === 'finder') { FIND = e.target.value; const o = $('#finder-out'); if (o) o.innerHTML = finderResults(SUB[subjSel], FIND); }
});

/* ================= theme + auth ================= */
function applyTheme() { document.documentElement.setAttribute('data-theme', S.settings.theme === 'light' ? 'light' : 'dark'); }
$('#theme-btn').addEventListener('click', () => { S.settings.theme = S.settings.theme === 'light' ? 'dark' : 'light'; save(); applyTheme(); render(); });
$('#sync').addEventListener('click', () => { if (sync.tok) pull(); });

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
function doLogout() {
  try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  sync.tok = null; location.hash = ''; location.reload();
}
function showApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  window.addEventListener('hashchange', onHash); onHash();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sync.tok && !sync.dirty) pull(); });
  window.addEventListener('online', () => { if (sync.tok) pull(); });
  window.addEventListener('pagehide', () => { if (sync.mode === 'cloud' && sync.dirty) push(); });
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#login-form button[type=submit]'); btn.disabled = true;
  const tok = btoa($('#lu').value.trim().toLowerCase() + ':' + $('#lp').value);
  const r = await apiCall('GET', tok);
  btn.disabled = false;
  const ok = r.status === 'ok' || r.status === 'nostore' || ((r.status === 'offline') && tok === LOCAL_AUTH);
  if (!ok) {
    $('#login-err').hidden = false;
    const c = $('#login-form'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); return;
  }
  try { ($('#lk').checked ? localStorage : sessionStorage).setItem(TOKEN_KEY, tok); } catch (err) { /* ignore */ }
  $('#login-err').hidden = true; sync.tok = tok; showApp(); pull();
});
$('#logout-btn').addEventListener('click', doLogout);

applyTheme();
setStatus('This device only', 'warn');
const tok0 = getToken();
if (tok0) { sync.tok = tok0; showApp(); pull(); }

if (window.__GT_TEST__) window.__GT = { applyEdits, overdueBlocks, overdueTodos, carryAll, saveEdit, openEdit, compute, previewLog, buildMap, p2q, q2p, logIv, mergeStates, normalize, suggest, getS: () => S, setS: v => { S = v; }, sync, pull, push, logCounts, planActual, exactFor, qinfo, finderResults };
})();
