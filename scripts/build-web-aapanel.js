const fs = require('node:fs');
const path = require('node:path');

const project = path.join(__dirname, '..');
const rootPackage = require(path.join(project, 'package.json'));
const portable = process.argv.includes('--portable');
const output = path.join(project, 'dist', portable ? 'aaPanel-portable-web-host' : 'aaPanel-web-host');
const allowed = new Set(['mysqlStore.js', 'package.json', 'patch-zalo.js', 'public',
  'server.js', 'sessionStore.js', 'start.sh', 'zaloFetch.js', 'zaloSessions.js',
  ...(portable ? ['setup-portable.sh', 'run-portable.sh'] : ['.dockerignore', 'Dockerfile', 'compose.yaml'])]);

fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(output)) {
  if (!allowed.has(entry)) throw new Error(`Thư mục gói có tệp lạ: ${entry}. Hãy dùng thư mục xuất sạch.`);
}

const copy = (source, target) => fs.copyFileSync(path.join(project, source), path.join(output, target));
copy('src/web/hostedServer.js', 'server.js');
copy('src/web/sessionStore.js', 'sessionStore.js');
copy('src/web/mysqlStore.js', 'mysqlStore.js');
copy('src/main/zaloFetch.js', 'zaloFetch.js');
copy('deploy/aaPanel/start.sh', 'start.sh');
if (portable) {
  copy('deploy/aaPanel/setup-portable.sh', 'setup-portable.sh');
  copy('deploy/aaPanel/run-portable.sh', 'run-portable.sh');
} else {
  copy('deploy/aaPanel/Dockerfile', 'Dockerfile');
  copy('deploy/aaPanel/compose.yaml', 'compose.yaml');
  copy('deploy/aaPanel/.dockerignore', '.dockerignore');
}

const sessions = fs.readFileSync(path.join(project, 'src/web/zaloSessions.js'), 'utf8');
if (!sessions.includes("require('../main/zaloFetch')")) throw new Error('Đường dẫn zaloFetch đã thay đổi');
fs.writeFileSync(path.join(output, 'zaloSessions.js'),
  sessions.replace("require('../main/zaloFetch')", "require('./zaloFetch')"));

const patch = fs.readFileSync(path.join(project, 'scripts/patch-zalo.js'), 'utf8');
if (!patch.includes("path.join(__dirname, '../node_modules/")) throw new Error('Đường dẫn vá thư viện đã thay đổi');
fs.writeFileSync(path.join(output, 'patch-zalo.js'),
  patch.replaceAll("path.join(__dirname, '../node_modules/", "path.join(__dirname, 'node_modules/"));

const publicDir = path.join(output, 'public');
fs.mkdirSync(publicDir, { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css']) {
  copy(`src/web/hostedPublic/${name}`, `public/${name}`);
}
const htmlFile = path.join(publicDir, 'index.html');
const html = fs.readFileSync(htmlFile, 'utf8');
if (!html.includes('src="/app.js"') || !html.includes('href="/style.css"')) {
  throw new Error('Đường dẫn tài nguyên Web Host đã thay đổi');
}
fs.writeFileSync(htmlFile, html.replace('src="/app.js"', `src="/app.js?v=${rootPackage.version}"`)
  .replace('href="/style.css"', `href="/style.css?v=${rootPackage.version}"`));

fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({
  name: 'nhitzalo-web-host', version: rootPackage.version, private: true, type: 'commonjs',
  scripts: { start: 'sh start.sh', postinstall: 'node patch-zalo.js' },
  dependencies: { ...rootPackage.dependencies, mysql2: '^3.24.6' }
}, null, 2) + '\n');

console.log(output);
