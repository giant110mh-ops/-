# Ketcher（構造式エディタ）

- 配布元: EPAM Systems — https://github.com/epam/ketcher
- ライセンス: Apache License 2.0（http://www.apache.org/licenses/LICENSE-2.0）
- 版: ketcher-react / ketcher-standalone / ketcher-core 3.7.0、react 18.3.1

`ketcher.js` / `ketcher.css` は上記 npm パッケージを esbuild で 1 ファイルにまとめたもの。
サーバーなしで動く standalone 版（構造の変換は同梱の Indigo が行う）。

## 作り直す手順

```sh
npm install ketcher-react@3.7.0 ketcher-standalone@3.7.0 ketcher-core@3.7.0 react@18.3.1 react-dom@18.3.1 esbuild@0.24.0
npx esbuild entry.js --bundle --format=iife --minify --outfile=out/ketcher.js \
  --define:process.env.NODE_ENV='"production"' --define:global=window --banner:js="var process=window.process||{env:{NODE_ENV:'production'},browser:true};" \
  --loader:.svg=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl --loader:.ttf=dataurl --loader:.png=dataurl
```

`entry.js` はこのフォルダの `entry.js`。
