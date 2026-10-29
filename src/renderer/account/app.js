const list = document.getElementById('account-list');
const unlockPanel = document.getElementById('unlock-panel');
const createPanel = document.getElementById('create-panel');
const unlockForm = document.getElementById('unlock-form');
const legacyChoiceActions = document.getElementById('legacy-choice-actions');
const errorLabel = document.getElementById('form-error');
const webPanel = document.getElementById('web-panel');
const webForm = document.getElementById('web-form');
const registerForm = document.getElementById('register-form');
const webAccounts = document.getElementById('web-accounts');
const removeDialog = document.getElementById('remove-dialog');
let pendingRemoval = null;
let selected = null;
let settingPasswordForOptional = false;

function showError(message = '') { errorLabel.textContent = message; }

async function renderAccounts() {
  const accounts = await window.accounts.list();
  list.replaceChildren();
  for (const account of accounts) {
    const row = document.createElement('div');
    row.className = 'account-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'account-item';
    const avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.textContent = account.name.slice(0, 1).toUpperCase();
    const details = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = account.name;
    const hint = document.createElement('small');
    hint.textContent = account.hosted ? 'Tài khoản web · Tự đồng bộ phiên Zalo'
      : account.needsPassword ? 'Mở dữ liệu cũ • Có thể đặt mật khẩu'
      : account.requiresPassword ? 'Cần mật khẩu để mở'
        : account.hasSession ? 'Mở không cần mật khẩu' : 'Cần đăng nhập Zalo bằng mã QR';
    details.append(title, hint);
    button.append(avatar, details);
    button.addEventListener('click', () => {
      selected = account;
      settingPasswordForOptional = false;
      for (const item of list.querySelectorAll('.account-item')) item.classList.remove('selected');
      button.classList.add('selected');
      unlockPanel.hidden = false;
      createPanel.hidden = true;
      webPanel.hidden = true;
      document.getElementById('unlock-title').textContent = account.needsPassword
        ? `Mở dữ liệu của ${account.name}` : `Mở ${account.name}`;
      document.getElementById('unlock-hint').textContent = account.needsPassword
        ? 'Chọn mở ngay không cần mật khẩu, hoặc đặt mật khẩu riêng cho tài khoản này. Dữ liệu Zalo cũ vẫn được giữ lại.'
        : account.requiresPassword ? 'Nhập mật khẩu để xem tin nhắn và danh bạ.'
          : 'Bạn có thể mở ngay hoặc đặt mật khẩu riêng cho tài khoản này trước khi mở.';
      const passwordInput = document.getElementById('unlock-password');
      legacyChoiceActions.hidden = account.requiresPassword;
      unlockForm.hidden = !account.requiresPassword;
      document.getElementById('unlock-password-wrap').hidden = !account.requiresPassword;
      passwordInput.required = account.requiresPassword;
      passwordInput.placeholder = '';
      document.getElementById('initial-confirm-wrap').hidden = true;
      document.getElementById('initial-confirm').required = false;
      document.getElementById('initial-confirm').value = '';
      passwordInput.value = '';
      document.querySelector('#unlock-form button[type="submit"]').textContent = 'Mở tài khoản';
      document.getElementById('btn-cancel-password').hidden = true;
      document.getElementById('btn-skip-password').textContent = account.needsPassword
        ? 'Bỏ qua mật khẩu và mở' : 'Mở không cần mật khẩu';
      if (!account.requiresPassword) document.getElementById('btn-skip-password').focus();
      else if (account.requiresPassword) passwordInput.focus();
      else document.querySelector('#unlock-form button').focus();
      showError();
    });
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-account';
    removeButton.textContent = '×';
    removeButton.title = `Xóa ${account.name} khỏi máy này`;
    removeButton.setAttribute('aria-label', removeButton.title);
    removeButton.addEventListener('click', () => {
      pendingRemoval = account;
      document.getElementById('remove-title').textContent = `Xóa ${account.name} khỏi máy này?`;
      document.getElementById('remove-description').textContent = account.hosted
        ? 'Tin nhắn và phiên Zalo lưu trên máy này sẽ bị xóa. Tài khoản web và phiên trên máy chủ vẫn được giữ; bạn có thể đăng nhập lại sau.'
        : 'Tin nhắn, phiên Zalo và thiết lập lưu trên máy này sẽ bị xóa vĩnh viễn. Thao tác này không thể hoàn tác.';
      document.getElementById('remove-password-wrap').hidden = !account.requiresPassword;
      document.getElementById('remove-password').required = account.requiresPassword;
      document.getElementById('remove-password').value = '';
      document.getElementById('remove-error').textContent = '';
      removeDialog.showModal();
      if (account.requiresPassword) document.getElementById('remove-password').focus();
      else document.getElementById('cancel-remove').focus();
    });
    row.append(button, removeButton);
    list.append(row);
  }
  if (!accounts.length) document.getElementById('show-create').click();
}

