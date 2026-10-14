/*
 * リポジトリ層（SPEC 8章）
 *
 * データの読み書きはすべてこのファイルを経由する。
 * 保存先を変える（Supabase など）ときは、下の「アダプタ」を差し替えるだけで
 * 画面側のコードは変えずに済むようにしている。
 *
 * 画面側から使う API（すべて Promise を返す）:
 *   Repository.notes.list()          ノート一覧（更新日時の新しい順）
 *   Repository.notes.get(id)         1件取得（無ければ null）
 *   Repository.notes.save(note)      作成または更新。保存後のノートを返す
 *   Repository.notes.delete(id)
 *   Repository.library.list() / get(id) / save(item) / delete(id)
 *   Repository.storageName           現在の保存先の表示名
 */
(function (global) {
  'use strict';

  var DB_NAME = 'lab-notebook';
  var DB_VERSION = 1;
  var STORES = ['notes', 'library'];

  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  /* ---------- アダプタ: IndexedDB（開発中の既定） ---------- */

  function createIndexedDbAdapter() {
    var dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB が使えません'));
        return;
      }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });

    function run(store, mode, fn) {
      return dbPromise.then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(store, mode);
          var req = fn(tx.objectStore(store));
          tx.oncomplete = function () { resolve(req ? req.result : undefined); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error); };
        });
      });
    }

    return {
      name: 'ブラウザ内保存（IndexedDB）',
      ready: dbPromise.then(function () {}),
      getAll: function (store) { return run(store, 'readonly', function (s) { return s.getAll(); }); },
      get: function (store, id) {
        return run(store, 'readonly', function (s) { return s.get(id); })
          .then(function (v) { return v === undefined ? null : v; });
      },
      put: function (store, value) { return run(store, 'readwrite', function (s) { return s.put(value); }); },
      remove: function (store, id) { return run(store, 'readwrite', function (s) { return s.delete(id); }); }
    };
  }

  /* ---------- アダプタ: メモリ（IndexedDB が使えないときの退避先） ---------- */

  function createMemoryAdapter() {
    var data = {};
    STORES.forEach(function (name) { data[name] = {}; });
    return {
      name: '一時保存（ページを閉じると消えます）',
      ready: Promise.resolve(),
      getAll: function (store) {
        return Promise.resolve(Object.keys(data[store]).map(function (k) { return clone(data[store][k]); }));
      },
      get: function (store, id) {
        return Promise.resolve(id in data[store] ? clone(data[store][id]) : null);
      },
      put: function (store, value) { data[store][value.id] = clone(value); return Promise.resolve(); },
      remove: function (store, id) { delete data[store][id]; return Promise.resolve(); }
    };
  }

  /* ---------- 既定値（SPEC 8章のデータモデル） ---------- */

  function todayString() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function newNote() {
    return {
      id: null,
      date: todayString(),
      experimenter: '',
      memo: '',
      scheme: { cdxml_original: null, mol: null, smiles: null },
      reagents: [],
      steps: [],
      text_ja: '',
      text_en: '',
      text_edited: false,
      created_at: null,
      updated_at: null
    };
  }

  function newLibraryItem() {
    return {
      id: null,
      kind: 'reagent',
      name_ja: '',
      name_en: '',
      abbreviation: '',
      cas: '',
      compound_no: '',
      mw: null,
      density: null,
      purity: null,
      concentration_M: null,
      conc_solvent: '',
      structure: { mol: null, cdxml: null },
      favorite: false,
      last_used_at: null,
      created_at: null
    };
  }

  /* ---------- 公開 API ---------- */

  function buildRepository(adapter) {
    function saveRecord(store, record, touchUpdated) {
      var now = new Date().toISOString();
      var copy = clone(record);
      if (!copy.id) copy.id = newId();
      if (!copy.created_at) copy.created_at = now;
      if (touchUpdated) copy.updated_at = now;
      return adapter.put(store, copy).then(function () { return clone(copy); });
    }

    return {
      storageName: adapter.name,
      ready: adapter.ready,
      newNote: newNote,
      newLibraryItem: newLibraryItem,
      notes: {
        list: function () {
          return adapter.getAll('notes').then(function (rows) {
            return rows.sort(function (a, b) {
              return (b.updated_at || '').localeCompare(a.updated_at || '');
            });
          });
        },
        get: function (id) { return adapter.get('notes', id); },
        save: function (note) { return saveRecord('notes', note, true); },
        delete: function (id) { return adapter.remove('notes', id); }
      },
      library: {
        list: function () { return adapter.getAll('library'); },
        get: function (id) { return adapter.get('library', id); },
        save: function (item) { return saveRecord('library', item, false); },
        delete: function (id) { return adapter.remove('library', id); }
      }
    };
  }

  // IndexedDB を開けなければメモリ保存に切り替える
  var repo = buildRepository(createIndexedDbAdapter());
  global.Repository = repo;
  global.RepositoryReady = repo.ready.then(
    function () { return global.Repository; },
    function (err) {
      console.warn('IndexedDB を開けなかったため一時保存に切り替えます:', err);
      global.Repository = buildRepository(createMemoryAdapter());
      return global.Repository;
    }
  );
})(window);
