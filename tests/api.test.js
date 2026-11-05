const { boot, ROOT } = require('./harness');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const b64 = s => Buffer.from(s).toString('base64');

/* Fake Upstash REST: POST <url> with a JSON command array */
function fakeRedis(opts = {}) {
  const kv = new Map(), calls = []; let readonly = !!opts.readonly;
  const fetchFn = async (url, init) => {
    const cmd = JSON.parse(init.body); calls.push(cmd[0]);
    if (init.headers.Authorization !== 'Bearer tok') return { ok: false, status: 401, json: async () => ({ error: 'bad token' }) };
    const [c, ...a] = cmd; let r;
    const write = () => { if (readonly) throw new Error('NOPERM'); };
    try {
      switch (c) {
        case 'PING': r = 'PONG'; break;
        case 'GET': r = kv.has(a[0]) ? kv.get(a[0]) : null; break;
        case 'MGET': r = a.map(k => kv.has(k) ? kv.get(k) : null); break;
        case 'SET': write(); if (a.includes('NX') && kv.has(a[0])) { r = null; break; } kv.set(a[0], String(a[1])); r = 'OK'; break;
        case 'INCR': write(); kv.set(a[0], String((parseInt(kv.get(a[0]), 10) || 0) + 1)); r = parseInt(kv.get(a[0]), 10); break;
        case 'EXPIRE': r = 1; break;
        case 'EVAL': { write(); const [script, nk, k1, k2, base, payload] = a; if (!/compare/.test('compare') || !script.includes("redis.call('SET', KEYS[2], ARGV[2])")) throw new Error('unexpected script');
          const rev = parseInt(kv.get(k1), 10) || 0; if (rev !== parseInt(base, 10)) { r = [0, rev]; break; } kv.set(k2, payload); kv.set(k1, String(rev + 1)); r = [1, rev + 1]; break; }
        default: throw new Error('unsupported ' + c);
      }
    } catch (e) { return { ok: true, status: 200, json: async () => ({ error: e.message }) }; }
    return { ok: true, status: 200, json: async () => ({ result: r }) };
  };
  return { kv, calls, fetchFn, setReadonly: v => { readonly = v; } };
}
function loadHandler(env, redis) {
  Object.keys(process.env).filter(k => /REST|APP_|KV_|UPSTASH/.test(k)).forEach(k => delete process.env[k]);
  Object.assign(process.env, env);
  global.fetch = redis ? redis.fetchFn : async () => { throw new Error('no network'); };
  delete require.cache[require.resolve(ROOT + '/api/data.js')];
  return require(ROOT + '/api/data.js');
}
async function call(h, { method = 'GET', url = '/api/data', auth, body, ip = '1.1.1.1' } = {}) {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = s; } };
  const req = { method, url, headers: { 'x-forwarded-for': ip }, body };
  if (auth) req.headers.authorization = 'Bearer ' + b64(auth);
  await h(req, res); return { code: res.statusCode, json: JSON.parse(res.body || '{}'), headers: res.headers };
}
const ENV = { UPSTASH_REDIS_REST_URL: 'https://r.test', UPSTASH_REDIS_REST_TOKEN: 'tok' };
const st = n => ({ v: 2, logs: Array.from({ length: n }, (_, i) => ({ id: 'l' + i })), settings: {} });

