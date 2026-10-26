// Runs under the installed Zalo PC Electron runtime (ia32). Input arrives only through stdin.
const fs = require('node:fs');
const path = require('node:path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const { inputPath, outputPath, key, zaloDirectory, conversationCount } = JSON.parse(input);
    const bindingPath = path.join(zaloDirectory, 'resources', 'app.asar.unpacked',
      'native', 'nativelibs', 'db-cross-v4', 'dist', 'binding.js');
    const decoder = require(bindingPath);
    fs.mkdirSync(outputPath, { recursive: true });
    let processed = 0;
    // Zalo PC passes a directory ending in '/' to this native API.
    const nativeOutputPath = outputPath.endsWith('/') ? outputPath : `${outputPath}/`;
    const result = decoder.decompressAndDecryptDb_V2(inputPath, nativeOutputPath, key,
      () => {
        processed++;
        if (processed % 25 === 0) process.stdout.write(JSON.stringify({ progress: processed, conversationCount }) + '\n');
      });
    if (result.result !== 0) throw new Error(`Giải mã ZaloDB thất bại (mã ${result.result}, chi tiết ${result.inner_error ?? 'không có'})`);
    process.stdout.write(JSON.stringify({ success: true, processed }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ success: false, error: error.message }) + '\n');
    process.exitCode = 1;
  }
});
