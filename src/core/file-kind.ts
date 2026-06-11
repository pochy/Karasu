import type { EditorMode } from "../app/editor-mode";

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".txt"];
const JSON_EXTENSIONS = [".json", ".jsonc"];
const CSV_EXTENSIONS = [".csv", ".tsv"];

export function editorModeForPath(path: string): EditorMode {
  const lower = path.toLowerCase();
  if (CSV_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "csv";
  if (JSON_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "json";
  if (MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "markdown";
  return "markdown";
}
