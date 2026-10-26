const ZNOISE_URL = 'https://zwid.api.zalo.me/api/znoise';

async function requestNoisedIds({ ctx, utils, sessionCookies = [], threads = [] }) {
  if (!threads.length) return [];
  const auth = sessionCookies.find(item => (item.key || item.name) === 'zpw_sek');
  if (!auth?.value) throw new Error('Thiếu phiên Zalo để khôi phục tên hội thoại');
  await ctx.cookie.setCookie(`zpw_sek=${auth.value}; Domain=.zalo.me; Path=/; Secure`, 'https://zalo.me');
  const mappings = [];
  for (let start = 0; start < threads.length; start += 400) {
    const batch = threads.slice(start, start + 400);
    const people = batch.filter(item => !item.isGroup);
    const groups = batch.filter(item => item.isGroup);
    const params = {};
    if (people.length) params.fids = people.map(item => Number(item.plainId));
    if (groups.length) params.gids = groups.map(item => Number(item.plainId));
    const encrypted = utils.encodeAES(ctx.secretKey, JSON.stringify(params));
    if (!encrypted) throw new Error('Không mã hóa được yêu cầu ánh xạ ID Zalo');
    const url = utils.makeURL(ctx, ZNOISE_URL);
    const response = await utils.request(ctx, url, {
      method: 'POST', body: new URLSearchParams({ params: encrypted })
    });
    if (!response.ok) throw new Error(`Máy chủ Zalo từ chối ánh xạ ID (HTTP ${response.status})`);
    const outer = await response.json();
    if (Number(outer.error_code) !== 0) throw new Error(outer.error_message || 'Không ánh xạ được ID Zalo');
    const decoded = JSON.parse(utils.decodeAES(ctx.secretKey, outer.data));
    if (Number(decoded.error_code) !== 0) throw new Error(decoded.error_message || 'Dữ liệu ánh xạ ID Zalo không hợp lệ');
    const fids = decoded.data?.fids || [];
    const gids = decoded.data?.gids || [];
    if (fids.length !== people.length || gids.length !== groups.length) {
      throw new Error('Máy chủ Zalo trả về thiếu ID hội thoại');
    }
    for (let i = 0; i < people.length; i++) {
      if (/^\d{12,25}$/.test(String(fids[i]))) mappings.push({ ...people[i], noisedId: String(fids[i]) });
    }
    for (let i = 0; i < groups.length; i++) {
      if (/^\d{12,25}$/.test(String(gids[i]))) mappings.push({ ...groups[i], noisedId: String(gids[i]) });
    }
  }
  return mappings;
}

async function fetchThreadProfiles({ api, mappings = [], friends = [], groups = {} }) {
  const friendsById = new Map(friends.map(item => [String(item.userId), item]));
  const result = mappings.map(item => {
    const cached = item.isGroup
      ? groups[item.noisedId] || groups[`g${item.noisedId}`] || groups[`g_${item.noisedId}`]
      : friendsById.get(item.noisedId);
    const name = cached?.displayName || cached?.zaloName || cached?.name || item.name || '';
    return { ...item, name: ['Bạn bè Zalo', 'Nhóm Zalo'].includes(name) ? '' : name,
      avatar: cached?.avatar || item.avatar || '' };
  });
  const people = result.filter(item => !item.isGroup && !item.name);
  const missingGroups = result.filter(item => item.isGroup && !item.name);
  if (typeof api.getUserInfo === 'function') {
    for (let start = 0; start < people.length; start += 50) {
      const batch = people.slice(start, start + 50);
      try {
        const response = await api.getUserInfo(batch.map(item => item.noisedId));
        const profiles = response?.changed_profiles || {};
        for (const item of batch) {
          const profile = profiles[item.noisedId] || Object.values(profiles).find(value => String(value?.userId) === item.noisedId);
          if (profile) {
            item.name = profile.displayName || profile.zaloName || '';
            item.avatar = profile.avatar || '';
          }
        }
      } catch (error) {
        console.warn('Không tải được tên một số người liên hệ Zalo:', error.message);
      }
    }
  }
  if (typeof api.getGroupInfo === 'function') {
    for (let start = 0; start < missingGroups.length; start += 25) {
      const batch = missingGroups.slice(start, start + 25);
      try {
        const response = await api.getGroupInfo(batch.map(item => item.noisedId));
        const profiles = response?.gridInfoMap || {};
        for (const item of batch) {
          const profile = profiles[item.noisedId] || Object.values(profiles).find(value => String(value?.groupId) === item.noisedId);
          if (profile) {
            item.name = profile.name || '';
            item.avatar = profile.avt || profile.fullAvt || '';
          }
        }
      } catch (error) {
        console.warn('Không tải được tên một số nhóm Zalo:', error.message);
      }
    }
  }
  return result;
}

module.exports = { requestNoisedIds, fetchThreadProfiles };
