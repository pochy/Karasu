import { marked } from "marked";
import { highlight } from "sugar-high";
import * as presets from "sugar-high/presets";

type HighlightOptions = NonNullable<Parameters<typeof highlight>[1]>;

const LANG_PRESETS: Record<string, HighlightOptions> = {
  rust: presets.rust,
  rs: presets.rust,
  python: presets.python,
  py: presets.python,
  css: presets.css,
  scss: presets.css,
  sass: presets.css,
  less: presets.css,
  go: presets.go,
  golang: presets.go,
  java: presets.java,
  c: presets.c,
  cpp: presets.c,
  h: presets.c,
  hpp: presets.c,
  diff: presets.diff,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function presetForLang(lang: string | undefined): HighlightOptions | undefined {
  if (!lang) return undefined;
  const id = lang.toLowerCase().split(/[\s#]/)[0];
  return LANG_PRESETS[id];
}

function highlightCode(text: string, lang: string | undefined): string {
  try {
    return highlight(text, presetForLang(lang));
  } catch {
    return escapeHtml(text);
  }
}

marked.setOptions({ gfm: true, breaks: false });

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang?.trim() ?? "";
      const body = highlightCode(text, language || undefined);
      const langAttr = language
        ? ` class="language-${escapeHtml(language)}"`
        : "";
      return `<pre><code${langAttr}>${body}</code></pre>`;
    },
  },
});

let previewCache: { content: string; html: string } | null = null;

export function renderMarkdownToHtml(content: string): string {
  if (previewCache?.content === content) {
    return previewCache.html;
  }
  const html = marked.parse(content) as string;
  previewCache = { content, html };
  return html;
}

export function invalidatePreviewCache(): void {
  previewCache = null;
}
