# Karasu

Tauri 製の超軽量 Markdown ビューワー。Markdown の閲覧・編集と明示保存に特化しています。

## 機能

- Markdown ファイルを開く（`Cmd/Ctrl+O` または「開く」）
- **作業フォルダ**を指定し、サイドバーから Markdown を切り替え（`Cmd/Ctrl+Shift+O`、`Cmd/Ctrl+B` で一覧の開閉）
- **最近開いたファイル**（最大 10 件）をサイドバーに表示
- テキスト編集・**別名で保存**（`Cmd/Ctrl+Shift+S`）
- プレビュー表示（`Cmd/Ctrl+P`）。**GFM**（テーブル・タスク・打ち消し線・アラート・脚注）と **`mermaid` コードブロック**に対応。フロントマターはプレビューでは非表示
- 明示保存（`Cmd/Ctrl+S`、自動保存なし）。未保存時はウィンドウタイトルに `•` を表示
- 起動時に最近開いたファイルを復元
- ステータスバーにファイルのフルパス（ホバーで全文）
- 作業フォルダ内の**ファイル名検索**（サイドバー「検索」）
- 設定で**ファイル監視**（既定 OFF）、**エディタ常時ライト**
- プレビューの外部リンクを OS のブラウザで開く
- ファイルごとのスクロール位置を記憶
- サイドバーから**新規ファイル**作成
- プレビューのコードブロック（`mermaid` 以外）に sugar-high によるシンタックスハイライト
- ツールバー「設定」からモーダルで編集・プレビューのフォントと文字サイズを変更

## キーボードショートカット

| 操作 | ショートカット |
|------|----------------|
| 保存 | `Cmd/Ctrl+S` |
| 別名で保存 | `Cmd/Ctrl+Shift+S` |
| ファイルを開く | `Cmd/Ctrl+O` |
| 作業フォルダを開く | `Cmd/Ctrl+Shift+O` |
| 編集 ↔ プレビュー | `Cmd/Ctrl+P` |
| サイドバー開閉 | `Cmd/Ctrl+B` |

## ドキュメント

設計の背景（候補・採用理由・却下した案）を知りたい場合:

| ドキュメント | 内容 |
|--------------|------|
| [**docs/design-decisions.md**](docs/design-decisions.md) | **設計判断の正本**（アーキテクチャ、性能方針、機能バックログ） |
| [docs/syntax-highlighting.md](docs/syntax-highlighting.md) | シンタックスハイライト（sugar-high vs Shiki 等） |
| [docs/superpowers/specs/2026-06-03-tauri-markdown-viewer-design.md](docs/superpowers/specs/2026-06-03-tauri-markdown-viewer-design.md) | プロジェクト開始時の要件定義 |
| [docs/README.md](docs/README.md) | ドキュメント一覧と読み方 |

## 開発

```bash
npm install
npm run tauri dev
```

## ビルド

```bash
npm run tauri build
```

## テスト（Rust）

```bash
cd src-tauri && cargo test
```
