import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone/dist/jsNoRender';
import 'ketcher-react/dist/index.css';

// 実験ノートアプリから使う最小限の窓口
window.KetcherBundle = {
  mount: function (el) {
    return new Promise(function (resolve) {
      var root = createRoot(el);
      var provider = new StandaloneStructServiceProvider();
      root.render(React.createElement(Editor, {
        staticResourcesUrl: '',
        structServiceProvider: provider,
        errorHandler: function (message) { console.error('Ketcher:', message); },
        onInit: function (ketcher) {
          // Ketcher 内部（KetcherLogger など）が window.ketcher を参照する
          window.ketcher = ketcher;
          resolve({ ketcher: ketcher, unmount: function () { root.unmount(); } });
        }
      }));
    });
  }
};
