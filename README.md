# Karasu

Tauri 製の超軽量 Markdown ビューワー。Markdown の閲覧・編集と明示保存に特化しています。

## 機能

- Markdown ファイルを開く（`Cmd/Ctrl+O` または「開く」）
- テキスト編集
- プレビュー表示（「プレビュー」または `Cmd/Ctrl+P`）
- 明示保存（`Cmd/Ctrl+S`、自動保存なし）
- 起動時に最近開いたファイルを復元
- プレビューのコードブロックに sugar-high によるシンタックスハイライト（[選定理由](docs/syntax-highlighting.md)）

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
