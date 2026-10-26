const fs = require('fs');
const path = require('path');

const targetFiles = [
  path.join(__dirname, '../node_modules/zalo-api-final/dist/cjs/utils.cjs'),
  path.join(__dirname, '../node_modules/zalo-api-final/dist/utils.js')
];

const targetPattern = /const setCookieRaw = response\.headers\.get\("set-cookie"\);[\s\S]*?await ctx\.cookie\.setCookie\(parsed, origin\);[\s\S]*?logger\(ctx\)\.error\(error\);[\s\S]*?}[\s\S]*?}[\s\S]*?}/;

const replacementCode = `let rawCookies = [];
    if (typeof response.headers.getSetCookie === "function") {
        rawCookies = response.headers.getSetCookie();
    } else {
        const setCookieRaw = response.headers.get("set-cookie");
        if (setCookieRaw) {
            rawCookies = setCookieRaw.split(/,\\s*(?=[a-zA-Z0-9_\\-]+=)/);
        }
    }
    if (rawCookies.length > 0 && !raw) {
        for (const cookie of rawCookies) {
            const parsed = toughCookie.Cookie.parse(cookie);
            try {
                if (parsed) {
                    let cookieOrigin = origin;
                    if (parsed.domain) {
                        const cleanDomain = parsed.domain.replace(/^\\./, "");
                        cookieOrigin = \`https://\${cleanDomain}\`;
                    }
                    await ctx.cookie.setCookie(parsed, cookieOrigin, { ignoreError: true });
                }
            }
            catch (error) {
                logger(ctx).error(error);
            }
        }
    }`;

let patchedCount = 0;
for (const file of targetFiles) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    let modified = false;

    if (content.includes('(?=[a-zA-Z0-9_\\-]+=/')) {
      content = content.replace('(?=[a-zA-Z0-9_\\-]+=/', '(?=[a-zA-Z0-9_\\-]+=)/');
      modified = true;
      console.log(`[Patch] Đã sửa lỗi regex cho: ${path.basename(file)}`);
    }

    if (content.includes('}\r\n    }\r\n    }\r\n    const redirectURL')) {
      content = content.replace('}\r\n    }\r\n    }\r\n    const redirectURL', '}\r\n    }\r\n    const redirectURL');
      modified = true;
      console.log(`[Patch] Đã sửa lỗi thừa ngoặc nhọn cho: ${path.basename(file)}`);
    } else if (content.includes('}\n    }\n    }\n    const redirectURL')) {
      content = content.replace('}\n    }\n    }\n    const redirectURL', '}\n    }\n    const redirectURL');
      modified = true;
      console.log(`[Patch] Đã sửa lỗi thừa ngoặc nhọn cho: ${path.basename(file)}`);
    }

    if (modified) {
      fs.writeFileSync(file, content, 'utf8');
      patchedCount++;
    } else if (content.includes('cleanDomain = parsed.domain.replace')) {
      console.log(`[Patch] File đã được vá: ${path.basename(file)}`);
      patchedCount++;
    } else if (targetPattern.test(content)) {
      content = content.replace(targetPattern, replacementCode);
      fs.writeFileSync(file, content, 'utf8');
      console.log(`[Patch] Đã vá thành công: ${path.basename(file)}`);
      patchedCount++;
    }
  }
}

// Vá thêm bắt đầy đủ sự kiện đồng bộ tin nhắn (syncmsgmb, transfer_sync2, transfer_msg, transfer_status, upload_batch)
// và bổ sung method requestMobileWakeUp vào Listener
const listenFiles = [
  path.join(__dirname, '../node_modules/zalo-api-final/dist/cjs/apis/listen.cjs'),
  path.join(__dirname, '../node_modules/zalo-api-final/dist/apis/listen.js')
];

