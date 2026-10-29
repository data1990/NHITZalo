const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppUpdates } = require('../src/main/appUpdates');

function setup() {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  updater.downloadUpdate = async () => {};
  updater.quitAndInstall = () => {};
  const messages = [];
  const dialog = { showMessageBox: async (...args) => {
    messages.push(args.length === 1 ? args[0] : args[1]);
    return { response: 0 };
  } };
  const app = { isPackaged: true, getVersion: () => '1.1.29' };
  const log = { warn: () => {} };
  return { updater, dialog, app, log, messages };
}

test('new release downloads automatically and installs without a prompt', async () => {
  const f = setup();
  const installs = [];
  f.updater.quitAndInstall = (...args) => { installs.push(args); };
  const updates = createAppUpdates({ ...f, getWindow: () => null });
  await updates.check();
  f.updater.emit('update-available', { version: '1.1.30' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.messages.length, 0);
  f.updater.emit('update-downloaded', { version: '1.1.30' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(installs, [[true, true]]);
  assert.equal(f.messages.length, 0);
});

test('no update does not download or install anything', async () => {
  const f = setup();
  let downloads = 0;
  let installs = 0;
  f.updater.downloadUpdate = async () => { downloads++; };
  f.updater.quitAndInstall = () => { installs++; };
  const updates = createAppUpdates({ ...f, getWindow: () => null });
  await updates.check();
  f.updater.emit('update-not-available');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(downloads, 0);
  assert.equal(installs, 0);
});

test('manual check reports current version but automatic check is quiet', async () => {
  const f = setup();
  const updates = createAppUpdates({ ...f, getWindow: () => null });
  await updates.check();
  f.updater.emit('update-not-available');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.length, 0);
  await updates.check({ manual: true });
  f.updater.emit('update-not-available');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.messages[0].message, /1\.1\.29/);
});

test('development mode never queries the release feed', async () => {
  const f = setup();
  f.app.isPackaged = false;
  let checks = 0;
  f.updater.checkForUpdates = async () => { checks++; };
  const updates = createAppUpdates({ ...f, getWindow: () => null });
  await updates.check();
  assert.equal(checks, 0);
});

test('automatic update error is logged without interrupting the user', async () => {
  const f = setup();
  const failure = new Error('network');
  let warnings = 0;
  f.log.warn = () => { warnings++; };
  const updates = createAppUpdates({ ...f, getWindow: () => null });
  await updates.check();
  f.updater.emit('error', failure);
  assert.equal(warnings, 1);
  assert.equal(f.messages.length, 0);
});
