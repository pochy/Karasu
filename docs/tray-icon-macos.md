# macOS トレイアイコン表示問題（調査記録）

Karasu のメニューバー常駐（`NSStatusItem` / Tauri `TrayIcon`）について、**release ビルド後にトレイアイコンが見えない**事象の原因・切り分け・最終対応をまとめる。

関連実装: `src-tauri/src/tray.rs`  
関連設計: [design-decisions.md — トレイメニュー](design-decisions.md#トレイメニューrust-trayrs)

---

## 概要（結論）

| 項目 | 内容 |
|------|------|
| **本質的な原因** | macOS メニューバー向け **`icon_as_template` とアイコン画像の組み合わせ** が不適切だった |
| **直接の症状** | トレイ自体は動作する（クリックでメニューが出る）が、**アイコン画像だけ描画されない** |
| **最終対応** | `icon.png` を 22×22 の**カラーアイコン**として専用生成し、`icon_as_template(false)` で表示 |
| **ビルド差ではない** | `target/release/karasu` と `Karasu.app/Contents/MacOS/karasu` は **同一バイナリ**（SHA256 一致） |

「`.app` にバンドルすると別のアイコンが埋め込まれる」「dev と release でアイコン資産が違う」といった仮説は **いずれも誤り** だった。

---

## 症状の経緯

### フェーズ 1: 初期報告（修正前）

| 起動方法 | トレイアイコン | トレイメニュー |
|----------|----------------|----------------|
| `bun run tauri dev` | 見える | 動く |
| `open src-tauri/target/release/karasu` | 見える | 動く |
| `open …/Karasu.app` | **見えない** | **動く**（メニューバー左側をクリックすると表示） |

当時の実装:

```rust
let icon = app
    .default_window_icon()  // tauri-codegen が埋め込む 32×32 カラー PNG
    .expect("...")
    .clone();

TrayIconBuilder::with_id("main-tray")
    .icon(icon)
    .icon_as_template(true)  // macOS テンプレートモード ON
```

**ポイント**: `.app` 起動時もトレイは存在する。消えているのはアイコン画像の描画だけ。

### フェーズ 2: 誤った修正による全滅

調査中に次の組み合わせを試した結果、**3 つの起動方法すべてでアイコンが見えなくなった**。

```rust
// icon.png を 32×32 にリサイズ後、全画素の RGB を 0（黒）に変換（alpha のみ残す）
for pixel in rgba.chunks_exact_mut(4) {
    pixel[0] = 0;
    pixel[1] = 0;
    pixel[2] = 0;
}

TrayIconBuilder::with_id("main-tray")
    .icon(icon)
    .icon_as_template(false)  // テンプレートモード OFF
```

**この組み合わせが最悪** である理由:

| 設定 | macOS の描画 |
|------|--------------|
| `icon_as_template(true)` + 黒シルエット | alpha をマスクに、メニューバー背景に応じて **白 or 黒** で自動反転（正しい template 用法） |
| `icon_as_template(false)` + カラー PNG | RGB をそのまま描画 |
| `icon_as_template(false)` + **黒 RGB** | **常に黒ピクセル**として描画 → ダークメニューバーで **完全に不可視** |

Karasu のメニューバーはダーク系が既定のため、フェーズ 2 の状態では dev / release バイナリ / `.app` のいずれでも見えなくなる。

### フェーズ 3: 最終対応（現在）

```rust
// icon.png → 22×22 カラー（RGB を加工しない）
fn tray_icon_image() -> tauri::Result<tauri::image::Image<'static>> { ... }

TrayIconBuilder::with_id("main-tray")
    .icon(tray_icon_image()?)
    .icon_as_template(false)
```

3 つの起動方法すべてでアイコンが表示されることを確認済み。

---

## 原因の整理

原因は **1 つではなく、レイヤーが重なっていた**。

### 原因 A: テンプレートモードとカラーアイコンの不一致（フェーズ 1）

`icon_as_template(true)` は、macOS が **テンプレート画像**（黒＋透明のシルエット）として扱う前提の API である。

- `default_window_icon()` が返すのは `tauri.conf.json` の `bundle.icon` から選ばれた **カラー PNG**（macOS では先頭の `.png` = `icons/32x32.png`）
- Karasu のアイコンは **シアン＋黄色の多色アイコン**
- テンプレートモードでは **alpha チャンネルのみ** が形状として使われ、色は無視される

`tauri dev` やバンドル外バイナリでは偶然見えていたが、`.app` バンドル（`CFBundleIdentifier: com.pochy.karasu`）として起動すると、macOS 26（darwin 25.x / Tahoe 系）のメニューバー描画パスで **アイコン画像が視覚的に消える** 状態になっていた。

**切り分けで否定した仮説**:

| 仮説 | 否定根拠 |
|------|----------|
| バイナリが違う | SHA256 完全一致 |
| Control Center がブロック | システム設定で「表示」ON、クリックでメニューが出る |
| Launch Services の問題 | `.app` 内バイナリをターミナルから直接実行してもアイコン非表示（メニューは出る） |
| `tauri dev` と `tauri build` でアイコン資産が違う | 同一の compile-time 埋め込みロジック |

### 原因 B: 黒変換 + 非テンプレートの組み合わせ（フェーズ 2・回帰）

「テンプレート向けに黒シルエットを作る」意図で RGB を 0 にしたが、`icon_as_template(false)` のままだった。

非テンプレートモードでは macOS は RGB を **そのまま** 描画するため、**黒 on ダークメニューバー** となり全起動形態で不可視になった。

### 原因 C: `default_window_icon()` の用途の取り違え（設計上の問題）

`default_window_icon()` は **ウィンドウアイコン / Dock アイコン** 用に `tauri-codegen` がビルド時に埋め込む画像である。

| 用途 | 推奨サイズ・形式 |
|------|------------------|
| アプリアイコン（Dock 等） | 32〜512px、カラー、`.icns` / `.png` |
| メニューバー（トレイ） | 18〜22pt 相当、**専用アイコン**、template なら黒＋透明 |

トレイに流用すると、サイズ・色・テンプレート設定のいずれかが不整合になりやすい。

---

## 最終対応の詳細

### 実装方針

1. **トレイ専用アイコン**を `icons/icon.png` からランタイム生成（`include_bytes!` + `image` crate）
2. メニューバー向けに **22×22** にリサイズ（`tray-icon` クレート内部でも 18pt 高さにスケールされるが、ソースを適正サイズにしておく）
3. **カラーを保持**したまま `icon_as_template(false)` で渡す
4. トレイ初期化は従来どおり `lib.rs` の `setup()` で行う（`RunEvent::Ready` への移動は不要だった）

### 変更ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src-tauri/src/tray.rs` | `tray_icon_image()` 追加、`icon_as_template(false)` |
| `src-tauri/Cargo.toml` | `image = "0.25"` 追加（PNG デコード・リサイズ用） |
| `src-tauri/src/lib.rs` | `setup()` 内で `tray::setup_tray`（変更なしの形に維持） |

### コード（現行）

```rust
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");
const TRAY_ICON_SIZE: u32 = 22;

fn tray_icon_image() -> tauri::Result<tauri::image::Image<'static>> {
    let decoded = image::load_from_memory(TRAY_ICON_BYTES)
        .map_err(|e| io::Error::other(format!("failed to decode tray icon: {e}")))?;
    let rgba = decoded
        .resize_exact(TRAY_ICON_SIZE, TRAY_ICON_SIZE, FilterType::Lanczos3)
        .to_rgba8()
        .into_raw();

    Ok(tauri::image::Image::new_owned(rgba, TRAY_ICON_SIZE, TRAY_ICON_SIZE))
}
```

```rust
TrayIconBuilder::with_id("main-tray")
    .icon(tray_icon_image()?)
    .icon_as_template(false)
```

### なぜ `icon_as_template(false)` を選んだか

| 方式 | メリット | デメリット |
|------|----------|------------|
| カラー + `false`（**採用**） | 実装が単純。ライト/ダークどちらでも色が見える | メニューバー上で他アプリと見た目がやや異なる |
| 黒シルエット + `true` | macOS 慣習に沿う。背景に自動適応 | 専用 template PNG の用意と変換が必要。変換ミスで再発しやすい |

Karasu はブランドカラー（シアン＋黄）のアイコンをそのまま見せたいため、カラー + 非テンプレートを採用した。

---

## 切り分け手順（再発時用）

症状が「メニューは出るがアイコンだけ見えない」の場合、次の順で確認する。

### 1. トレイ自体の生死

メニューバー左側（時計の反対側）をクリックし、Karasu のメニューが出るか。

- **出る** → `NSStatusItem` は存在。アイコン描画の問題に絞れる
- **出ない** → トレイ未作成・権限・起動失敗を疑う（`setup_tray` のエラー、Control Center 設定）

### 2. 起動形態の比較

```bash
# dev
bun run tauri dev

# release バイナリ（バンドル外）
open src-tauri/target/release/karasu

# release .app
open src-tauri/target/release/bundle/macos/Karasu.app

# .app 内バイナリを直接（Launch Services を迂回）
src-tauri/target/release/bundle/macos/Karasu.app/Contents/MacOS/karasu
```

| 比較 | 意味 |
|------|------|
| バンドル外だけ見える | テンプレート / バンドル文脈の描画差 |
| 全部見えない | `icon_as_template(false)` + 黒 RGB など致命的な組み合わせを疑う |
| 全部見える | 正常 |

### 3. バイナリ同一性

```bash
shasum -a 256 \
  src-tauri/target/release/karasu \
  src-tauri/target/release/bundle/macos/Karasu.app/Contents/MacOS/karasu
```

ハッシュが一致すれば、原因はビルドではなく **起動コンテキスト or 描画設定**。

### 4. システム設定

macOS 26 以降: **システム設定 → コントロールセンター → メニューバー** で Karasu が「メニューバーに表示」になっているか。

メニューが出るのにアイコンだけ見えない場合、ここは通常 ON でも再発する（描画問題）。

### 5. `icon_as_template` と RGB の組み合わせ表

| RGB | `icon_as_template` | ダークメニューバー | ライトメニューバー |
|-----|-------------------|-------------------|-------------------|
| カラー | `false` | 見える（**現行**） | 見える |
| カラー | `true` | 不定（フェーズ 1 で `.app` 不可視） | 不定 |
| 黒のみ | `false` | **見えない** | 見える |
| 黒シルエット | `true` | 白で見える | 黒で見える |

---

## 将来の改善案（任意）

現行方針で十分動作するが、macOS 慣習にさらに寄せるなら次の選択肢がある。

### A. 専用テンプレート PNG を静的に用意

```
src-tauri/icons/trayTemplate.png   # 22×22、黒＋透明のみ
```

```rust
.icon(Image::new(include_bytes!(...), 22, 22))
.icon_as_template(true)
```

`image` crate によるランタイム変換が不要になる。ビルドサイズも小さくなる。

### B. `tauri.conf.json` の `trayIcon` 設定

Tauri 2 は `app.trayIcon` でトレイ専用アイコンを設定できる（[System Tray ドキュメント](https://v2.tauri.app/learn/system-tray/)）。  
Rust 側 `TrayIconBuilder` と二重定義にならないよう、どちらか一方に統一すること。

### C. macOS 26 の `autosaveName`

Control Center がメニューバー項目をブロックリストに入れる事例がある（[oml#725](https://github.com/jundot/omlx/commit/7f38bf66c9d5a250c1a1847daaa2f35815e074dd)）。  
`tray-icon` の `ns_status_item()` 経由で `setAutosaveName` を設定すると安定する可能性がある。現時点では不要（症状なし）。

---

## 参考リンク

| 資料 | 内容 |
|------|------|
| [Tauri 2 — App Icons](https://v2.tauri.app/develop/icons/) | `bundle.icon` と各種フォーマット |
| [Tauri 2 — System Tray](https://v2.tauri.app/learn/system-tray/) | `TrayIconBuilder`、`iconAsTemplate` |
| [tauri#13770](https://github.com/tauri-apps/tauri/issues/13770) | macOS メニューバー権限・トレイ作成タイミング |
| [tray-icon#273](https://github.com/tauri-apps/tray-icon/issues/273) | バンドル外バイナリと `.app` の挙動差（OS バージョン依存） |
| [mkrnr/macos-menu-bar-icon-bug-test-project](https://github.com/mkrnr/macos-menu-bar-icon-bug-test-project) | macOS 26 の `NSStatusItem` 起動コンテキスト差の最小再現 |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-06-11 | 初版。フェーズ 1〜3 の調査・最終対応を文書化 |
