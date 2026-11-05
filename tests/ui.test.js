const { boot } = require('./harness');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = boot(null, { storage: { gt_auth: 'YXJjaGVyOnBhc3N3b3Jk' } }); const w = dom.window, d = w.document, G = w.__GT; await wait(80);
  const go = r => { w.location.hash = '#' + r; w.dispatchEvent(new w.HashChangeEvent('hashchange')); };
  const ev = (el, t, o = {}) => el.dispatchEvent(new w.Event(t, { bubbles: true, cancelable: true, ...o }));
  go('log');
  d.querySelector('#f-sid').value = 'os'; ev(d.querySelector('#f-sid'), 'change');
  d.querySelector('input[name="f-mode"][value="p"]').checked = true; ev(d.querySelector('input[name="f-mode"][value="p"]'), 'change');
  d.querySelector('#f-from').value = '9'; d.querySelector('#f-to').value = '33'; ev(d.querySelector('#f-from'), 'input');
  const pv = d.querySelector('#preview').textContent;
  ok(/Processes, Context Switch and System Calls/.test(pv) && /21 questions/.test(pv) && /whole topic/.test(pv), 'live preview: OS pages 9-33 = topic 1, 21 questions :: ' + pv.slice(0, 200));
  ok(!/about/.test(pv), 'no "about" wording');
  d.querySelector('#f-min').value = '50'; ev(d.querySelector('#log-form'), 'submit');
  await wait(50);
  const S = G.getS(); ok(S.logs.length === 1 && S.logs[0].sid === 'os' && S.logs[0].from === 9 && S.logs[0].to === 33, 'log saved');
  let C = G.compute(); ok(Math.abs(C.subs.os.qDone - 21) < 1e-6 && C.subs.os.topicsDone === 1, 'OS: 21 questions, 1 topic done');
  // history line is exact (no "about")
  go('log'); const hist = d.querySelector('#view').textContent; ok(/Operating Systems/.test(hist) && /p9-33 \(Q1-21\)/.test(hist), 'history: p9-33 (Q1-21) :: ' + (hist.match(/p9-33[^]{0,30}/) || [''])[0]);
  // next gap after that log
  go('subjects/os'); const sv = d.querySelector('#view').textContent;
  ok(/First gap: Q22 \/ page 34 \(/.test(sv), 'subjects: first gap Q22 / page 34 with exam name :: ' + (sv.match(/First gap[^.]*/) || [''])[0]);
  ok(d.querySelectorAll('input.pg').length === 0 && /9.33/.test(sv), 'exact mode: page starts are fixed text, not inputs');
  ok(/Find a question/.test(sv), 'finder present');
  const fi = d.querySelector('#finder'); fi.value = '2013 q'; ev(fi, 'input');
  ok(/GATE CSE 2013/.test(d.querySelector('#finder-out').textContent), 'finder typing updates results');
  // edit numbers -> estimates, inputs return
  const sub = w.eval("SUBJECTS.find(s=>s.id==='os')"); S.edits.os = { pages: sub.pages + 1, questions: sub.questions, topics: sub.topics.map(t => ({ n: t.n, q: t.q, s: t.s })) };
  go('subjects/os'); const sv2 = d.querySelector('#view'); ok(sv2.querySelectorAll('input.pg').length === 14 && !/Find a question/.test(sv2.textContent), 'edited book: page inputs return, finder hidden');
  delete S.edits.os; go('subjects/os');
  // GA exact (no topics)
  const ga = G.compute().subs.ga; ok(ga.map.exact && ga.nextPage === 8, 'GA exact: first question is on page 8 (' + ga.nextPage + ')');
  go('log'); d.querySelector('#f-sid').value = 'ga'; ev(d.querySelector('#f-sid'), 'change'); d.querySelector('input[name="f-mode"][value="q"]').checked = true; ev(d.querySelector('input[name="f-mode"][value="q"]'), 'change');
  d.querySelector('#f-from').value = '1'; d.querySelector('#f-to').value = '5'; ev(d.querySelector('#f-from'), 'input');
  ok(/GATE/.test(d.querySelector('#preview').textContent) && /Q1-5/.test(d.querySelector('#preview').textContent), 'GA preview lists exam names :: ' + d.querySelector('#preview').textContent.slice(0, 160));
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
