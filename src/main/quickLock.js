function requestQuickLock(account, restart) {
  if (!account?.requiresPassword) return { success: false, needsPassword: true };
  restart();
  return { success: true };
}

module.exports = { requestQuickLock };
