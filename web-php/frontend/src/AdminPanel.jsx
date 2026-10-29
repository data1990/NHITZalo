import React, { useEffect, useState } from 'react';
import { DataGridPro } from '@mui/x-data-grid-pro';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, MenuItem, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material';

const when = value => value ? String(value).replace('T', ' ').slice(0, 19) : 'Chưa có';
const status = row => row.disabled_at ? (Number(row.approved) ? 'Tạm khóa' : 'Từ chối') : Number(row.approved) ? 'Hoạt động' : 'Chờ duyệt';
const actionLabels = {
  approve_user: 'Duyệt người dùng', reject_user: 'Từ chối đăng ký', disable_user: 'Tạm khóa người dùng',
  enable_user: 'Mở lại người dùng', reset_password: 'Đặt lại mật khẩu', update_user_plan: 'Cập nhật gói cước',
  revoke_device: 'Thu hồi thiết bị', revoke_all_devices: 'Thu hồi mọi thiết bị', clear_session: 'Xóa phiên Zalo'
};
const Table = ({ rows, columns, total, page, onPage }) => <Box sx={{ overflowX: 'auto' }}><Box sx={{ minWidth: 760, height: 550 }}>
  <DataGridPro rows={rows} columns={columns} rowCount={total} pagination paginationMode="server"
    paginationModel={{ page: page - 1, pageSize: 25 }} onPaginationModelChange={model => onPage(model.page + 1)}
    pageSizeOptions={[25]} disableRowSelectionOnClick sx={{ border: 0 }} />
</Box></Box>;

