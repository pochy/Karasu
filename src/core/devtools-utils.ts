const MAX_TEXT_BYTES = 512 * 1024;

export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function assertTextSize(text: string, label: string): string | null {
  const bytes = textByteLength(text);
  if (bytes > MAX_TEXT_BYTES) {
    return `${label}が大きすぎます（${bytes} バイト）。上限は ${MAX_TEXT_BYTES} バイトです。`;
  }
  return null;
}

export function encodeBase64(text: string): { result: string; error: string | null } {
  const sizeError = assertTextSize(text, "入力");
  if (sizeError) return { result: "", error: sizeError };
  try {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { result: btoa(binary), error: null };
  } catch (e) {
    return { result: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export function decodeBase64(text: string): { result: string; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { result: "", error: null };
  try {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { result: new TextDecoder().decode(bytes), error: null };
  } catch (e) {
    return { result: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export function encodeUrl(text: string): string {
  return encodeURIComponent(text);
}

export function decodeUrl(text: string): { result: string; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { result: "", error: null };
  try {
    return { result: decodeURIComponent(trimmed), error: null };
  } catch (e) {
    return { result: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export function generateUuid(): string {
  return crypto.randomUUID();
}

export async function hashText(
  text: string,
  algorithm: "SHA-1" | "SHA-256" | "SHA-512",
): Promise<{ result: string; error: string | null }> {
  const sizeError = assertTextSize(text, "入力");
  if (sizeError) return { result: "", error: sizeError };
  try {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest(algorithm, data);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { result: hex, error: null };
  } catch (e) {
    return { result: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ParsedUrl {
  href: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  searchParams: Record<string, string>;
}

export function parseUrl(text: string): { result: ParsedUrl | null; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { result: null, error: null };
  try {
    const url = new URL(trimmed);
    const searchParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      searchParams[key] = value;
    });
    return {
      result: {
        href: url.href,
        protocol: url.protocol,
        username: url.username,
        password: url.password,
        host: url.host,
        hostname: url.hostname,
        port: url.port,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        origin: url.origin,
        searchParams,
      },
      error: null,
    };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function buildUrl(parts: {
  protocol: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
}): { result: string; error: string | null } {
  try {
    const protocol = parts.protocol.trim() || "https:";
    const normalizedProtocol = protocol.endsWith(":") ? protocol : `${protocol}:`;
    const host = parts.host.trim();
    if (!host) return { result: "", error: "ホストを入力してください" };
    const pathname = parts.pathname.trim() || "/";
    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const search = parts.search.trim();
    const normalizedSearch =
      search && !search.startsWith("?") ? `?${search}` : search;
    const hash = parts.hash.trim();
    const normalizedHash = hash && !hash.startsWith("#") ? `#${hash}` : hash;
    const url = new URL(`${normalizedProtocol}//${host}${normalizedPath}${normalizedSearch}${normalizedHash}`);
    return { result: url.href, error: null };
  } catch (e) {
    return { result: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RegexpMatchInfo {
  match: string;
  index: number;
  groups: string[];
}

export function testRegexp(
  pattern: string,
  flags: string,
  text: string,
): { matches: RegexpMatchInfo[]; summary: string; error: string | null } {
  if (!pattern.trim()) {
    return { matches: [], summary: "", error: "正規表現パターンを入力してください" };
  }
  try {
    const re = new RegExp(pattern, flags);
    const matches: RegexpMatchInfo[] = [];
    if (re.global) {
      for (const match of text.matchAll(re)) {
        matches.push({
          match: match[0],
          index: match.index ?? 0,
          groups: match.slice(1),
        });
      }
    } else {
      const match = re.exec(text);
      if (match) {
        matches.push({
          match: match[0],
          index: match.index ?? 0,
          groups: match.slice(1),
        });
      }
    }
    if (matches.length === 0) {
      return { matches: [], summary: "マッチなし", error: null };
    }
    const summary = matches
      .map((m, i) => {
        const groups =
          m.groups.length > 0 ? `  groups: ${JSON.stringify(m.groups)}` : "";
        return `#${i + 1} [${m.index}] "${m.match}"${groups}`;
      })
      .join("\n");
    return { matches, summary, error: null };
  } catch (e) {
    return { matches: [], summary: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export interface TimestampConversion {
  iso: string;
  local: string;
  unixSec: number;
  unixMs: number;
}

export function convertTimestamp(input: string): {
  result: TimestampConversion | null;
  error: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) return { result: null, error: null };

  let date: Date | null = null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      return { result: null, error: "数値として解釈できません" };
    }
    const ms = Math.abs(num) < 1e12 ? num * 1000 : num;
    date = new Date(ms);
  } else {
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      return { result: null, error: "日時として解釈できません" };
    }
    date = new Date(parsed);
  }

  if (!date || Number.isNaN(date.getTime())) {
    return { result: null, error: "無効な日時です" };
  }

  const unixMs = date.getTime();
  return {
    result: {
      iso: date.toISOString(),
      local: date.toLocaleString(),
      unixSec: Math.floor(unixMs / 1000),
      unixMs,
    },
    error: null,
  };
}

export type DiffLineType = "same" | "add" | "remove";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export function diffText(left: string, right: string): DiffLine[] {
  const a = left.split("\n");
  const b = right.split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const stack: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: "same", text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", text: b[j - 1] });
      j--;
    } else {
      stack.push({ type: "remove", text: a[i - 1] });
      i--;
    }
  }

  return stack.reverse();
}

export function formatDiffLines(lines: DiffLine[]): string {
  if (lines.length === 0) return "（差分なし）";
  return lines
    .map((line) => {
      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      return `${prefix} ${line.text}`;
    })
    .join("\n");
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorConversion {
  hex: string;
  rgb: string;
  rgba: string;
  preview: string;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHexColor(input: string): RgbColor | null {
  const hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1,
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  return null;
}

function parseRgbFunction(input: string): RgbColor | null {
  const match = input.trim().match(/^rgba?\(\s*([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const r = clampByte(Number(parts[0]));
  const g = clampByte(Number(parts[1]));
  const b = clampByte(Number(parts[2]));
  let a = 1;
  if (parts.length >= 4) {
    const alpha = Number(parts[3]);
    a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  }
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b, a };
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

function colorToFormats(color: RgbColor): ColorConversion {
  const hex =
    color.a >= 1
      ? `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`
      : `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}${toHexByte(color.a * 255)}`;
  const rgb = `rgb(${color.r}, ${color.g}, ${color.b})`;
  const rgba = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
  const preview = color.a >= 1 ? hex : rgba;
  return { hex, rgb, rgba, preview };
}

export function convertColor(input: string): {
  result: ColorConversion | null;
  error: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) return { result: null, error: null };
  const color = trimmed.startsWith("#")
    ? parseHexColor(trimmed)
    : (parseRgbFunction(trimmed) ?? parseHexColor(trimmed));
  if (!color) {
    return {
      result: null,
      error: "#RRGGBB / #RGB / rgb() / rgba() 形式で入力してください",
    };
  }
  return { result: colorToFormats(color), error: null };
}
