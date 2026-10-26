(function (root) {
  function setupAccountModal({ dialog, trigger, close, form }) {
    if (!dialog || !trigger || !close || !form) return;
    trigger.addEventListener('click', () => {
      if (!dialog.open) dialog.showModal();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      form.reset();
      trigger.focus();
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { setupAccountModal };
  root.AccountModal = { setupAccountModal };
})(typeof window !== 'undefined' ? window : globalThis);
