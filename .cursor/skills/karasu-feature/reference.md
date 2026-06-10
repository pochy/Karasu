# Karasu 参照（機能開発）

## ディレクトリ構成

```
src/
  main.ts                 # エントリ・モード切替配線
  app/                    # アプリシェル
    chrome.ts             # ステータスバー・共通ツールバー
    activity-bar.ts       # 左アイコンバー
    editor-mode.ts        # Markdown / JSON モード
  core/                   # 共通
    editor-controller.ts  # エディタ共通 IF
    session-state.ts      # スクロール記憶
    fonts.ts              # フォント列挙ヘルパ
  features/
    markdown/
      editor.ts           # Markdown エディタ本体
      preview/            # marked・Mermaid
      sidebar/            # ファイル一覧（Markdown 専用）
    json/
      editor.ts           # JSON エディタ本体
      tree-view.ts        # ツリービュー
    settings/
      settings.ts         # 表示設定モーダル
  styles/
    app.css               # シェル・サイドバー・設定
    markdown-editor.css
    json-editor.css
  assets/
```

## Rust

| 領域 | パス |
|------|------|
| コマンド | `src-tauri/src/commands.rs` |
| 列挙 | `src-tauri/src/dir.rs` |

## localStorage キー

| キー | 用途 |
|------|------|
| `karasu-editor-mode` | Markdown / JSON |
| `karasu-sidebar-visible` | サイドバー開閉 |
| `karasu-scroll-positions` | パス別 scrollTop |
| `karasu-display-settings` | フォント・監視・エディタライト |

## 開発コマンド

```bash
npm install
npm run tauri dev
npm run build
cd src-tauri && cargo test
npm run tauri build
```

## バックログ群（2026-06）

| 群 | 状態 |
|----|------|
| A1〜A6 | 実装済み（ショートカット・MRU・Save As 等） |
| B1〜B5 | 実装済み（監視・検索・スクロール等） |
| C1〜C4 | 実装済み（タイトル・FM strip 等） |
| F1〜F2 | 実装済み（GFM 拡張・Mermaid） |
| D1〜D4 | 提案（仮想スクロール・巨大 MD 制限等） |
| E1〜E7 | 却下記録 |

新 ID は未使用の英字群 + 番号（例 `G1`）で採番する。
