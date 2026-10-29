import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LicenseInfo } from '@mui/x-license';
import { Alert, AppBar, Box, Button, Card, CardContent, Chip, Container, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, TextField, ThemeProvider, Toolbar, Typography, createTheme } from '@mui/material';
import AdminPanel from './AdminPanel.jsx';

if (import.meta.env.VITE_MUI_LICENSE_KEY) LicenseInfo.setLicenseKey(import.meta.env.VITE_MUI_LICENSE_KEY);
const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#1686ff' }, background: { default: '#091322', paper: '#14233a' } }, shape: { borderRadius: 12 }, typography: { fontFamily: 'Inter, system-ui, sans-serif' } });
let csrf = '';
async function api(action, method = 'GET', body, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`/api.php?${query}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  let value;
  try { value = await response.json(); } catch { throw new Error('Máy chủ chưa chạy PHP hoặc trả về HTML. Kiểm tra document root và PHP trong aaPanel.'); }
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  if (value.csrf) csrf = value.csrf;
  return value;
}

function App() {
  const [user, setUser] = useState(null), [mode, setMode] = useState('login');
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [plan, setPlan] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [label, setLabel] = useState(''), [codes, setCodes] = useState({});
  const [currentPassword, setCurrentPassword] = useState(''), [nextPassword, setNextPassword] = useState(''), [repeatPassword, setRepeatPassword] = useState('');
  const refresh = async current => {
    const owner = current || user;
    if (!owner) return;
    if (!Number(owner.reset_required)) {
      const res = await api('accounts');
      setAccounts(res.accounts);
      setPlan(res.plan || {
        tier: owner.plan_tier || 'free',
        max_accounts: Number(owner.max_zalo_accounts) || 2,
        current_accounts: res.accounts.length,
        can_create: res.accounts.length < (Number(owner.max_zalo_accounts) || 2)
      });
    }
  };
  useEffect(() => { api('me').then(data => { setUser(data.user); refresh(data.user); }).catch(() => {}); }, []);
  const run = async work => { setError(''); setNotice(''); try { await work(); } catch (e) { setError(e.message); } };
  const submit = event => { event.preventDefault(); run(async () => {
    const result = await api(mode === 'login' ? 'login' : 'register', 'POST', { username, password });
    if (mode === 'login') { setUser(result.user); setPassword(''); await refresh(result.user); }
    else { setMode('login'); setNotice('Đã đăng ký. Hãy chờ admin duyệt tài khoản.'); setPassword(''); }
  }); };
  const changePassword = event => { event.preventDefault();
    if (nextPassword !== repeatPassword) { setError('Hai mật khẩu mới chưa khớp'); return; }
    run(async () => {
      await api('change-password', 'POST', { current_password: currentPassword, new_password: nextPassword });
      setCurrentPassword(''); setNextPassword(''); setRepeatPassword('');
      const updated = { ...user, reset_required: 0 }; setUser(updated); await refresh(updated);
      setNotice('Đã đổi mật khẩu. Thiết bị Electron cũ cần đăng nhập web lại.');
    });
  };
  return <ThemeProvider theme={theme}><CssBaseline />
    <AppBar position="static" elevation={0} sx={{ borderBottom: '1px solid #29405e', bgcolor: '#101e33' }}><Toolbar><Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 750 }}>NHIT Zalo Web</Typography>{user && <><Chip label={`${user.username} · ${user.role}`} size="small" sx={{ mr: 2 }} /><Button color="inherit" onClick={() => run(async () => { await api('logout', 'POST'); setUser(null); setAccounts([]); setPlan(null); })}>Đăng xuất</Button></>}</Toolbar></AppBar>
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 5 } }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}{notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
      {!user ? <Card sx={{ maxWidth: 440, mx: 'auto', mt: 6 }}><CardContent sx={{ p: 4 }}><Typography variant="h4" fontWeight={750} gutterBottom>{mode === 'login' ? 'Đăng nhập' : 'Đăng ký tài khoản'}</Typography><Typography color="text.secondary" sx={{ mb: 3 }}>Quản lý phiên Zalo trên hosting PHP và MySQL.</Typography><Stack component="form" onSubmit={submit} spacing={2}><TextField label="Tên đăng nhập" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" /><TextField label="Mật khẩu" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} helperText={mode === 'register' ? 'Ít nhất 12 ký tự' : ''} /><Button variant="contained" type="submit" size="large">{mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}</Button><Button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Tạo tài khoản' : 'Đã có tài khoản'}</Button></Stack></CardContent></Card>
      : <Stack spacing={3}>
        {Number(user.reset_required) ? <Alert severity="warning">Admin đã đặt lại mật khẩu. Hãy đổi mật khẩu tạm trước khi tiếp tục.</Alert> : null}
        {user.role === 'admin' && !Number(user.reset_required) && <AdminPanel api={api} onError={setError} onNotice={setNotice} onChanged={() => refresh()} />}
        {!Number(user.reset_required) && <>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}>
          <Box><Typography variant="h4" fontWeight={750}>Tài khoản Zalo</Typography><Typography color="text.secondary">Tạo mã ghép nối trên web rồi nhập mã vào Electron. Phiên được lưu mã hóa trong MySQL.</Typography></Box>
          {plan && <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip label={`Hạn mức: ${accounts.length}/${plan.max_accounts} tài khoản`} color={accounts.length >= plan.max_accounts ? 'warning' : 'primary'} variant="outlined" />
            <Chip label={`Gói ${plan.tier === 'pro' ? 'Pro' : plan.tier === 'enterprise' ? 'Doanh Nghiệp' : 'Cơ Bản (2)'}`} color={plan.tier === 'free' ? 'default' : 'success'} />
            {accounts.length >= plan.max_accounts && <Button variant="contained" color="warning" size="small" onClick={() => setUpgradeOpen(true)}>Nâng cấp gói</Button>}
          </Stack>}
        </Box>
        {plan && !plan.can_create ? (
          <Alert severity="warning" sx={{ alignItems: 'center' }} action={
            <Button color="inherit" size="small" variant="outlined" onClick={() => setUpgradeOpen(true)}>
              Nâng cấp gói ngay
            </Button>
          }>
            Bạn đã dùng hết hạn mức <strong>{plan.max_accounts}/{plan.max_accounts} tài khoản Zalo</strong> của gói hiện tại ({plan.tier === 'free' ? 'Gói Cơ Bản Miễn Phí' : plan.tier.toUpperCase()}). Vui lòng nâng cấp gói để lưu thêm tài khoản Zalo.
          </Alert>
        ) : (
          <Card><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} component="form" onSubmit={e => { e.preventDefault(); run(async () => { await api('create-account', 'POST', { label }); setLabel(''); await refresh(); }); }}><TextField fullWidth label="Tên gợi nhớ tài khoản Zalo" value={label} onChange={e => setLabel(e.target.value)} helperText={plan ? `Còn trống ${Math.max(0, plan.max_accounts - accounts.length)} slot` : ''} /><Button type="submit" variant="contained" sx={{ minWidth: 170 }}>Thêm tài khoản</Button></Stack></CardContent></Card>
        )}
        {accounts.map(account => <Card key={account.id}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}><Box><Typography variant="h6">{account.label}</Typography><Chip size="small" color={Number(account.has_session) ? 'success' : 'default'} label={Number(account.has_session) ? 'Đã lưu phiên' : 'Chưa có phiên'} /><Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>Cập nhật: {account.updated_at || 'Chưa có'}</Typography></Box><Stack spacing={1} alignItems={{ sm: 'flex-end' }}><Button variant="outlined" onClick={() => run(async () => { const result = await api('device-code', 'POST', { account_id: account.id }); setCodes(previous => ({ ...previous, [account.id]: result.code })); })}>Tạo mã ghép nối</Button><Button color="warning" onClick={() => run(async () => { await api('revoke-devices', 'POST', { account_id: account.id }); setNotice('Đã thu hồi các thiết bị của tài khoản này'); })}>Thu hồi thiết bị</Button>{codes[account.id] && <Alert severity="info">{codes[account.id]} · Hết hạn sau 10 phút</Alert>}</Stack></Stack></CardContent></Card>)}
        </>}
        <Card sx={{ maxWidth: 620 }}><CardContent><Typography variant="h6" gutterBottom>{Number(user.reset_required) ? 'Đổi mật khẩu tạm' : 'Bảo mật tài khoản web'}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>Đổi mật khẩu sẽ thu hồi quyền các thiết bị Electron cũ.</Typography>
          <Stack component="form" onSubmit={changePassword} spacing={2}>
            <TextField label="Mật khẩu hiện tại" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
            <TextField label="Mật khẩu mới" type="password" value={nextPassword} onChange={e => setNextPassword(e.target.value)} autoComplete="new-password" inputProps={{ minLength: 12 }} helperText="Ít nhất 12 ký tự" required />
            <TextField label="Nhập lại mật khẩu mới" type="password" value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} autoComplete="new-password" required />
            <Button variant="contained" type="submit">Lưu mật khẩu mới</Button>
          </Stack></CardContent></Card>
      </Stack>}
      <Dialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 750 }}>Nâng cấp gói tài khoản NHIT Zalo</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Mỗi tài khoản miễn phí mặc định được lưu <strong>2 tài khoản Zalo</strong>. Để nâng hạn mức lưu trữ và sử dụng nhiều tài khoản cùng lúc trên máy tính, vui lòng tham khảo các gói sau:
            </Typography>
            <Stack spacing={1.5}>
              <Card variant="outlined" sx={{ p: 2, borderColor: '#29405e', bgcolor: '#0d1826' }}>
                <Typography variant="subtitle1" fontWeight={750} color="primary">Gói Cơ Bản (Mặc định)</Typography>
                <Typography variant="body2" color="text.secondary">Tối đa <strong>2 tài khoản Zalo</strong> · Miễn phí trọn đời</Typography>
              </Card>
              <Card variant="outlined" sx={{ p: 2, borderColor: '#1686ff', bgcolor: '#12253f' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle1" fontWeight={750} color="#60a5fa">Gói Pro (5 Tài Khoản)</Typography>
                  <Chip size="small" color="primary" label="Phổ biến" />
                </Stack>
                <Typography variant="body2" color="text.secondary">Lưu tối đa <strong>5 tài khoản Zalo</strong> · Đồng bộ phiên đám mây siêu tốc</Typography>
              </Card>
              <Card variant="outlined" sx={{ p: 2, borderColor: '#29405e', bgcolor: '#0d1826' }}>
                <Typography variant="subtitle1" fontWeight={750} color="#a78bfa">Gói Pro Max (10 Tài Khoản)</Typography>
                <Typography variant="body2" color="text.secondary">Lưu tối đa <strong>10 tài khoản Zalo</strong> · Phù hợp đội nhóm kinh doanh</Typography>
              </Card>
              <Card variant="outlined" sx={{ p: 2, borderColor: '#29405e', bgcolor: '#0d1826' }}>
                <Typography variant="subtitle1" fontWeight={750} color="#34d399">Gói Doanh Nghiệp (Không Giới Hạn)</Typography>
                <Typography variant="body2" color="text.secondary">Số lượng tài khoản theo nhu cầu · Hỗ trợ ưu tiên 24/7</Typography>
              </Card>
            </Stack>
            <Alert severity="info">
              Để nâng cấp hoặc gia hạn gói, hãy liên hệ trực tiếp với <strong>Quản trị viên (Admin)</strong> để được kích hoạt ngay lập tức.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setUpgradeOpen(false)}>Đã hiểu</Button>
        </DialogActions>
      </Dialog>
    </Container>
  </ThemeProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
