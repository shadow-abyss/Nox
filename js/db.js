/* Project NOX — local storage layer.
   Everything lives in IndexedDB on this device. No network, no accounts, no sync. */
(function () {
  'use strict';

  const DB_NAME = 'nox';
  const DB_VER = 1;
  const STORE = 'docs';

  let _open = null;

  function openDB() {
    if (_open) return _open;
    _open = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('updatedAt', 'updatedAt');
          s.createIndex('kind', 'kind');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is blocked by another NOX tab.'));
    });
    return _open;
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function store(mode) {
    const db = await openDB();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  const NoxDB = {
    async put(doc) {
      const s = await store('readwrite');
      await wrap(s.put(doc));
      return doc;
    },

    async bulkPut(docs) {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      docs.forEach((d) => s.put(d));
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(docs.length);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },

    async get(id) {
      const s = await store('readonly');
      return wrap(s.get(id));
    },

    async all() {
      const s = await store('readonly');
      const rows = await wrap(s.getAll());
      return rows || [];
    },

    async remove(id) {
      const s = await store('readwrite');
      return wrap(s.delete(id));
    },

    async clear() {
      const s = await store('readwrite');
      return wrap(s.clear());
    },

    async estimate() {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      try { return await navigator.storage.estimate(); } catch (e) { return null; }
    },

    async persist() {
      if (!navigator.storage || !navigator.storage.persist) return false;
      try { return await navigator.storage.persist(); } catch (e) { return false; }
    }
  };

  window.NoxDB = NoxDB;
})();
