(function (root) {
  function createAccountStorage(storage, accountId, migrateLegacy = false) {
    if (!accountId) return storage;
    const scopedKey = key => `nhitzalo.account.${accountId}.${key}`;
    return {
      getItem(key) {
        const scoped = storage.getItem(scopedKey(key));
        if (scoped !== null || !migrateLegacy) return scoped;
        const old = storage.getItem(key);
        if (old !== null) storage.setItem(scopedKey(key), old);
        return old;
      },
      setItem(key, value) { storage.setItem(scopedKey(key), value); },
      removeItem(key) { storage.removeItem(scopedKey(key)); }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createAccountStorage };
  root.createAccountStorage = createAccountStorage;
})(typeof window !== 'undefined' ? window : globalThis);
