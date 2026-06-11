export interface JwtParts {
  header: unknown;
  payload: unknown;
  headerRaw: string;
  payloadRaw: string;
}

export interface JwtDecodeResult {
  parts: JwtParts | null;
  error: string | null;
  expiresAt: Date | null;
  isExpired: boolean | null;
}

function base64UrlToBytes(segment: string): Uint8Array | null {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJsonSegment(segment: string): { json: unknown; raw: string } | null {
  const bytes = base64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    const raw = new TextDecoder().decode(bytes);
    return { json: JSON.parse(raw), raw };
  } catch {
    return null;
  }
}

export function decodeJwt(token: string): JwtDecodeResult {
  const trimmed = token.trim();
  if (!trimmed) {
    return { parts: null, error: null, expiresAt: null, isExpired: null };
  }

  const segments = trimmed.split(".");
  if (segments.length < 2) {
    return {
      parts: null,
      error: "JWT は header.payload.signature の形式である必要があります",
      expiresAt: null,
      isExpired: null,
    };
  }

  const header = decodeJsonSegment(segments[0]);
  const payload = decodeJsonSegment(segments[1]);
  if (!header || !payload) {
    return {
      parts: null,
      error: "Base64URL デコードまたは JSON パースに失敗しました",
      expiresAt: null,
      isExpired: null,
    };
  }

  let expiresAt: Date | null = null;
  let isExpired: boolean | null = null;
  if (
    payload.json &&
    typeof payload.json === "object" &&
    "exp" in payload.json &&
    typeof (payload.json as { exp: unknown }).exp === "number"
  ) {
    const exp = (payload.json as { exp: number }).exp;
    expiresAt = new Date(exp * 1000);
    isExpired = Date.now() >= expiresAt.getTime();
  }

  return {
    parts: {
      header: header.json,
      payload: payload.json,
      headerRaw: header.raw,
      payloadRaw: payload.raw,
    },
    error: null,
    expiresAt,
    isExpired,
  };
}
