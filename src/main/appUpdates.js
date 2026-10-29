function createAppUpdates({ app, dialog, updater, getWindow, log = console }) {
  let checking = false;
  let manualCheck = false;
  let installing = false;

  const message = async options => {
    const window = getWindow();
    return window && !window.isDestroyed()
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options);
  };

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;

  updater.on('update-available', () => {
    checking = false;
    manualCheck = false;
  });

  updater.on('update-not-available', () => {
    checking = false;
    if (manualCheck) message({ type: 'info', title: 'Cập nhật NHIT Zalo',
      message: `Bạn đang dùng phiên bản mới nhất (${app.getVersion()}).`,
      buttons: ['Đóng'], noLink: true }).catch(error => log.warn('Update dialog:', error));
    manualCheck = false;
  });

  updater.on('update-downloaded', () => {
    if (installing) return;
    installing = true;
    updater.quitAndInstall(true, true);
  });

  function onError(error) {
    checking = false;
    log.warn('Không thể cập nhật từ GitHub:', error);
    if (manualCheck) message({ type: 'error', title: 'Cập nhật NHIT Zalo',
      message: 'Không thể kiểm tra hoặc tải bản cập nhật.', detail: error.message,
      buttons: ['Đóng'], noLink: true }).catch(dialogError => log.warn('Update dialog:', dialogError));
    manualCheck = false;
  }
  updater.on('error', onError);

  async function check({ manual = false } = {}) {
    if (!app.isPackaged) {
      if (manual) await message({ type: 'info', title: 'Cập nhật NHIT Zalo',
        message: 'Kiểm tra cập nhật chỉ hoạt động với bản đã cài đặt.', buttons: ['Đóng'] });
      return;
    }
    if (checking || installing) return;
    checking = true;
    manualCheck = manual;
    try { await updater.checkForUpdates(); }
    catch (error) { onError(error); }
  }

  return { check };
}

module.exports = { createAppUpdates };
