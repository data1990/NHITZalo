const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const list = document.getElementById('account-list');
const notice = document.getElementById('notice');
const logoutButton = document.getElementById('logout');
let csrf = '';
let polling;
let lastAccountsSignature = '';
let currentUser = null;

function tell(message, kind = '') {
  notice.textContent = message;
  notice.className = kind;
}

async function api(route, method = 'GET', body) {
  const response = await fetch(route, { method, credentials: 'same-origin',
    headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new Error(`Máy chủ trả HTML thay vì JSON cho ${route}. Kiểm tra aaPanel Mapping/reverse proxy: chuyển cả /api/* tới Node trên cổng 3177.`);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Yêu cầu thất bại');
  return result;
}

function setLoggedIn(loggedIn) {
  loginView.hidden = loggedIn;
  document.getElementById('register-view').hidden = true;
  dashboardView.hidden = !loggedIn;
  logoutButton.hidden = !loggedIn;
  if (!loggedIn && polling) clearInterval(polling);
}

function setUser(user) {
  currentUser = user;
  document.getElementById('welcome').textContent = `Đang sử dụng: ${user.username}${user.role === 'admin' ? ' · Quản trị viên' : ''}`;
  document.getElementById('admin-panel').hidden = user.role !== 'admin';
}

async function loadPendingUsers() {
  if (currentUser?.role !== 'admin') return;
  const { users } = await api('/api/admin/pending');
  const container = document.getElementById('pending-users');
  container.replaceChildren();
  if (!users.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Không có tài khoản đang chờ duyệt.';
    container.append(empty);
  }
  for (const user of users) {
    const row = document.createElement('div'); row.className = 'pending-row';
    const name = document.createElement('strong'); name.textContent = user.username;
    row.append(name, button('Duyệt tài khoản', 'primary', async () => {
      try { await api(`/api/admin/users/${user.id}/approve`, 'POST', {}); await loadPendingUsers(); }
      catch (error) { tell(error.message, 'error'); }
    }));
    container.append(row);
  }
}

function button(label, className, handler) {
  const element = document.createElement('button');
  element.type = 'button'; element.className = `button ${className}`;
  element.textContent = label;
  element.addEventListener('click', handler);
  return element;
}

function renderAccounts(accounts) {
  list.replaceChildren();
  if (!accounts.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Chưa có tài khoản. Thêm tài khoản ở phía trên để tạo mã QR đăng nhập.';
    list.append(empty);
    return;
  }
  for (const account of accounts) {
    const card = document.createElement('article'); card.className = 'account-card';
    const top = document.createElement('div'); top.className = 'card-top';
    const avatar = document.createElement('span'); avatar.className = 'avatar';
    avatar.textContent = (account.name || account.label || 'Z').charAt(0).toUpperCase();
    const detail = document.createElement('div');
    const name = document.createElement('div'); name.className = 'account-name';
    name.textContent = account.name || account.label;
    const status = document.createElement('div'); status.className = `status ${account.status || ''}`;
    status.textContent = account.message || (account.hasSession ? 'Có phiên đã lưu' : 'Chưa đăng nhập');
    detail.append(name, status); top.append(avatar, detail); card.append(top);
    if (account.qr?.startsWith('data:image/')) {
      const wrap = document.createElement('div'); wrap.className = 'qr-wrap';
      const image = document.createElement('img'); image.alt = 'Mã QR đăng nhập Zalo'; image.src = account.qr;
      wrap.append(image); card.append(wrap);
    }
    const actions = document.createElement('div'); actions.className = 'card-actions';
    actions.append(button(account.status === 'qr_expired' ? 'Tạo QR mới' : 'Đăng nhập QR', 'primary', async () => {
      try { await api(`/api/accounts/${account.id}/qr`, 'POST', {}); await loadAccounts(); }
      catch (error) { tell(error.message, 'error'); }
    }));
    if (account.hasSession) actions.append(button('Xóa phiên', '', async () => {
      if (!confirm(`Xóa phiên Zalo đã lưu của ${account.label}?`)) return;
      try { await api(`/api/accounts/${account.id}/session`, 'POST', {}); await loadAccounts(); }
      catch (error) { tell(error.message, 'error'); }
    }));
    actions.append(button('Xóa tài khoản', 'danger', async () => {
      if (!confirm(`Xóa tài khoản ${account.label} và phiên đăng nhập trên web?`)) return;
      try { await api(`/api/accounts/${account.id}/delete`, 'POST', {}); await loadAccounts(); }
      catch (error) { tell(error.message, 'error'); }
    }));
    card.append(actions); list.append(card);
  }
}

async function loadAccounts() {
  const data = await api('/api/accounts');
  const signature = JSON.stringify(data.accounts);
  if (signature !== lastAccountsSignature) {
    lastAccountsSignature = signature;
    renderAccounts(data.accounts);
  }
}

async function boot() {
  try {
    const session = await api('/api/me');
    csrf = session.csrf;
    setUser(session.user);
    setLoggedIn(true);
    await loadAccounts();
    await loadPendingUsers();
    polling = setInterval(() => {
      loadAccounts().catch(() => {});
      loadPendingUsers().catch(() => {});
    }, 2500);
  } catch (error) {
    setLoggedIn(false);
    if (!/Cần đăng nhập/.test(error.message)) tell(error.message, 'error');
  }
}

document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/api/login', 'POST', {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value
    });
    csrf = result.csrf;
    setUser(result.user);
    document.getElementById('password').value = '';
    tell('Đã đăng nhập', 'success');
    setLoggedIn(true);
    await loadAccounts();
    await loadPendingUsers();
    if (polling) clearInterval(polling);
    polling = setInterval(() => {
      loadAccounts().catch(() => {});
      loadPendingUsers().catch(() => {});
    }, 2500);
  } catch (error) { tell(error.message, 'error'); }
});

document.getElementById('show-register').addEventListener('click', () => {
  loginView.hidden = true;
  document.getElementById('register-view').hidden = false;
  tell('');
});
document.getElementById('show-login').addEventListener('click', () => {
  document.getElementById('register-view').hidden = true;
  loginView.hidden = false;
  tell('');
});
document.getElementById('register-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/register', 'POST', {
      username: document.getElementById('register-username').value,
      password: document.getElementById('register-password').value
    });
    document.getElementById('register-password').value = '';
    document.getElementById('register-view').hidden = true;
    loginView.hidden = false;
    tell('Đã đăng ký. Chờ quản trị viên duyệt trước khi đăng nhập.', 'success');
  } catch (error) { tell(error.message, 'error'); }
});

document.getElementById('add-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.getElementById('account-label');
  try {
    await api('/api/accounts', 'POST', { label: input.value });
    input.value = '';
    tell('Đã thêm tài khoản. Bấm Đăng nhập QR để kết nối Zalo.', 'success');
    await loadAccounts();
  } catch (error) { tell(error.message, 'error'); }
});

logoutButton.addEventListener('click', async () => {
  try { await api('/api/logout', 'POST', {}); } catch (_) {}
  csrf = ''; currentUser = null; setLoggedIn(false); tell('Đã đăng xuất');
});

boot();
