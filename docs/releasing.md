# リリースとコミュニティプラグイン申請の手順

最終確認: 2026-11-06(公式ドキュメントを直接読んで確認)。
**この手順は変わりやすい。申請の直前に、下の出典を必ず読み直すこと。**

出典:
- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Community directory FAQ](https://docs.obsidian.md/community-directory/faq)
- 申請先: <https://community.obsidian.md>

## 旧手順は使わない

`obsidian-releases` を fork して `community-plugins.json` を編集し、PR を出す方法は**古い**。
古い解説記事(Obsidian Hub、解説サイト、DeepWiki など)にはまだ載っているが、現在の公式手順は Web ポータルからの申請。

## 手順

### 1. リリースを作る(このリポジトリでの操作)

1. `manifest.json` の `version` を `x.y.z` 形式で上げる。`package.json` と `versions.json` も同じ値にそろえる。
2. 変更を main に push する(ポータルは**既定ブランチの先頭**の `manifest.json` を読むので、正しい内容を先にコミットしておく)。
3. バージョンと同じタグ(`v` を付けない。例: `0.1.0`)を push する。
   `.github/workflows/release.yml` がテストとビルドを行い、`main.js` と `manifest.json` を添付した**下書きリリース**を作る。
4. GitHub でリリースの内容を確認し、**Publish** する(Private のままでも操作できる)。
   - 添付ファイルは `main.js`・`manifest.json`・`styles.css`(`release.yml` が自動で添付する)。

### 2. 申請する(初回のみ)

1. リポジトリを Public にする(Private のままだと、Obsidian アプリがリリースの添付ファイルを取得できない。ソースは Private のまま、ビルド済みファイルだけ別の Public リポジトリに置く構成が FAQ に記載されているが、このプロジェクトでは使わない想定)。
2. <https://community.obsidian.md> に Obsidian アカウントでサインインする。
3. GitHub アカウントを連携する(リポジトリの所有者確認に使われる)。
4. プラグインを追加する。申請は作者本人のアカウントで行う(代行不可)。
5. 自動レビューの結果を確認する。Error があるとアプリ内からインストールできない。

### 3. 更新するとき

- 申請はもう不要。**バージョンを上げた新しいリリースを公開する**だけで、ディレクトリが定期的に検知する。
- リリースのタグは `manifest.json` の `version` と一致させる。
- すぐ検知させたいときは、管理ページの「...」メニューから **Check for new releases** を選ぶ。
- 申請前の確認には、ブランチ・タグ・コミットを指定して自動レビューだけを試せる機能(Review branch)がある。

## 申請前の要件

- リポジトリ直下に `README.md`、`LICENSE`、`manifest.json` がある(済)
- `id` は他と重複せず、`obsidian` を含まない。**公開後は変更できない**(現在: `llr-calendar-import`)
- 自動レビューはビルドスクリプトとして `build` → `build:plugin` → `compile` の最初の一致を使う(現在: `build`、本番ビルドになっている)
- ローカルでの事前チェックには、公式の ESLint プラグイン <https://github.com/obsidianmd/eslint-plugin> を使う(導入済み。`npm run lint`。`package.json` などもチェックするため、`src` ではなくプロジェクトのルートで実行する)
- 「Developer policies」と「Submission requirements for plugins」は、公式ドキュメント内のリンク先 URL を取得できず、**内容を確認できていない**。申請前に自分で読むこと

## 現状の実装と Plugin guidelines の照合(2026-11-06)

| 項目 | 状態 |
|---|---|
| インラインスタイルを使わない(CSS クラスと `styles.css` を使う) | OK(2026-11-06 修正。エラー表示の色は `styles.css` の `.llr-cal-error`) |
| ESLint の公式プラグインで確認する | OK(導入済み。エラー 0 件) |
| 最小バージョンと使用 API の整合 | OK(`getLanguage()` が 1.8.7 以降のため、`minAppVersion` を 1.8.7 に引き上げ) |
| 設定画面の新しい宣言的 API(`getSettingDefinitions()`、Obsidian 1.13 以降の設定検索対応) | 未対応(ESLint の警告 1 件。任意の改善) |
| `innerHTML` 等を使わない | OK |
| グローバルな `app` を使わない | OK |
| 既定のホットキーを設定しない | OK |
| コンソール出力は最小限(通常はエラーのみ) | OK(`console.debug` はデバッグログ ON のときだけ) |
| ノートの書き換えは `Vault.process()` を使う | OK |
| パスは `normalizePath()` を通す | OK(`dailyNote.ts`) |
| Vault API を優先し、Adapter API は避ける | LLR の `data.json` 読み込みだけ `adapter.read` を使用。`.obsidian` 配下は Vault API で読めないため例外 |
| 設定画面の見出し: 見出しは複数セクションがあるときだけ。「General」「Settings」などは避ける。文は sentence case | 要確認: 「Options」見出しが「General」に近いと見なされるかもしれない |
| モバイル対応(Node/Electron API を使わない) | OK(バンドルに `fs` / `path` なし) |