document.getElementById('cancel-remove').addEventListener('click', () => removeDialog.close());
removeDialog.addEventListener('close', () => { pendingRemoval = null; });
document.getElementById('remove-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingRemoval) return;
  const account = pendingRemoval;
  const confirmButton = document.getElementById('confirm-remove');
  const error = document.getElementById('remove-error');
  confirmButton.disabled = true;
  error.textContent = '';
  try {
    const result = await window.accounts.remove(account.id, document.getElementById('remove-password').value);
    if (!result.success) { error.textContent = result.error; return; }
    if (selected?.id === account.id) {
      selected = null;
      unlockPanel.hidden = true;
    }
    removeDialog.close();
    await renderAccounts();
    (list.querySelector('.account-item') || document.getElementById('show-create')).focus();
  } catch (cause) { error.textContent = cause.message; }
  finally { confirmButton.disabled = false; }
});

document.getElementById('show-create').addEventListener('click', () => {
  selected = null;
  unlockPanel.hidden = true;
  createPanel.hidden = false;
  webPanel.hidden = true;
  document.getElementById('account-name').focus();
  showError();
});

document.getElementById('show-web-login').addEventListener('click', () => {
  unlockPanel.hidden = true;
  createPanel.hidden = true;
  webPanel.hidden = false;
  showWebMode('login');
  webPanel.scrollIntoView({ block: 'nearest' });
  document.getElementById('web-username').focus();
  showError();
});

function showWebMode(mode) {
  const registering = mode === 'register';
  webForm.hidden = registering;
  registerForm.hidden = !registering;
  webAccounts.hidden = true;
  document.getElementById('web-panel-title').textContent = registering ? 'Đăng ký tài khoản web' : 'Đăng nhập tài khoản web';
  document.getElementById('web-panel-hint').textContent = registering
    ? 'Đăng ký ngay trong ứng dụng. Tài khoản mới cần được quản trị viên duyệt trước khi đăng nhập.'
    : 'Nhập tài khoản website đã được quản trị viên duyệt. Phiên Zalo sẽ được tải về khi mở ứng dụng; sau lần đăng nhập QR mới, phiên sẽ tự đồng bộ lên máy chủ. Mật khẩu web không lưu trên máy này.';
  for (const [id, active] of [['show-web-signin', !registering], ['show-web-register', registering]]) {
    const button = document.getElementById(id);
    button.classList[active ? 'add' : 'remove']('active');
    button.setAttribute('aria-pressed', String(active));
  }
  document.getElementById('web-error').textContent = '';
}

document.getElementById('show-web-signin').addEventListener('click', () => {
  showWebMode('login');
  document.getElementById('web-username').focus();
});
document.getElementById('show-web-register').addEventListener('click', () => {
  showWebMode('register');
  document.getElementById('register-username').focus();
});

document.getElementById('close-web-login').addEventListener('click', () => {
  webPanel.hidden = true;
  webAccounts.hidden = true;
  document.getElementById('web-password').value = '';
  document.getElementById('register-password').value = '';
  document.getElementById('register-confirm').value = '';
  document.getElementById('web-error').textContent = '';
  document.getElementById('web-success').textContent = '';
  document.getElementById('show-web-login').focus();
});

for (const id of ['web-username', 'web-password']) {
  document.getElementById(id).addEventListener('input', () => { webAccounts.hidden = true; });
}

async function submitWebLogin(accountId = null) {
  const username = document.getElementById('web-username').value.trim();
  const passwordInput = document.getElementById('web-password');
  const error = document.getElementById('web-error');
  const submit = webForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  error.textContent = '';
  try {
    const result = await window.accounts.webLogin(username, passwordInput.value, accountId);
    if (!result.success) { error.textContent = result.error; return; }
    if (!result.accounts) { passwordInput.value = ''; return; }
    const choices = document.getElementById('web-account-list');
    choices.replaceChildren();
    for (const account of result.accounts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-item';
      button.textContent = `${account.label} · ${account.has_session ? 'Đã có phiên Zalo' : 'Cần quét QR Zalo'}`;
      button.addEventListener('click', async () => {
        button.disabled = true;
        await submitWebLogin(account.id);
        button.disabled = false;
      });
      choices.append(button);
    }
    webAccounts.hidden = false;
  } catch (cause) { error.textContent = cause.message; }
  finally { submit.disabled = false; }
}