export default function AdminPanel({ api, onError, onNotice, onChanged }) {
  const [tab, setTab] = useState('overview'), [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState(null), [pending, setPending] = useState([]);
  const [users, setUsers] = useState([]), [userTotal, setUserTotal] = useState(0), [userPage, setUserPage] = useState(1);
  const [userQuery, setUserQuery] = useState(''), [userFilter, setUserFilter] = useState('all');
  const [accounts, setAccounts] = useState([]), [accountTotal, setAccountTotal] = useState(0), [accountPage, setAccountPage] = useState(1);
  const [accountQuery, setAccountQuery] = useState('');
  const [events, setEvents] = useState([]), [eventTotal, setEventTotal] = useState(0), [eventPage, setEventPage] = useState(1);
  const [confirm, setConfirm] = useState(null), [deviceView, setDeviceView] = useState(null), [userView, setUserView] = useState(null);
  const [resetModal, setResetModal] = useState(null), [temporaryResult, setTemporaryResult] = useState(null);
  const [planModal, setPlanModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [debouncedUserQuery, setDebouncedUserQuery] = useState(''), [debouncedAccountQuery, setDebouncedAccountQuery] = useState('');

  useEffect(() => { const id = setTimeout(() => setDebouncedUserQuery(userQuery), 300); return () => clearTimeout(id); }, [userQuery]);
  useEffect(() => { const id = setTimeout(() => setDebouncedAccountQuery(accountQuery), 300); return () => clearTimeout(id); }, [accountQuery]);
  useEffect(() => { if (tab !== 'overview') return;
    Promise.all([api('admin-summary'), api('admin-users', 'GET', undefined, { status: 'pending', limit: 25 })])
      .then(([totals, waiting]) => { setSummary(totals); setPending(waiting.users); }).catch(error => onError(error.message));
  }, [tab, revision]);
  useEffect(() => { if (tab !== 'users') return;
    api('admin-users', 'GET', undefined, { page: userPage, limit: 25, q: debouncedUserQuery, status: userFilter })
      .then(data => { setUsers(data.users); setUserTotal(data.total); }).catch(error => onError(error.message));
  }, [tab, revision, userPage, debouncedUserQuery, userFilter]);
  useEffect(() => { if (tab !== 'accounts') return;
    api('admin-accounts', 'GET', undefined, { page: accountPage, limit: 25, q: debouncedAccountQuery })
      .then(data => { setAccounts(data.accounts); setAccountTotal(data.total); }).catch(error => onError(error.message));
  }, [tab, revision, accountPage, debouncedAccountQuery]);
  useEffect(() => { if (tab !== 'audit') return;
    api('admin-audit', 'GET', undefined, { page: eventPage, limit: 25 })
      .then(data => { setEvents(data.events); setEventTotal(data.total); }).catch(error => onError(error.message));
  }, [tab, revision, eventPage]);

  const perform = async (work, message) => {
    setBusy(true); onError('');
    try { const result = await work(); if (message) onNotice(message); setRevision(value => value + 1); await onChanged?.(); return result; }
    catch (error) { onError(error.message); return null; }
    finally { setBusy(false); }
  };
  const ask = (title, description, work, button = 'Xác nhận') => setConfirm({ title, description, work, button });
  const openDevices = async id => {
    try { setDeviceView(await api('admin-devices', 'GET', undefined, { account_id: id })); }
    catch (error) { onError(error.message); }
  };
  const openUser = async id => {
    try { setUserView(await api('admin-user-detail', 'GET', undefined, { id })); }
    catch (error) { onError(error.message); }
  };

  const userColumns = [
    { field: 'username', headerName: 'Người dùng', minWidth: 170, flex: 1, renderCell: p => <Box><Typography fontWeight={700}>{p.row.username}</Typography><Typography variant="caption" color="text.secondary">ID {p.row.id}</Typography></Box> },
    { field: 'state', headerName: 'Trạng thái', width: 140, renderCell: p => <Chip size="small" color={p.row.disabled_at ? 'error' : Number(p.row.approved) ? 'success' : 'warning'} label={status(p.row)} /> },
    { field: 'account_count', headerName: 'Zalo', width: 95, renderCell: p => <Chip size="small" variant="outlined" label={`${p.row.account_count || 0}/${p.row.max_zalo_accounts || 2}`} color={Number(p.row.account_count) >= Number(p.row.max_zalo_accounts || 2) ? 'warning' : 'default'} /> },
    { field: 'plan_tier', headerName: 'Gói cước', width: 120, renderCell: p => {
      const tier = p.row.plan_tier || 'free';
      const label = tier === 'pro' ? 'Pro' : tier === 'promax' ? 'Pro Max' : tier === 'enterprise' ? 'Doanh nghiệp' : 'Cơ bản (2)';
      const color = tier === 'enterprise' ? 'success' : tier === 'pro' || tier === 'promax' ? 'primary' : 'default';
      return <Chip size="small" label={label} color={color} />;
    }},
    { field: 'session_count', headerName: 'Phiên', width: 75 },
    { field: 'device_count', headerName: 'Thiết bị', width: 90 },
    { field: 'last_login_at', headerName: 'Đăng nhập gần nhất', width: 180, valueFormatter: value => when(value) },
    { field: 'actions', headerName: 'Thao tác', width: 440, sortable: false, renderCell: p => <Stack direction="row" spacing={0.5}>
      <Button size="small" onClick={() => openUser(p.row.id)}>Chi tiết</Button>
      {!Number(p.row.approved) && <Button size="small" onClick={() => perform(() => api('approve-user', 'POST', { id: p.row.id }), 'Đã duyệt người dùng')}>Duyệt</Button>}
      {!Number(p.row.approved) && !p.row.disabled_at && <Button size="small" color="warning" onClick={() => ask('Từ chối đăng ký', `Từ chối ${p.row.username}?`, () => api('admin-reject-user', 'POST', { id: p.row.id }), 'Từ chối')}>Từ chối</Button>}
      {Number(p.row.approved) && <Button size="small" color={p.row.disabled_at ? 'success' : 'warning'} onClick={() => ask(p.row.disabled_at ? 'Mở lại tài khoản' : 'Tạm khóa tài khoản', `${p.row.username}: ${p.row.disabled_at ? 'cho phép đăng nhập lại' : 'chặn đăng nhập và thu hồi thiết bị'}?`, () => api('admin-set-user-status', 'POST', { id: p.row.id, enabled: Boolean(p.row.disabled_at) }), p.row.disabled_at ? 'Mở lại' : 'Tạm khóa')}>{p.row.disabled_at ? 'Mở lại' : 'Tạm khóa'}</Button>}
      {Number(p.row.approved) && <Button size="small" color="info" onClick={() => setPlanModal({
        user: p.row,
        max_zalo_accounts: Number(p.row.max_zalo_accounts) || 2,
        plan_tier: p.row.plan_tier || 'free',
        plan_expires_at: p.row.plan_expires_at ? String(p.row.plan_expires_at).slice(0, 10) : ''
      })}>Gói cước</Button>}
      {Number(p.row.approved) && <Button size="small" onClick={() => setResetModal({
        user: p.row,
        mode: 'auto',
        customPassword: '',
        confirmPassword: '',
        requireReset: false,
        error: ''
      })}>Đặt lại MK</Button>}
    </Stack> }
  ];
  const accountColumns = [
    { field: 'id', headerName: 'ID', width: 75 },
    { field: 'owner', headerName: 'Chủ tài khoản', minWidth: 140, flex: 0.7 },
    { field: 'label', headerName: 'Zalo', minWidth: 175, flex: 1 },
    { field: 'zalo_uid', headerName: 'UID', width: 120, valueFormatter: value => value || '—' },
    { field: 'has_session', headerName: 'Phiên', width: 115, renderCell: p => <Chip size="small" color={Number(p.row.has_session) ? 'success' : 'default'} label={Number(p.row.has_session) ? 'Đã lưu' : 'Chưa có'} /> },
    { field: 'device_count', headerName: 'Thiết bị', width: 85 },
    { field: 'updated_at', headerName: 'Cập nhật', width: 160, valueFormatter: value => when(value) },
    { field: 'actions', headerName: 'Thao tác', width: 250, sortable: false, renderCell: p => <Stack direction="row" spacing={0.5}>
      <Button size="small" onClick={() => openDevices(p.row.id)}>Thiết bị</Button>
      <Button size="small" color="warning" onClick={() => ask('Thu hồi thiết bị', `Ngắt mọi thiết bị của ${p.row.label}? Phiên Zalo vẫn được giữ.`, () => api('admin-revoke-all-devices', 'POST', { account_id: p.row.id }), 'Thu hồi')}>Thu hồi</Button>
      <Button size="small" color="error" onClick={() => ask('Xóa phiên Zalo', `Xóa phiên ${p.row.label} và thu hồi mọi thiết bị? Người dùng cần quét QR lại.`, () => api('admin-clear-session', 'POST', { account_id: p.row.id }), 'Xóa phiên')}>Xóa phiên</Button>
    </Stack> }
  ];
  const auditColumns = [
    { field: 'created_at', headerName: 'Thời gian', width: 175, valueFormatter: value => when(value) },
    { field: 'actor', headerName: 'Admin', width: 150, valueFormatter: value => value || '—' },
    { field: 'action', headerName: 'Hành động', minWidth: 190, flex: 1, valueFormatter: value => actionLabels[value] || value },
    { field: 'target_type', headerName: 'Đối tượng', width: 115 },
    { field: 'target_id', headerName: 'ID', width: 75 },
    { field: 'detail', headerName: 'Chi tiết', minWidth: 120, flex: 1, valueFormatter: value => value || '—' }
  ];
  const metric = (label, value, onClick) => <Card sx={{ flex: '1 1 170px' }}><CardContent>
    <Typography color="text.secondary" variant="body2">{label}</Typography>
    <Typography variant="h4" fontWeight={750} sx={{ my: 1 }}>{value ?? '—'}</Typography>
    {onClick && <Button size="small" onClick={onClick}>Xem chi tiết</Button>}
  </CardContent></Card>;

  return <Stack spacing={3}>
    <Box><Typography variant="h4" fontWeight={750}>Quản trị hệ thống</Typography><Typography color="text.secondary">Quản lý người dùng, phiên Zalo và quyền thiết bị trên máy chủ.</Typography></Box>
    <Tabs value={tab} onChange={(_, value) => { setTab(value); onError(''); }} variant="scrollable" scrollButtons="auto" aria-label="Mục quản trị" sx={{ borderBottom: '1px solid #29405e' }}>
      <Tab value="overview" label="Tổng quan" /><Tab value="users" label="Người dùng" /><Tab value="accounts" label="Tài khoản Zalo" /><Tab value="audit" label="Nhật ký" />
    </Tabs>
    {tab === 'overview' && <>
      <Stack direction="row" gap={2} flexWrap="wrap">
        {metric('Người dùng hoạt động', summary?.users?.active, () => setTab('users'))}
        {metric('Chờ duyệt', summary?.users?.pending, () => { setUserFilter('pending'); setUserPage(1); setTab('users'); })}
        {metric('Tạm khóa / từ chối', summary?.users?.disabled, () => { setUserFilter('disabled'); setUserPage(1); setTab('users'); })}
        {metric('Phiên Zalo đã lưu', summary?.accounts?.with_session, () => setTab('accounts'))}
        {metric('Thiết bị còn quyền', summary?.active_devices, () => setTab('accounts'))}
      </Stack>
      <Card><CardContent><Typography variant="h6" gutterBottom>Người dùng chờ duyệt</Typography><Divider sx={{ mb: 2 }} />
        {!pending.length ? <Typography color="text.secondary">Không có đăng ký mới.</Typography> : <Stack spacing={1}>
          {pending.map(item => <Stack key={item.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ py: 1, borderBottom: '1px solid #29405e' }}>
            <Typography sx={{ flexGrow: 1 }}><strong>{item.username}</strong> · {when(item.created_at)}</Typography>
            <Button size="small" variant="contained" onClick={() => perform(() => api('approve-user', 'POST', { id: item.id }), 'Đã duyệt người dùng')}>Duyệt</Button>
            <Button size="small" color="warning" onClick={() => ask('Từ chối đăng ký', `Từ chối ${item.username}?`, () => api('admin-reject-user', 'POST', { id: item.id }), 'Từ chối')}>Từ chối</Button>
          </Stack>)}
        </Stack>}
      </CardContent></Card>
    </>}
    {tab === 'users' && <Card><CardContent>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField label="Tìm tên đăng nhập" value={userQuery} onChange={e => { setUserQuery(e.target.value); setUserPage(1); }} sx={{ flexGrow: 1 }} />
        <TextField select label="Trạng thái" value={userFilter} onChange={e => { setUserFilter(e.target.value); setUserPage(1); }} sx={{ minWidth: 175 }}>
          <MenuItem value="all">Tất cả</MenuItem><MenuItem value="pending">Chờ duyệt</MenuItem><MenuItem value="active">Hoạt động</MenuItem><MenuItem value="disabled">Tạm khóa / từ chối</MenuItem>
        </TextField>
      </Stack><Table rows={users} columns={userColumns} total={userTotal} page={userPage} onPage={setUserPage} />
    </CardContent></Card>}
    {tab === 'accounts' && <Card><CardContent>
      <TextField fullWidth label="Tìm tài khoản Zalo hoặc người sở hữu" value={accountQuery} onChange={e => { setAccountQuery(e.target.value); setAccountPage(1); }} sx={{ mb: 2 }} />
      <Table rows={accounts} columns={accountColumns} total={accountTotal} page={accountPage} onPage={setAccountPage} />
    </CardContent></Card>}
    {tab === 'audit' && <Card><CardContent><Table rows={events} columns={auditColumns} total={eventTotal} page={eventPage} onPage={setEventPage} /></CardContent></Card>}

    <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{confirm?.title}</DialogTitle><DialogContent><Typography>{confirm?.description}</Typography></DialogContent>
      <DialogActions><Button onClick={() => setConfirm(null)}>Hủy</Button><Button variant="contained" color="warning" disabled={busy} onClick={async () => {
        const task = confirm.work; const title = confirm.title; setConfirm(null); await perform(task, `Đã thực hiện: ${title}`);
      }}>{confirm?.button}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(resetModal)} onClose={() => setResetModal(null)} maxWidth="sm" fullWidth>
      <DialogTitle>Đặt lại mật khẩu · {resetModal?.user?.username}</DialogTitle>
      <DialogContent>
        {resetModal?.error && <Alert severity="error" sx={{ mb: 2 }}>{resetModal.error}</Alert>}
        <Tabs value={resetModal?.mode || 'auto'} onChange={(_, val) => setResetModal(prev => ({ ...prev, mode: val, error: '' }))} sx={{ mb: 2, borderBottom: '1px solid #29405e' }}>
          <Tab value="auto" label="Tự động cập nhật" />
          <Tab value="custom" label="Tự đặt mật khẩu" />
        </Tabs>
        {resetModal?.mode === 'auto' ? (
          <Stack spacing={2}>
            <Alert severity="info">
              Hệ thống sẽ tự động tạo một mật khẩu tạm ngẫu nhiên an toàn (24 ký tự) và yêu cầu người dùng phải đổi mật khẩu khi đăng nhập website.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Lưu ý: Mọi thiết bị Electron và phiên đăng nhập trước đó của người dùng này sẽ bị thu hồi quyền truy cập.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">
              Tự nhập mật khẩu mới cho người dùng. Thiết bị Electron cũ của họ sẽ bị thu hồi quyền truy cập.
            </Alert>
            <TextField
              label="Mật khẩu mới"
              type="password"
              fullWidth
              value={resetModal?.customPassword || ''}
              onChange={e => setResetModal(prev => ({ ...prev, customPassword: e.target.value, error: '' }))}
              helperText="Ít nhất 12 ký tự"
              required
            />
            <TextField
              label="Xác nhận mật khẩu mới"
              type="password"
              fullWidth
              value={resetModal?.confirmPassword || ''}
              onChange={e => setResetModal(prev => ({ ...prev, confirmPassword: e.target.value, error: '' }))}
              required
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={Boolean(resetModal?.requireReset)}
                  onChange={e => setResetModal(prev => ({ ...prev, requireReset: e.target.checked }))}
                />
              }
              label="Yêu cầu người dùng đổi mật khẩu ở lần đăng nhập tiếp theo"
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setResetModal(null)}>Hủy</Button>
        <Button
          variant="contained"
          color="warning"
          disabled={busy}
          onClick={async () => {
            if (resetModal.mode === 'custom') {
              if ((resetModal.customPassword || '').length < 12) {
                setResetModal(prev => ({ ...prev, error: 'Mật khẩu mới cần ít nhất 12 ký tự' }));
                return;
              }
              if (resetModal.customPassword !== resetModal.confirmPassword) {
                setResetModal(prev => ({ ...prev, error: 'Hai mật khẩu mới chưa khớp nhau' }));
                return;
              }
            }
            const targetUser = resetModal.user;
            const mode = resetModal.mode;
            const customPass = resetModal.customPassword;
            const requireReset = resetModal.requireReset;
            const res = await perform(async () => {
              return await api('admin-reset-password', 'POST', {
                id: targetUser.id,
                mode,
                password: mode === 'custom' ? customPass : undefined,
                require_reset: mode === 'custom' ? (requireReset ? 1 : 0) : 1
              });
            }, mode === 'custom' ? `Đã đặt mật khẩu mới cho ${targetUser.username}` : `Đã tạo mật khẩu tạm tự động cho ${targetUser.username}`);

            if (res && res.temporary_password) {
              setResetModal(null);
              setTemporaryResult({
                username: targetUser.username,
                password: res.temporary_password,
                mode: res.mode || mode,
                reset_required: res.reset_required
              });
            }
          }}
        >
          {resetModal?.mode === 'auto' ? 'Tự động cập nhật' : 'Lưu mật khẩu'}
        </Button>
      </DialogActions>
    </Dialog>
    <Dialog open={Boolean(temporaryResult)} onClose={() => setTemporaryResult(null)} maxWidth="sm" fullWidth>
      <DialogTitle>
        {temporaryResult?.mode === 'auto' ? 'Mật khẩu tạm tự động mới' : 'Mật khẩu mới của người dùng'} · {temporaryResult?.username}
      </DialogTitle>
      <DialogContent>
        <Alert severity={temporaryResult?.reset_required ? 'warning' : 'success'} sx={{ mb: 2 }}>
          {temporaryResult?.reset_required
            ? 'Mật khẩu chỉ hiển thị một lần. Người dùng bắt buộc phải đổi mật khẩu trên website trước khi đăng nhập Electron.'
            : 'Đã cập nhật mật khẩu thành công. Bạn có thể sao chép mật khẩu dưới đây để gửi cho người dùng.'}
        </Alert>
        <TextField fullWidth label="Mật khẩu" value={temporaryResult?.password || ''} InputProps={{ readOnly: true }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => navigator.clipboard.writeText(temporaryResult?.password || '')}>Sao chép</Button>
        <Button variant="contained" onClick={() => setTemporaryResult(null)}>Đã xong</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={Boolean(deviceView)} onClose={() => setDeviceView(null)} maxWidth="md" fullWidth>
      <DialogTitle>Thiết bị · {deviceView?.account?.label}</DialogTitle><DialogContent dividers>
        <Typography color="text.secondary" sx={{ mb: 2 }}>Người sở hữu: {deviceView?.account?.owner}. Mã truy cập không hiển thị.</Typography>
        {!deviceView?.devices?.length ? <Typography>Chưa có thiết bị.</Typography> : <Stack spacing={1}>
          {deviceView.devices.map(device => <Stack key={device.id} direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={1} sx={{ p: 1.5, border: '1px solid #29405e', borderRadius: 1 }}>
            <Box sx={{ flexGrow: 1 }}><Typography fontWeight={650}>Thiết bị #{device.id} <Chip size="small" sx={{ ml: 1 }} color={device.revoked_at ? 'default' : 'success'} label={device.revoked_at ? 'Đã thu hồi' : 'Còn quyền'} /></Typography>
              <Typography variant="caption" color="text.secondary">Tạo: {when(device.created_at)} · Dùng gần nhất: {when(device.last_used_at)}</Typography></Box>
            {!device.revoked_at && <Button size="small" color="warning" onClick={() => ask('Thu hồi thiết bị', `Ngắt thiết bị #${device.id}?`, async () => {
              await api('admin-revoke-device', 'POST', { id: device.id });
              setDeviceView(await api('admin-devices', 'GET', undefined, { account_id: deviceView.account.id }));
            }, 'Thu hồi')}>Thu hồi</Button>}
          </Stack>)}
        </Stack>}
      </DialogContent><DialogActions><Button onClick={() => setDeviceView(null)}>Đóng</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(userView)} onClose={() => setUserView(null)} maxWidth="md" fullWidth>
      <DialogTitle>Người dùng · {userView?.user?.username}</DialogTitle><DialogContent dividers>
        {userView && <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip label={status(userView.user)} color={userView.user.disabled_at ? 'error' : Number(userView.user.approved) ? 'success' : 'warning'} size="small" />
            {Number(userView.user.reset_required) === 1 && <Chip label="Cần đổi mật khẩu" color="warning" size="small" />}
            <Chip label={`Gói ${userView.user.plan_tier || 'free'} (Tối đa: ${userView.user.max_zalo_accounts || 2} Zalo)`} color="primary" size="small" variant="outlined" />
            {userView.user.plan_expires_at && <Chip label={`Hết hạn: ${when(userView.user.plan_expires_at)}`} size="small" />}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1}>
            <Typography>Đăng ký: {when(userView.user.created_at)} · Đăng nhập gần nhất: {when(userView.user.last_login_at)}</Typography>
            <Button variant="outlined" size="small" onClick={() => {
              const u = userView.user;
              setUserView(null);
              setPlanModal({
                user: u,
                max_zalo_accounts: Number(u.max_zalo_accounts) || 2,
                plan_tier: u.plan_tier || 'free',
                plan_expires_at: u.plan_expires_at ? String(u.plan_expires_at).slice(0, 10) : ''
              });
            }}>Thay đổi gói cước</Button>
          </Stack>
          <Divider /><Typography variant="h6">Tài khoản Zalo ({userView.accounts.length}/{userView.user.max_zalo_accounts || 2})</Typography>
          {!userView.accounts.length ? <Typography color="text.secondary">Chưa có tài khoản Zalo.</Typography> : userView.accounts.map(account => <Stack key={account.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ p: 1.5, border: '1px solid #29405e', borderRadius: 1 }}>
            <Box sx={{ flexGrow: 1 }}><Typography fontWeight={650}>{account.label}</Typography><Typography variant="caption" color="text.secondary">UID: {account.zalo_uid || 'Chưa có'} · {account.device_count} thiết bị · Cập nhật: {when(account.updated_at)}</Typography></Box>
            <Chip size="small" color={Number(account.has_session) ? 'success' : 'default'} label={Number(account.has_session) ? 'Đã lưu phiên' : 'Chưa có phiên'} />
            <Button size="small" onClick={() => { setUserView(null); openDevices(account.id); }}>Thiết bị</Button>
          </Stack>)}
        </Stack>}
      </DialogContent><DialogActions><Button onClick={() => setUserView(null)}>Đóng</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(planModal)} onClose={() => setPlanModal(null)} maxWidth="sm" fullWidth>
      <DialogTitle>Quản lý gói cước · {planModal?.user?.username}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            Điều chỉnh số lượng tài khoản Zalo tối đa và hạng gói cho người dùng này.
          </Typography>
          <TextField
            select
            fullWidth
            label="Chọn gói cước mẫu"
            value={planModal?.plan_tier || 'free'}
            onChange={e => {
              const tier = e.target.value;
              let defaultMax = 2;
              if (tier === 'pro') defaultMax = 5;
              else if (tier === 'promax') defaultMax = 10;
              else if (tier === 'enterprise') defaultMax = 50;
              setPlanModal(prev => ({ ...prev, plan_tier: tier, max_zalo_accounts: defaultMax }));
            }}
          >
            <MenuItem value="free">Gói Cơ Bản (2 tài khoản)</MenuItem>
            <MenuItem value="pro">Gói Pro (5 tài khoản)</MenuItem>
            <MenuItem value="promax">Gói Pro Max (10 tài khoản)</MenuItem>
            <MenuItem value="enterprise">Gói Doanh Nghiệp (50 tài khoản)</MenuItem>
            <MenuItem value="custom">Tùy chỉnh</MenuItem>
          </TextField>
          <TextField
            fullWidth
            type="number"
            label="Số tài khoản Zalo tối đa"
            value={planModal?.max_zalo_accounts || 2}
            onChange={e => setPlanModal(prev => ({ ...prev, max_zalo_accounts: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
            inputProps={{ min: 1, max: 1000 }}
            helperText="Mặc định: 2 tài khoản. Người dùng chỉ được lưu tối đa số lượng này."
          />
          <TextField
            fullWidth
            type="date"
            label="Ngày hết hạn gói (để trống nếu vĩnh viễn)"
            value={planModal?.plan_expires_at || ''}
            onChange={e => setPlanModal(prev => ({ ...prev, plan_expires_at: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPlanModal(null)}>Hủy</Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={async () => {
            const target = planModal.user;
            await perform(async () => {
              await api('admin-set-user-plan', 'POST', {
                id: target.id,
                max_zalo_accounts: planModal.max_zalo_accounts,
                plan_tier: planModal.plan_tier,
                plan_expires_at: planModal.plan_expires_at ? `${planModal.plan_expires_at} 23:59:59` : ''
              });
            }, `Đã cập nhật gói cước cho ${target.username} (tối đa ${planModal.max_zalo_accounts} tài khoản)`);
            setPlanModal(null);
          }}
        >
          Lưu gói cước
        </Button>
      </DialogActions>
    </Dialog>
  </Stack>;
}
