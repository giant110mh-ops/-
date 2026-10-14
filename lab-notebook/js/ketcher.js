/*
 * Ketcher（構造式エディタ）の呼び出し（SPEC 6章）
 *   LN.ketcher.open(initialText, onSave({ mol, cdxml }))
 * Ketcher 本体（vendor/ketcher/ketcher.js, 約18MB）は、初めて開くときに読み込む。
 * Ketcher は「表示と軽い修正」用。清書は ChemDraw で行う。
 */
(function (global) {
  'use strict';

  var LN = global.LN;
  var h = LN.h;
  var loading = null;

  function load() {
    if (global.KetcherBundle) return Promise.resolve(global.KetcherBundle);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var css = h('link', { rel: 'stylesheet', href: 'vendor/ketcher/ketcher.css' });
      document.head.append(css);
      var s = h('script', { src: 'vendor/ketcher/ketcher.js' });
      s.onload = function () { global.KetcherBundle ? resolve(global.KetcherBundle) : reject(new Error('Ketcher を初期化できませんでした')); };
      s.onerror = function () { reject(new Error('Ketcher のファイル（vendor/ketcher/ketcher.js）が見つかりません')); };
      document.head.append(s);
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  function open(initial, onSave) {
    var host = h('div', { class: 'ketcher-host' }, h('p', { class: 'loading ketcher-loading' }, 'Ketcher を読み込んでいます…（初回は数秒かかります）'));
    var instance = null;
    var modal = LN.openModal({
      title: 'Ketcher で編集',
      body: host,
      size: 'full',
      sticky: true,
      onClose: function () { if (instance) instance.unmount(); },
      actions: [
        { label: 'キャンセル', kind: 'ghost' },
        { label: 'ノートに保存', kind: 'primary', onClick: function (close) {
          if (!instance) return false;
          var k = instance.ketcher;
          var getMol = k.containsReaction && k.containsReaction() ? k.getRxn() : k.getMolfile();
          Promise.resolve(getMol).then(function (mol) {
            var cdxml = typeof k.getCDXml === 'function' ? Promise.resolve(k.getCDXml()).catch(function () { return null; }) : Promise.resolve(null);
            return cdxml.then(function (c) {
              close();
              onSave({ mol: mol, cdxml: c });
            });
          }).catch(function (e) {
            console.error(e);
            LN.toast('構造を取り出せませんでした', 'danger');
          });
          return false;
        } }
      ]
    });

    load().then(function (bundle) {
      host.replaceChildren();
      var el = h('div', { class: 'ketcher-root' });
      host.append(el);
      return bundle.mount(el);
    }).then(function (inst) {
      instance = inst;
      if (initial && String(initial).trim()) {
        return Promise.resolve(inst.ketcher.setMolecule(initial)).catch(function (e) {
          console.error(e);
          LN.toast('この構造は Ketcher で読み込めませんでした', 'danger');
        });
      }
    }).catch(function (e) {
      host.replaceChildren(h('div', { class: 'empty' },
        h('p', null, e.message),
        h('p', { class: 'faint small' }, 'フォルダ版（lab-notebook フォルダ一式）の index.html から開くと使えます。')));
    });
    return modal;
  }

  LN.ketcher = { open: open, load: load };
})(window);