(async () => {
  // --- storage not configured
  let h = loadHandler({}, null);
  let r = await call(h, { auth: 'archer:password' }); ok(r.code === 503, 'no redis -> 503 ' + r.code);
  r = await call(h, { url: '/api/health' }); ok(r.code === 200 && r.json.storage.configured === false && r.json.ok === false && /Storage/.test(r.json.storage.hint), 'health: not configured');
  r = await call(h, { auth: 'archer:nope' }); ok(r.code === 401, 'wrong pass 401');

  // --- configured, default creds
  let R = fakeRedis(); h = loadHandler(ENV, R);
  r = await call(h); ok(r.code === 401, 'no creds 401');
  r = await call(h, { auth: 'archer:password' }); ok(r.code === 200 && r.json.rev === 0 && r.json.state === null, 'empty GET');
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 0, state: st(2) } }); ok(r.code === 200 && r.json.rev === 1, 'first PUT rev 1');
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 0, state: st(3) } }); ok(r.code === 409 && r.json.rev === 1 && r.json.state.logs.length === 2, 'stale PUT -> 409 with current copy');
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 1, state: st(3) } }); ok(r.code === 200 && r.json.rev === 2, 'PUT rev 2');
  r = await call(h, { auth: 'archer:password' }); ok(r.json.rev === 2 && r.json.state.logs.length === 3, 'GET after PUT');
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 2, state: 'x' } }); ok(r.code === 400, 'bad body 400');
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: JSON.stringify({ baseRev: 2, state: st(1) }) }); ok(r.code === 200, 'string body parsed');
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 3, state: { v: 2, logs: [], pad: 'x'.repeat(950 * 1024) } } }); ok(r.code === 413, 'oversize 413');
  r = await call(h, { method: 'DELETE', auth: 'archer:password' }); ok(r.code === 405, '405');

  // --- atomicity: two writers with the same base revision, exactly one wins
  R = fakeRedis(); h = loadHandler(ENV, R);
  const [a, b] = await Promise.all([call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 0, state: st(1) } }), call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 0, state: st(5) } })]);
  ok([a.code, b.code].sort().join() === '200,409', 'concurrent PUTs: one 200, one 409 (' + a.code + ',' + b.code + ')');

  // --- health
  r = await call(h, { url: '/api/health' }); ok(r.json.storage.configured && r.json.storage.reachable === true && r.json.auth.signedIn === false && r.json.storage.canWrite === null && !('data' in r.json), 'health anonymous: connection only, no data leaked');
  r = await call(h, { url: '/api/health', auth: 'archer:password' }); ok(r.json.ok && r.json.storage.canWrite === true && r.json.auth.defaultPassword === true && r.json.data.logs >= 1, 'health authed: write test + default-password flag');
  r = await call(h, { url: '/api/data?health=1', auth: 'archer:password' }); ok(r.json.storage.canWrite === true, 'health via query string');
  R.setReadonly(true); r = await call(h, { url: '/api/health', auth: 'archer:password' }); ok(r.json.ok === false && r.json.storage.canWrite === false && /write/.test(r.json.storage.hint), 'health detects read-only token'); R.setReadonly(false);

  // --- custom password
  h = loadHandler({ ...ENV, APP_USER: 'Usha', APP_PASS: 'S3cret!pass' }, R);
  r = await call(h, { auth: 'archer:password' }); ok(r.code === 401, 'default password rejected once APP_PASS set');
  r = await call(h, { auth: 'usha:S3cret!pass' }); ok(r.code === 200, 'custom creds accepted (user case-insensitive)');
  r = await call(h, { url: '/api/health', auth: 'usha:S3cret!pass' }); ok(r.json.auth.defaultPassword === false, 'health: custom password flagged OK');

  // --- brute-force limiter
  R = fakeRedis(); h = loadHandler(ENV, R); let last;
  for (let i = 0; i < 10; i++) last = await call(h, { auth: 'archer:guess' + i, ip: '9.9.9.9' });
  ok(last.code === 401, '10 wrong -> still 401');
  r = await call(h, { auth: 'archer:password', ip: '9.9.9.9' }); ok(r.code === 429 && r.headers['Retry-After'], 'then even the right password is refused (429) from that IP');
  r = await call(h, { auth: 'archer:password', ip: '8.8.8.8' }); ok(r.code === 200, 'a different IP is unaffected');

  // --- migration from the older single-key format
  R = fakeRedis(); R.kv.set('gate-tracker:state', JSON.stringify({ rev: 7, state: st(4) })); h = loadHandler(ENV, R);
  r = await call(h, { auth: 'archer:password' }); ok(r.json.rev === 7 && r.json.state.logs.length === 4, 'old-format data migrated on read');
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 7, state: st(5) } }); ok(r.code === 200 && r.json.rev === 8, 'write after migration works');
  R = fakeRedis(); R.kv.set('gate-tracker:state', JSON.stringify({ rev: 3, state: st(2) })); h = loadHandler(ENV, R);
  r = await call(h, { method: 'PUT', auth: 'archer:password', body: { baseRev: 0, state: st(9) } }); ok(r.code === 409 && r.json.rev === 3, 'fresh device with old data on the server gets a 409 + the migrated copy (no overwrite)');

  // --- env var naming
  R = fakeRedis(); h = loadHandler({ KV_REST_API_URL: 'https://r.test', KV_REST_API_TOKEN: 'tok' }, R); r = await call(h, { url: '/api/health' }); ok(r.json.storage.configured && r.json.storage.variable === 'KV_REST_API_URL', 'KV_* names');
  h = loadHandler({ STORAGE_KV_REST_API_URL: 'https://r.test', STORAGE_KV_REST_API_TOKEN: 'tok', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro' }, R); r = await call(h, { url: '/api/health', auth: 'archer:password' }); ok(r.json.storage.configured && r.json.storage.canWrite === true, 'prefixed names, read-only token ignored');
  h = loadHandler({ KV_REST_API_URL: 'https://r.test' }, R); r = await call(h, { url: '/api/health' }); ok(r.json.storage.configured === false, 'URL without token -> not configured');

  // ===== end to end: two jsdom "devices" through the real function =====
  R = fakeRedis(); h = loadHandler(ENV, R);
  const api = async (url, init) => {
    const u = new URL(url, 'https://app.test'); const method = init.method || 'GET'; let body; if (init.body) body = JSON.parse(init.body);
    const res = await call(h, { method, url: u.pathname + u.search, auth: Buffer.from((init.headers.Authorization || '').replace('Bearer ', ''), 'base64').toString(), body });
    return { ok: res.code < 400, status: res.code, headers: { get: () => 'application/json' }, json: async () => res.json };
  };
  const login = async (dom, user, pass) => { const d = dom.window.document; d.querySelector('#lu').value = user; d.querySelector('#lp').value = pass; d.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await new Promise(r => setTimeout(r, 800)); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const A = boot(api), B = boot(api);
  await login(A, 'archer', 'wrong'); ok(!A.window.document.querySelector('#login-err').hidden && A.window.document.querySelector('#app').hidden, 'UI: wrong password rejected');
  await login(A, 'archer', 'password'); await wait(100); ok(!A.window.document.querySelector('#app').hidden, 'UI: signed in');
  ok(A.window.document.querySelector('#sync').textContent === 'Synced', 'UI: chip says Synced (' + A.window.document.querySelector('#sync').textContent + ')');
  const GA = A.window.__GT; GA.getS().logs.push({ id: 'x1', date: '2026-11-04', sid: 'algo', mode: 'p', from: 9, to: 40, min: 45, note: 'from A' });
  A.window.location.hash = '#settings'; A.window.dispatchEvent(new A.window.HashChangeEvent('hashchange'));
  A.window.document.querySelector('[data-act=sync-now]'); // exists
  // save via the app's own save(): trigger through a settings submit
  A.window.document.querySelector('#set-form').dispatchEvent(new A.window.Event('submit', { cancelable: true, bubbles: true })); await wait(1200);
  ok(R.kv.get('gate-tracker:v3:rev') && JSON.parse(R.kv.get('gate-tracker:v3:state')).logs.some(l => l.id === 'x1'), 'UI: save reached Redis');
  await login(B, 'archer', 'password'); await wait(150);
  ok(B.window.__GT.getS().logs.some(l => l.id === 'x1'), 'second device pulled the entry');
  // diagnostics panel
  B.window.location.hash = '#settings'; B.window.dispatchEvent(new B.window.HashChangeEvent('hashchange'));
  B.window.document.querySelector('[data-act=diag]').dispatchEvent(new B.window.MouseEvent('click', { bubbles: true })); await wait(300);
  const dtxt = B.window.document.querySelector('#diag').textContent; ok(/Sync function/.test(dtxt) && /A test write and read-back succeeded/.test(dtxt) && /default password/.test(dtxt) && /In sync/.test(dtxt), 'diagnostics panel shows OK rows + default-password warning: ' + dtxt.slice(0, 400).replace(/\s+/g, ' '));
  // diagnostics when the API is missing (static host / protection page)
  const C = boot(async () => ({ ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => ({}) }), { storage: { gt_auth: 'YXJjaGVyOnBhc3N3b3Jk' } });
  await wait(50); C.window.location.hash = '#settings'; C.window.dispatchEvent(new C.window.HashChangeEvent('hashchange'));
  C.window.document.querySelector('[data-act=diag]').dispatchEvent(new C.window.MouseEvent('click', { bubbles: true })); await wait(200);
  ok(/api folder is not part of this deployment/.test(C.window.document.querySelector('#diag').textContent), 'diagnostics explain a missing /api');
  // offline fallback login with default creds
  const D = boot(async () => { throw new Error('offline'); }); await login(D, 'archer', 'password'); ok(!D.window.document.querySelector('#app').hidden, 'offline: local login still works');

  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