for (const file of listenFiles) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');

    if (!content.includes('transfer_msg')) {
      const frPattern = 'this.emit("friend_event", friendEvent);\n                        }';
      const frPatternCRLF = 'this.emit("friend_event", friendEvent);\r\n                        }';
      const syncBlock = `
                        else if (
                            control.content.act_type == "syncmsgmb" ||
                            control.content.act_type == "transfer_sync2" ||
                            control.content.act_type == "transfer_msg" ||
                            control.content.act == "transfer_status" ||
                            control.content.act == "upload_batch" ||
                            control.content.act == "transfer_after_login" ||
                            control.content.act == "syncmsg_info" ||
                            control.content.act == "user_confirm"
                        ) {
                            let syncData = control.content.data;
                            try {
                                if (typeof syncData == "string") syncData = JSON.parse(syncData);
                                if (syncData && typeof syncData.data == "string") {
                                    try { syncData.data = JSON.parse(syncData.data); } catch (_) {}
                                }
                            } catch (e) {}
                            this.emit("sync_event", {
                                type: control.content.act,
                                data: syncData,
                                act: control.content.act,
                                act_type: control.content.act_type
                            });
                        }`;

      if (content.includes(frPattern)) {
        content = content.replace(frPattern, frPattern + syncBlock);
      } else if (content.includes(frPatternCRLF)) {
        content = content.replace(frPatternCRLF, frPatternCRLF + syncBlock);
      }
    }

    // Bổ sung method requestMobileWakeUp vào Listener nếu chưa có
    if (!content.includes('requestMobileWakeUp')) {
      const targetMethod = 'requestOldReactions(threadType, lastMsgId = null) {';
      const wakeUpMethod = `requestMobileWakeUp(syncId = "") {
        const payload = {
            version: 1,
            cmd: 592,
            subCmd: 0,
            data: { syncId, toDevice: 0 },
        };
        this.sendWs(payload, false);
    }
    `;
      if (content.includes(targetMethod)) {
        content = content.replace(targetMethod, wakeUpMethod + targetMethod);
      }
    }

    fs.writeFileSync(file, content, 'utf8');
    console.log(`[Patch] File đã có/vá đồng bộ Sync V2 & Mobile Wake Up: ${path.basename(file)}`);
  }
}

// Vá Message.cjs và Message.js để nhận diện chính xác tin nhắn gửi đi của chính mình (isSelf)
const messageModelFiles = [
  path.join(__dirname, '../node_modules/zalo-api-final/dist/cjs/models/Message.cjs'),
  path.join(__dirname, '../node_modules/zalo-api-final/dist/models/Message.js')
];

for (const file of messageModelFiles) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes('data.uidFrom == uid')) {
      content = content.replace(
        'this.threadId = data.uidFrom == "0" ? data.idTo : data.uidFrom;\n        this.isSelf = data.uidFrom == "0";',
        'const isSelf = data.uidFrom == "0" || (uid && String(data.uidFrom) === String(uid));\n        this.threadId = isSelf ? (data.idTo && data.idTo != "0" && data.idTo != uid ? data.idTo : data.uidFrom) : data.uidFrom;\n        this.isSelf = isSelf;'
      );
      content = content.replace(
        'this.threadId = data.uidFrom == "0" ? data.idTo : data.uidFrom;\r\n        this.isSelf = data.uidFrom == "0";',
        'const isSelf = data.uidFrom == "0" || (uid && String(data.uidFrom) === String(uid));\r\n        this.threadId = isSelf ? (data.idTo && data.idTo != "0" && data.idTo != uid ? data.idTo : data.uidFrom) : data.uidFrom;\r\n        this.isSelf = isSelf;'
      );
      content = content.replace(
        'this.isSelf = data.uidFrom == "0";',
        'this.isSelf = data.uidFrom == "0" || (uid && String(data.uidFrom) === String(uid));'
      );
      fs.writeFileSync(file, content, 'utf8');
      console.log(`[Patch] Đã vá nhận diện tin nhắn gửi đi (isSelf) cho: ${path.basename(file)}`);
    }
  }
}

// Vá addReaction.cjs và addReaction.js để hỗ trợ thả tim emoji, chuẩn hóa msgId/cliMsgId và loại bỏ prefix g_
const reactionFiles = [
  path.join(__dirname, '../node_modules/zalo-api-final/dist/cjs/apis/addReaction.cjs'),
  path.join(__dirname, '../node_modules/zalo-api-final/dist/apis/addReaction.js')
];

