# Karasu

Tauri 製の超軽量 Markdown ビューワー。Markdown の閲覧・編集と明示保存に特化しています。

## 機能

- Markdown ファイルを開く（`Cmd/Ctrl+O` または「開く」）
- **作業フォルダ**を指定し、サイドバーから Markdown を切り替え（ツールバー「一覧」で開閉、フォルダは展開時に読み込み）
- テキスト編集
- プレビュー表示（「プレビュー」または `Cmd/Ctrl+P`）
- 明示保存（`Cmd/Ctrl+S`、自動保存なし）
- 起動時に最近開いたファイルを復元
- プレビューのコードブロックに sugar-high によるシンタックスハイライト
- ツールバー「設定」からモーダルで編集・プレビューのフォントと文字サイズを変更（この Mac に入っているフォントを Rust から列挙）

## ドキュメント

設計の背景（候補・採用理由・却下した案）を知りたい場合:

| ドキュメント | 内容 |
|--------------|------|
| [**docs/design-decisions.md**](docs/design-decisions.md) | **設計判断の正本**（アーキテクチャ、サイドバー、フォント、性能方針など） |
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
