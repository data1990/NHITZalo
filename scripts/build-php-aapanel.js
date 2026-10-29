const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'web-php');
const output = path.join(root, 'deploy', 'php-aapanel');
const site = path.join(output, 'site');
fs.mkdirSync(site, { recursive: true });
const indexPath = path.join(src, 'public', 'index.html');
if (!fs.existsSync(indexPath)) throw new Error('Thiếu frontend build. Chạy npm run build:php:ui trước.');
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const assets = [...indexHtml.matchAll(/(?:src|href)="\/([^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
if (!assets.length) throw new Error('Không tìm thấy asset đã build trong index.html');
fs.copyFileSync(indexPath, path.join(site, 'index.html'));
const targetAssets = path.resolve(site, 'assets');
if (!targetAssets.startsWith(path.resolve(output) + path.sep)) throw new Error('Đường dẫn asset không an toàn');
fs.rmSync(targetAssets, { recursive: true, force: true });
for (const name of fs.readdirSync(site)) {
  if (/^index-[A-Za-z0-9_-]+\.(?:js|css)$/.test(name)) fs.rmSync(path.join(site, name));
}
for (const relative of assets) {
  const source = path.resolve(src, 'public', relative);
  if (!source.startsWith(path.resolve(src, 'public') + path.sep) || !fs.existsSync(source)) throw new Error(`Asset không hợp lệ: ${relative}`);
  const destination = path.join(site, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
const original = fs.readFileSync(path.join(src, 'public', 'api.php'), 'utf8');
const from = "require dirname(__DIR__) . '/bootstrap.php';";
if (!original.includes(from)) throw new Error('Không tìm thấy dòng bootstrap của API PHP');
fs.writeFileSync(path.join(site, 'api.php'), original.replace(from,
  "require __DIR__ . '/bootstrap.php';"));
for (const name of ['bootstrap.php', 'config.example.php', 'schema.sql']) {
  fs.copyFileSync(path.join(src, name), path.join(site, name));
}
const adminScript = fs.readFileSync(path.join(src, 'bin', 'create-admin.php'), 'utf8');
const adminRequire = "require dirname(__DIR__) . '/bootstrap.php';";
if (!adminScript.includes(adminRequire)) throw new Error('Không tìm thấy dòng bootstrap của create-admin.php');
fs.writeFileSync(path.join(site, 'create-admin.php'), adminScript.replace(adminRequire,
  "require __DIR__ . '/bootstrap.php';"));
const migrateScript = fs.readFileSync(path.join(src, 'bin', 'migrate.php'), 'utf8');
if (!migrateScript.includes(adminRequire)) throw new Error('Không tìm thấy dòng bootstrap của migrate.php');
fs.writeFileSync(path.join(site, 'migrate.php'), migrateScript
  .replace(adminRequire, "require __DIR__ . '/bootstrap.php';")
  .replace("__DIR__ . '/../schema.sql'", "__DIR__ . '/schema.sql'"));
const safeOutput = path.resolve(root, 'deploy', 'php-aapanel');
const obsoletePrivate = path.resolve(output, 'private');
if (obsoletePrivate !== path.join(safeOutput, 'private') || !obsoletePrivate.startsWith(path.resolve(root) + path.sep)) {
  throw new Error('Đường dẫn đóng gói không an toàn');
}
fs.rmSync(obsoletePrivate, { recursive: true, force: true });
const archive = path.join(output, `NHITZalo-aaPanel-PHP-${require('../package.json').version}.zip`);
if (process.platform === 'win32') {
  execFileSync('tar.exe', ['-a', '-c', '-f', archive, '-C', site, '.']);
} else {
  execFileSync('zip', ['-qr', archive, '.'], { cwd: site });
}
const stagingSite = path.resolve(site);
if (stagingSite !== path.join(safeOutput, 'site') || !stagingSite.startsWith(path.resolve(root) + path.sep)) {
  throw new Error('Đường dẫn thư mục tạm không an toàn');
}
fs.rmSync(stagingSite, { recursive: true, force: true });
for (const oldSplitZip of ['site.zip', 'private.zip', 'NHITZalo-aaPanel-PHP-1.1.16-r2.zip']) {
  const oldPath = path.join(output, oldSplitZip);
  if (path.dirname(path.resolve(oldPath)) !== safeOutput) throw new Error('Đường dẫn ZIP cũ không an toàn');
  fs.rmSync(oldPath, { force: true });
}
console.log('Single upload:', archive);
console.log('Extract the ZIP into /www/wwwroot/zalo.ngochoangit.net/ on the VPS.');
