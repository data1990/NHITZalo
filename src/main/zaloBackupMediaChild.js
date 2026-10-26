// Decode media metadata using the native parser bundled with the installed Zalo PC.
const path = require('node:path');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const { items, zaloDirectory } = JSON.parse(input);
    const binding = require(path.join(zaloDirectory, 'resources', 'app.asar.unpacked',
      'native', 'nativelibs', 'db-cross-v4', 'dist', 'binding.js'));
    const results = [];
    for (const item of items) {
      const parsed = binding.parseBinNet(Buffer.from(item.binNet, 'base64'));
      if (parsed?.result !== 0) continue;
      const data = parsed.data || {};
      const attach = data.attachs?.[0] || data.attach || {};
      let params = attach.params || {};
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch (_) { params = {}; }
      }
      const safeUrl = value => /^https:\/\//i.test(String(value || '')) ? String(value) : '';
      const attachmentUrl = safeUrl(attach.href || attach.url);
      const msgType = Number(item.msgType || 6);
      if (msgType === 22 && attachmentUrl) {
        results.push({ index: item.index, fileUrl: attachmentUrl,
          fileName: String(attach.title || attach.file_name || attach.name || params.fileName || params.name || ''),
          fileSize: Number(attach.file_size || attach.size || params.fileSize || params.size || 0) });
      } else if ([3, 4, 31].includes(msgType) && attachmentUrl) {
        results.push({ index: item.index, photoUrl: attachmentUrl,
          thumbUrl: safeUrl(attach.thumb || attach.thumbUrl || params.thumb),
          photoCaption: String(attach.caption || attach.title || params.caption || params.title || '') });
      } else if (msgType === 19 && attachmentUrl) {
        results.push({ index: item.index, videoUrl: attachmentUrl,
          thumbUrl: safeUrl(attach.thumb || attach.thumbUrl || params.thumb) });
      } else if (msgType === 6 || msgType === 12) {
        const voiceUrl = safeUrl(attach.href || attach.voiceUrl);
        const m4aUrl = safeUrl(params.m4a || attach.m4aUrl);
        if (!voiceUrl && !m4aUrl) continue;
        results.push({ index: item.index,
          voiceUrl, m4aUrl });
      }
    }
    process.stdout.write(JSON.stringify({ results }));
  } catch (error) {
    process.stderr.write(error.message);
    process.exitCode = 1;
  }
});
