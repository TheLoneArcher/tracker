const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
exports.ROOT = ROOT;
exports.boot = function (fetchImpl, opts = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: opts.url || 'https://app.test/', pretendToBeVisual: true });
  const w = dom.window;
  w.__GT_TEST__ = true;
  w.fetch = fetchImpl || (async () => { throw new Error('offline'); });
  w.confirm = () => true; w.scrollTo = () => {};
  w.addEventListener('error', e => { console.error('PAGE ERROR', e.message); });
  if (opts.storage) Object.keys(opts.storage).forEach(k => w.localStorage.setItem(k, opts.storage[k]));
  ['data.js', 'qdata.js', 'app.js'].forEach(f => { const s = w.document.createElement('script'); s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8'); w.document.body.appendChild(s); });
  return dom;
};
