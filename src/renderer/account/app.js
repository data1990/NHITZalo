const list = document.getElementById('account-list');
const unlockPanel = document.getElementById('unlock-panel');
const createPanel = document.getElementById('create-panel');
const unlockForm = document.getElementById('unlock-form');
const legacyChoiceActions = document.getElementById('legacy-choice-actions');
const errorLabel = document.getElementById('form-error');
let selected = null;

function showError(message = '') { errorLabel.textContent = message; }

async function renderAccounts() {
  const accounts = await window.accounts.list();
  list.replaceChildren();
  for (const account of accounts) {
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
    hint.textContent = account.needsPassword ? 'Mở dữ liệu cũ • Có thể đặt mật khẩu'
      : account.requiresPassword ? 'Cần mật khẩu để mở'
        : account.hasSession ? 'Mở không cần mật khẩu' : 'Cần đăng nhập Zalo bằng mã QR';
    details.append(title, hint);
    button.append(avatar, details);
    button.addEventListener('click', () => {
      selected = account;
      for (const item of list.children) item.classList.remove('selected');
      button.classList.add('selected');
      unlockPanel.hidden = false;
      createPanel.hidden = true;
      document.getElementById('unlock-title').textContent = account.needsPassword
        ? `Mở dữ liệu của ${account.name}` : `Mở ${account.name}`;
      document.getElementById('unlock-hint').textContent = account.needsPassword
        ? 'Chọn mở ngay không cần mật khẩu, hoặc đặt mật khẩu riêng cho tài khoản này. Dữ liệu Zalo cũ vẫn được giữ lại.'
        : account.requiresPassword ? 'Nhập mật khẩu để xem tin nhắn và danh bạ.'
          : 'Tài khoản này mở không cần mật khẩu.';
      const passwordInput = document.getElementById('unlock-password');
      legacyChoiceActions.hidden = !account.needsPassword;
      unlockForm.hidden = account.needsPassword;
      document.getElementById('unlock-password-wrap').hidden = !account.requiresPassword;
      passwordInput.required = account.requiresPassword;
      passwordInput.placeholder = '';
      document.getElementById('initial-confirm-wrap').hidden = true;
      document.getElementById('initial-confirm').required = false;
      document.getElementById('initial-confirm').value = '';
      passwordInput.value = '';
      document.querySelector('#unlock-form button[type="submit"]').textContent = 'Mở tài khoản';
      document.getElementById('btn-cancel-password').hidden = true;
      if (account.needsPassword) document.getElementById('btn-skip-password').focus();
      else if (account.requiresPassword) passwordInput.focus();
      else document.querySelector('#unlock-form button').focus();
      showError();
    });
    list.append(button);
  }
  if (!accounts.length) document.getElementById('show-create').click();
}

document.getElementById('show-create').addEventListener('click', () => {
  selected = null;
  unlockPanel.hidden = true;
  createPanel.hidden = false;
  document.getElementById('account-name').focus();
  showError();
});

document.getElementById('btn-set-password').addEventListener('click', () => {
  if (!selected?.needsPassword) return;
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
  if (!selected?.needsPassword) return;
  await openSelected('', event.currentTarget);
});

unlockForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!selected) return;
  const password = document.getElementById('unlock-password').value;
  if (selected.needsPassword && !password) { showError('Nhập mật khẩu mới hoặc chọn Bỏ qua mật khẩu'); return; }
  if (selected.needsPassword && password !== document.getElementById('initial-confirm').value) {
    showError('Hai mật khẩu chưa khớp'); return;
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
