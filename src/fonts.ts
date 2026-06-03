/** CSS の system-ui スタックを表す保存用の値 */
export const SYSTEM_UI_FAMILY = "__system-ui__";

/** Tauri 外（Vite のみ）やフォント列挙失敗時のフォールバック */
export const FALLBACK_FONT_FAMILIES = [
  SYSTEM_UI_FAMILY,
  "Hiragino Sans",
  "Hiragino Mincho ProN",
  "Yu Gothic",
  "Meiryo",
  "Helvetica Neue",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Menlo",
  "SF Mono",
  "Monaco",
  "Courier New",
  "MS Gothic",
] as const;

const LEGACY_FONT_IDS: Record<string, string> = {
  "system-ui": SYSTEM_UI_FAMILY,
  "hiragino-sans": "Hiragino Sans",
  "hiragino-mincho": "Hiragino Mincho ProN",
  "yu-gothic": "Yu Gothic",
  meiryo: "Meiryo",
  georgia: "Georgia",
  menlo: "Menlo",
  "sf-mono": "SF Mono",
  "ms-gothic": "MS Gothic",
};

export function migrateLegacyFontId(id: string): string {
  return LEGACY_FONT_IDS[id] ?? id;
}

export function fontFamilyToCss(family: string, role: "editor" | "preview"): string {
  if (family === SYSTEM_UI_FAMILY) {
    return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  }
  const quoted =
    family.includes(" ") || family.startsWith(".") ? `"${family}"` : family;
  const fallback = role === "editor" ? "monospace" : "sans-serif";
  return `${quoted}, ${fallback}`;
}

export function labelForFontFamily(family: string): string {
  return family === SYSTEM_UI_FAMILY ? "システム UI（OS 既定）" : family;
}
