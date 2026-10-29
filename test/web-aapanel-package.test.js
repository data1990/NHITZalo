const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

test('aaPanel package is standalone and serves its own web UI', async t => {
  const project = path.join(__dirname, '..');
  const output = path.join(project, 'dist', 'aaPanel-web-host');
  execFileSync(process.execPath, [path.join(project, 'scripts', 'build-web-aapanel.js')], { cwd: project });
  const entries = fs.readdirSync(output).sort();
  assert.deepEqual(entries, [
    '.dockerignore', 'Dockerfile', 'compose.yaml', 'mysqlStore.js', 'package.json', 'patch-zalo.js', 'public', 'server.js',
    'sessionStore.js', 'start.sh',
    'zaloFetch.js', 'zaloSessions.js'
  ]);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.start, 'sh start.sh');
  assert.equal(manifest.scripts.postinstall, 'node patch-zalo.js');
  assert.equal(manifest.dependencies['zalo-api-final'], require('../package.json').dependencies['zalo-api-final']);
  assert.ok(manifest.dependencies.mysql2);
  assert.match(fs.readFileSync(path.join(output, 'Dockerfile'), 'utf8'), /FROM node:/);
  const compose = fs.readFileSync(path.join(output, 'compose.yaml'), 'utf8');
  assert.match(compose, /network_mode: host/);
  assert.match(compose, /WEB_PUBLIC_ORIGIN: https:\/\/zalo\.ngochoangit\.net/);
  const startup = fs.readFileSync(path.join(output, 'start.sh'), 'utf8');
  assert.match(startup, /WEB_PUBLIC_ORIGIN=\$\{WEB_PUBLIC_ORIGIN:-https:\/\/zalo\.ngochoangit\.net\}/);
  assert.doesNotMatch(startup, /zalo\.example\.com/);
  const html = fs.readFileSync(path.join(output, 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Mật khẩu quản trị<\/label>/);
  assert.match(html, /Đăng ký/);
  assert.ok(html.includes(`/app.js?v=${manifest.version}`));
  const { createHostedServer } = require(path.join(output, 'server.js'));
  const server = createHostedServer({ store: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const health = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(fs.existsSync(path.join(output, 'src')), false);
  assert.equal(fs.existsSync(path.join(output, 'test')), false);
  assert.equal(fs.existsSync(path.join(output, 'node_modules')), false);
});

test('portable Ubuntu package includes a local runtime setup and excludes Docker files', () => {
  const project = path.join(__dirname, '..');
  const output = path.join(project, 'dist', 'aaPanel-portable-web-host');
  execFileSync(process.execPath, [path.join(project, 'scripts', 'build-web-aapanel.js'), '--portable'], { cwd: project });
  const entries = fs.readdirSync(output).sort();
  assert.deepEqual(entries, [
    'mysqlStore.js', 'package.json', 'patch-zalo.js', 'public', 'run-portable.sh',
    'server.js', 'sessionStore.js', 'setup-portable.sh', 'start.sh',
    'zaloFetch.js', 'zaloSessions.js'
  ]);
  const setup = fs.readFileSync(path.join(output, 'setup-portable.sh'), 'utf8');
  assert.match(setup, /nodejs\.org\/dist\//);
  assert.match(setup, /sha256sum -c/);
  assert.match(setup, /npm install --omit=dev/);
  const run = fs.readFileSync(path.join(output, 'run-portable.sh'), 'utf8');
  assert.match(run, /exec sh \.\/start\.sh/);
  const startup = fs.readFileSync(path.join(output, 'start.sh'), 'utf8');
  assert.match(startup, /WEB_DB_NAME=\$\{WEB_DB_NAME:-zalo\}/);
  assert.match(startup, /WEB_DB_USER=\$\{WEB_DB_USER:-zalo\}/);
});
