// Runs every test file in turn. Usage: cd tests && npm install && npm test
const { spawnSync } = require('child_process');
let bad = 0;
['mapping.test.js', 'api.test.js', 'ui.test.js'].forEach(f => {
  console.log('\n== ' + f);
  const r = spawnSync(process.execPath, [require('path').join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
});
console.log(bad ? '\n' + bad + ' test file(s) FAILED' : '\nAll test files passed');
process.exit(bad ? 1 : 0);
