/*
 * Vercel serverless function: stores the whole tracker state as one JSON blob in Upstash Redis.
 *
 *   GET  /api/data            -> { rev, state }                 (needs login)
 *   PUT  /api/data            -> body { baseRev, state }        (needs login)
 *                                200 { rev }  |  409 { rev, state } if baseRev is stale
 *   GET  /api/health          -> setup diagnostics (also /api/data?health=1). No login needed for the
 *                                basics; with login it also tests a real write and the password strength.
 *
 * Login: "Authorization: Bearer base64(user:pass)". Credentials come from the env vars APP_USER / APP_PASS
 * (defaults archer / password). Set APP_PASS in the Vercel dashboard to something stronger.
 */
const crypto = require('crypto');

const KEY_STATE = 'gate-tracker:v3:state';
const KEY_REV = 'gate-tracker:v3:rev';
const KEY_OLD = 'gate-tracker:state';          // older format {rev,state}; migrated on first read
const KEY_TEST = 'gate-tracker:healthcheck';
const MAX_STATE_BYTES = 900 * 1024;            // Upstash free plan rejects requests over 1 MB
const MAX_FAILS = 10, FAIL_WINDOW_S = 15 * 60; // wrong-password attempts allowed per IP per window

/* Atomic compare-and-set: only writes if the stored revision still equals what the client last saw. */
const CAS = "local rev = tonumber(redis.call('GET', KEYS[1]) or '0') " +
  "if rev ~= tonumber(ARGV[1]) then return {0, rev} end " +
  "redis.call('SET', KEYS[2], ARGV[2]) redis.call('SET', KEYS[1], rev + 1) return {1, rev + 1}";

function redisCfg() {
  const env = process.env;
  const pairs = [
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN']
  ];
  for (const [u, t] of pairs) if (env[u] && env[t]) return { url: env[u].replace(/\/$/, ''), token: env[t], source: u };
  // Vercel lets you add a prefix to integration variables (e.g. STORAGE_KV_REST_API_URL): look for those too.
  // The matching READ_ONLY token is never used: writes would fail.
  for (const n of Object.keys(env)) {
    if (!/(UPSTASH_REDIS_REST_URL|KV_REST_API_URL)$/.test(n) || !env[n]) continue;
    const tn = n.replace(/URL$/, 'TOKEN');
    if (env[tn]) return { url: env[n].replace(/\/$/, ''), token: env[tn], source: n };
  }
  return null;
}
async function redis(cfg, cmd) {
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error('redis: ' + j.error);
  return j.result;
}
function safeEq(a, b) {
  const A = crypto.createHash('sha256').update(String(a)).digest(), B = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(A, B);
}
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
const ipOf = req => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
const wait = ms => new Promise(r => setTimeout(r, ms));

async function readState(cfg) {
  const [rev, raw] = await redis(cfg, ['MGET', KEY_REV, KEY_STATE]);
  if (raw) return { rev: parseInt(rev, 10) || 0, state: JSON.parse(raw) };
  const old = await redis(cfg, ['GET', KEY_OLD]);          // migrate data saved by an earlier version
  if (old) {
    const o = JSON.parse(old);
    if (o && o.state) {
      await redis(cfg, ['SET', KEY_STATE, JSON.stringify(o.state), 'NX']);
      await redis(cfg, ['SET', KEY_REV, String(o.rev || 1), 'NX']);
      const [rev2, raw2] = await redis(cfg, ['MGET', KEY_REV, KEY_STATE]);
      return { rev: parseInt(rev2, 10) || 0, state: JSON.parse(raw2) };
    }
  }
  return { rev: 0, state: null };
}

async function health(res, authed, usingDefault) {
  const out = { ok: true, time: new Date().toISOString(), node: process.version, auth: { signedIn: authed } };
  const cfg = redisCfg();
  out.storage = { configured: !!cfg, variable: cfg ? cfg.source : null, reachable: null, canWrite: null };
  if (!cfg) {
    out.ok = false;
    out.storage.hint = 'No Redis variables found. Add Upstash Redis in Vercel -> Storage, connect it to this project, then redeploy.';
    return send(res, 200, out);
  }
  try {
    await redis(cfg, ['PING']); out.storage.reachable = true;
  } catch (e) {
    out.storage.reachable = false; out.ok = false;
    out.storage.hint = 'Redis did not answer (' + e.message + '). Check the REST URL and token.';
    return send(res, 200, out);
  }
  if (authed) {
    try {
      const stamp = String(Date.now());
      await redis(cfg, ['SET', KEY_TEST, stamp, 'EX', '60']);
      out.storage.canWrite = (await redis(cfg, ['GET', KEY_TEST])) === stamp;
    } catch (e) { out.storage.canWrite = false; out.ok = false; out.storage.hint = 'Could connect but not write (' + e.message + '). The token may be read-only.'; }
    out.auth.defaultPassword = usingDefault;
    try {
      const cur = await readState(cfg);
      out.data = { rev: cur.rev, hasState: !!cur.state, logs: cur.state && Array.isArray(cur.state.logs) ? cur.state.logs.length : 0 };
    } catch (e) { /* ignore */ }
  }
  return send(res, 200, out);
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const isHealth = url.pathname.endsWith('/health') || url.searchParams.has('health');
  const cfg = redisCfg();

  const user = (process.env.APP_USER || 'archer').toLowerCase();
  const passEnv = process.env.APP_PASS;
  const pass = passEnv || 'password';
  const expected = Buffer.from(user + ':' + pass).toString('base64');
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const hasCreds = given.length > 0;

  // Too many wrong guesses from this address: refuse everything (even correct credentials) until the window passes.
  const ipKey = 'gate-tracker:fails:' + ipOf(req);
  if (cfg && hasCreds) {
    try {
      const n = parseInt(await redis(cfg, ['GET', ipKey]), 10) || 0;
      if (n >= MAX_FAILS) { res.setHeader('Retry-After', String(FAIL_WINDOW_S)); return send(res, 429, { error: 'too many attempts, try again later' }); }
    } catch (e) { /* rate limiting is best effort */ }
  }
  const ok = hasCreds && safeEq(given, expected);

  if (isHealth) return health(res, ok, !passEnv);

  if (!ok) {
    if (cfg && hasCreds) {
      try { const n = await redis(cfg, ['INCR', ipKey]); if (n === 1) await redis(cfg, ['EXPIRE', ipKey, String(FAIL_WINDOW_S)]); } catch (e) { /* ignore */ }
    }
    await wait(500); // slow down guessing
    return send(res, 401, { error: 'unauthorized' });
  }
  if (!cfg) return send(res, 503, { error: 'storage not configured' });

  try {
    if (req.method === 'GET') return send(res, 200, await readState(cfg));
    if (req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      if (!body || typeof body.state !== 'object' || body.state === null || !Array.isArray(body.state.logs)) return send(res, 400, { error: 'bad body' });
      const payload = JSON.stringify(body.state);
      if (Buffer.byteLength(payload) > MAX_STATE_BYTES) return send(res, 413, { error: 'state too large' });
      const baseRev = Math.max(0, parseInt(body.baseRev, 10) || 0);
      if (baseRev === 0) await readState(cfg);                 // first write after an old-format save: migrate before comparing
      const [applied, rev] = await redis(cfg, ['EVAL', CAS, '2', KEY_REV, KEY_STATE, String(baseRev), payload]);
      if (applied === 1) return send(res, 200, { rev });
      return send(res, 409, await readState(cfg));
    }
    res.setHeader('Allow', 'GET, PUT');
    return send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return send(res, 500, { error: 'server error' });
  }
};
