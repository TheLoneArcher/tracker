const { boot } = require('./harness');
const dom = boot(); const w = dom.window, G = w.__GT; const S0 = w.eval('SUBJECTS');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
G.setS(G.normalize(null));
G.applyEdits();
let nTopics = 0;
S0.forEach(sub => {
  ok(G.exactFor(sub), sub.id + ' exact available');
  const m = G.buildMap(sub), Q = sub.questions, P = sub.pages;
  ok(m.exact && m.B.length === Q + 1, sub.id + ' bounds length');
  let mono = true; for (let k = 0; k < Q; k++) if (!(m.B[k + 1] > m.B[k])) { mono = false; break; }
  ok(mono, sub.id + ' bounds strictly increasing');
  ok(m.B[Q] === P && m.B[0] >= 0, sub.id + ' bounds in range');
  let rt = true; for (let k = 0; k <= Q; k++) { const back = G.p2q(m, G.q2p(m, k)); if (Math.abs(back - k) > 1e-6) { rt = false; console.log(sub.id, 'rt', k, back); break; } }
  ok(rt, sub.id + ' q->p->q round trip at every question boundary');
  // each question's own page is within [floor(edge)+1 ..]
  const qd = w.eval('QD')[sub.id]; let pageOK = true;
  for (let k = 0; k < Q; k++) { const a = m.B[k], b = m.B[k + 1]; if (!(qd.p[k] - 1 >= Math.floor(a) && qd.p[k] - 1 < Math.ceil(b) + 1e-9)) pageOK = false; }
  ok(pageOK, sub.id + ' every question page lies inside its span');
  // topic-by-topic: logging a topic's own pages == that topic's question count
  const logs = [];
  const tops = sub.topics.map((t, i) => ({ p0: t.s, p1: i + 1 < sub.topics.length ? sub.topics[i + 1].s - 1 : P, q: t.q }));
  tops.forEach((t, ti) => {
    if (!sub.topics.length) return; nTopics++;
    const iv = G.logIv(m, sub, { mode: 'p', from: t.p0, to: t.p1 });
    ok(Math.abs((iv.qb - iv.qa) - t.q) < 1e-6 && Math.abs(iv.qa - m[ti].qs) < 1e-6, sub.id + ' topic ' + (ti + 1) + ' pages->questions ' + (iv.qb - iv.qa) + ' vs ' + t.q);
    const iq = G.logIv(m, sub, { mode: 'q', from: m[ti].qs + 1, to: m[ti].qe });
    ok(Math.abs(iq.pa - (t.p0 - 1)) < 1e-6 && Math.abs(iq.pb - t.p1) < 1e-6, sub.id + ' topic ' + (ti + 1) + ' questions->pages ' + iq.pa + '-' + iq.pb + ' vs ' + t.p0 + '-' + t.p1);
  });
  // whole book by pages 1..P counts all questions
  const iv = G.logIv(m, sub, { mode: 'p', from: 1, to: P }); ok(Math.abs(iv.qb - iv.qa - Q) < 1e-6 || Math.abs(iv.qb - Q) < 1e-6, sub.id + ' whole book by pages');
});
console.log('topics checked', nTopics);

// spot checks against the directory text
const algo = S0.find(s => s.id === 'algo'), ma = G.buildMap(algo);
let iv = G.logIv(ma, algo, { mode: 'p', from: 42, to: 43 }); ok(Math.abs(iv.qa - 16) < 1e-9 && Math.abs(iv.qb - 17) < 1e-9, 'algo pages 42-43 == Q17');
ok(G.qinfo(algo, 16).src === 'GATE CSE 2026 Set 2 Q14' && G.qinfo(algo, 16).page === 42, 'qinfo Q17');
ok(G.qinfo(algo, 351) === null, 'qinfo out of range');
let html = G.previewLog({ id: null, sid: 'algo', mode: 'q', from: '17', to: '19' });
ok(/GATE CSE 2026 Set 2 Q14/.test(html) && /GATE IT 2008 Q10/.test(html) && !/about/.test(html), 'preview shows sources, no "about"');
ok(/page 42/.test(html), 'preview shows page');

// shared pages (data structures has runs of 3 on one page)
const ds = S0.find(s => s.id === 'ds'), md = G.buildMap(ds);
let cnt = 0, run = 0; for (let k = 0; k < ds.questions; k++) { if (G.qinfo(ds, k).page === G.qinfo(ds, k - 1 < 0 ? 0 : k - 1).page && k) run++; }
ok(run > 50, 'ds has many shared-page questions (' + run + ')');
// log one shared page: counts as the questions on it (fraction of 1 page)
const pg = G.qinfo(ds, 100).page; const qs = []; for (let k = 0; k < ds.questions; k++) if (G.qinfo(ds, k).page === pg) qs.push(k);
iv = G.logIv(md, ds, { mode: 'p', from: pg, to: pg }); ok(Math.abs((iv.qb - iv.qa) - qs.length) < 1e-6 || (iv.qb - iv.qa) > 0, 'ds single shared page yields >0 questions (' + (iv.qb - iv.qa) + ' for ' + qs.length + ' on the page)');

// compute() with a book fully logged by questions
const S = G.getS(); S.logs.push({ id: 'a', date: '2026-11-01', sid: 'toc', mode: 'q', from: 1, to: 293, min: 60, note: '' });
let C = G.compute(); ok(Math.abs(C.subs.toc.qDone - 293) < 1e-6 && Math.abs(C.subs.toc.pagesDone - (487 - C.subs.toc.map[0].ps)) < 1e-6, 'toc full questions ' + C.subs.toc.qDone + ' pages ' + C.subs.toc.pagesDone);
ok(C.subs.toc.finished && C.subs.toc.topicsDone === 13, 'toc finished, 13 topics');
// repeated/overlapping logs not double-counted
S.logs.push({ id: 'b', date: '2026-11-02', sid: 'toc', mode: 'p', from: 100, to: 200, min: 30, note: '' }); C = G.compute(); ok(Math.abs(C.subs.toc.qDone - 293) < 1e-6, 'overlap not double counted');

// editing a book falls back to estimates without crashing
S.edits.algo = { pages: 800, questions: 351, topics: S0.find(s => s.id === 'algo').topics.map(t => ({ n: t.n, q: t.q, s: t.s })) };
C = G.compute(); ok(!G.exactFor(S0.find(s => s.id === 'algo')) && !C.subs.algo.map.exact, 'edited book drops exact mode');
delete S.edits.algo; C = G.compute(); ok(C.subs.algo.map.exact, 'reset restores exact mode');

// finder
const fr = G.finderResults(algo, '2013 q31'); ok(/GATE CSE 2013 Q31/.test(fr) && /page 48/.test(fr), 'finder finds 2013 Q31');
ok(/No question/.test(G.finderResults(algo, 'zzzzzz')), 'finder no hits');

// render each tab without throwing
['dashboard', 'log', 'plan', 'subjects', 'insights', 'settings'].forEach(r => { try { w.location.hash = '#' + r; w.dispatchEvent(new w.HashChangeEvent('hashchange')); } catch (e) { ok(false, 'route ' + r + ' ' + e.message); } });
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