webForm.addEventListener('submit', event => {
  event.preventDefault();
  submitWebLogin();
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  const username = document.getElementById('register-username').value.trim().toLowerCase();
  const password = document.getElementById('register-password').value;
  const confirmation = document.getElementById('register-confirm').value;
  const error = document.getElementById('web-error');
  const success = document.getElementById('web-success');
  error.textContent = '';
  success.textContent = '';
  if (password !== confirmation) { error.textContent = 'Hai mật khẩu chưa khớp'; return; }
  const button = registerForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await window.accounts.webRegister(username, password);
    if (!result.success) { error.textContent = result.error; return; }
    success.textContent = `${result.message || 'Đã gửi đăng ký; chờ admin duyệt tài khoản'}. Sau khi được duyệt, chọn Đăng nhập.`;
    document.getElementById('web-username').value = username;
    document.getElementById('register-password').value = '';
    document.getElementById('register-confirm').value = '';
  } catch (cause) { error.textContent = cause.message; }
  finally { button.disabled = false; }
});

document.getElementById('btn-set-password').addEventListener('click', () => {
  if (!selected || selected.requiresPassword) return;
  settingPasswordForOptional = !selected.needsPassword;
  legacyChoiceActions.hidden = true;
  unlockForm.hidden = false;
  document.getElementById('unlock-password-wrap').hidden = false;
  document.getElementById('initial-confirm-wrap').hidden = false;
  document.getElementById('unlock-password').required = true;
  document.getElementById('initial-confirm').required = true;
  document.querySelector('#unlock-form button[type="submit"]').textContent = 'Lưu mật khẩu và mở';
  document.getElementById('btn-cancel-password').hidden = false;
  document.getElementById('unlock-password').focus();
  showError();
});

document.getElementById('btn-cancel-password').addEventListener('click', () => {
  settingPasswordForOptional = false;
  unlockForm.hidden = true;
  legacyChoiceActions.hidden = false;
  document.getElementById('unlock-password').value = '';
  document.getElementById('initial-confirm').value = '';
  document.getElementById('btn-skip-password').focus();
  showError();
});

async function openSelected(password, button) {
  button.disabled = true;
  try {
    const result = await window.accounts.unlock(selected.id, password);
    if (!result.success) showError(result.error);
  } catch (error) { showError(error.message); }
  finally { button.disabled = false; }
}

document.getElementById('btn-skip-password').addEventListener('click', async event => {
  if (!selected || selected.requiresPassword) return;
  await openSelected('', event.currentTarget);
});

unlockForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!selected) return;
  const password = document.getElementById('unlock-password').value;
  if ((selected.needsPassword || settingPasswordForOptional) && !password) {
    showError('Nhập mật khẩu mới hoặc chọn Mở không cần mật khẩu'); return;
  }
  if ((selected.needsPassword || settingPasswordForOptional) && password !== document.getElementById('initial-confirm').value) {
    showError('Hai mật khẩu chưa khớp'); return;
  }
  if (settingPasswordForOptional) {
    const button = event.submitter;
    button.disabled = true;
    try {
      const result = await window.accounts.setPassword(selected.id, password);
      if (!result.success) { showError(result.error); return; }
      settingPasswordForOptional = false;
      selected.requiresPassword = true;
      document.getElementById('initial-confirm-wrap').hidden = true;
      document.getElementById('initial-confirm').required = false;
      document.querySelector('#unlock-form button[type="submit"]').textContent = 'Mở tài khoản';
    } catch (error) { showError(error.message); return; }
    finally { button.disabled = false; }
  }
  await openSelected(password, event.submitter);
});

document.getElementById('create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('create-password').value;
  if (password !== document.getElementById('confirm-password').value) {
    showError('Hai mật khẩu chưa khớp'); return;
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = await window.accounts.create(document.getElementById('account-name').value, password);
    if (!result.success) showError(result.error);
  } catch (error) { showError(error.message); }
  finally { button.disabled = false; }
});

renderAccounts().catch(error => showError(error.message));