for (const file of reactionFiles) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes('ZALO_PC_ICONS')) {
      // Vá gMsgID & cMsgID & grid
      content = content.replace(
        'gMsgID: parseInt(dest.data.msgId),\n                                cMsgID: parseInt(dest.data.cliMsgId),',
        'gMsgID,\n                                cMsgID,\n                                msgType,'
      );
      content = content.replace(
        'gMsgID: parseInt(dest.data.msgId),\r\n                                cMsgID: parseInt(dest.data.cliMsgId),',
        'gMsgID,\n                                cMsgID,\n                                msgType,'
      );
      content = content.replace(
        'params.grid = dest.threadId;',
        'params.grid = String(dest.threadId).replace(/^g_/, "");'
      );
      content = content.replace(
        'params.toid = dest.threadId;',
        'params.toid = String(dest.threadId).replace(/^g_/, "");'
      );
      // Vá rIcon & ZALO_PC_ICONS
      const rIconOld = 'const rIcon = typeof icon == "object" ? icon.icon : icon;';
      const rIconNew = `const ZALO_PC_ICONS = {
            5: "/-heart",
            3: "/-strong",
            0: ":>",
            32: ":o",
            2: ":-((",
            20: ":-h"
        };
        const rIcon = ZALO_PC_ICONS[rType] || (typeof icon == "object" ? (icon.icon || icon.rIcon) : icon);
        let gMsgID = dest.data && dest.data.msgId ? String(dest.data.msgId) : "";
        if (!/^\\d+$/.test(gMsgID) || gMsgID === "0") gMsgID = "";
        let cMsgID = dest.data && dest.data.cliMsgId ? parseInt(dest.data.cliMsgId) : NaN;
        if (isNaN(cMsgID) || cMsgID <= 0) cMsgID = Date.now();
        let msgType = dest.data && dest.data.msgType ? Number(dest.data.msgType) : 1;
        if (isNaN(msgType) || msgType <= 0) msgType = 1;`;
      
      content = content.replace(rIconOld, rIconNew);
      
      // Vá case emoji
      const heartOld = 'case Reaction.Reactions.HEART:';
      const heartNew = 'case "❤️":\n                case "heart":\n                case Reaction.Reactions.HEART:';
      content = content.replace(heartOld, heartNew);

      const heartEsOld = 'case Reactions.HEART:';
      const heartEsNew = 'case "❤️":\n                case "heart":\n                case Reactions.HEART:';
      content = content.replace(heartEsOld, heartEsNew);

      fs.writeFileSync(file, content, 'utf8');
      console.log(`[Patch] Đã vá addReaction cho: ${path.basename(file)}`);
    } else {
      console.log(`[Patch] File đã có ZALO_PC_ICONS: ${path.basename(file)}`);
    }
  }
}

// Vá loginQR để hiển thị chi tiết phản hồi khi không đăng nhập được
const loginQRFiles = [
  path.join(__dirname, '../node_modules/zalo-api-final/dist/cjs/apis/loginQR.cjs'),
  path.join(__dirname, '../node_modules/zalo-api-final/dist/apis/loginQR.js')
];

for (const file of loginQRFiles) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    if (content.includes('return reject(new ZaloApiError.ZaloApiError("Can\'t login"));')) {
      content = content.replace(
        'return reject(new ZaloApiError.ZaloApiError("Can\'t login"));',
        'return reject(new ZaloApiError.ZaloApiError("Can\'t login: " + JSON.stringify(userInfo)));'
      );
      fs.writeFileSync(file, content, 'utf8');
      console.log(`[Patch] Đã vá thông báo lỗi chi tiết cho loginQR: ${path.basename(file)}`);
    }
  }
}

if (patchedCount > 0) {
  console.log('[Patch] Đã hoàn thành bản vá lỗi Cookie, Sync & Tin nhắn gửi đi Zalo.');
}

