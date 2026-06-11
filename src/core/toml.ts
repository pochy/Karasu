let tomlMod: typeof import("smol-toml") | null = null;

export async function ensureToml(): Promise<typeof import("smol-toml")> {
  if (!tomlMod) tomlMod = await import("smol-toml");
  return tomlMod;
}

export async function parseToml(text: string): Promise<{ data: unknown; error: string | null }> {
  if (!text.trim()) return { data: null, error: null };
  const { parse } = await ensureToml();
  try {
    return { data: parse(text), error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function stringifyToml(data: unknown): Promise<string> {
  const { stringify } = await ensureToml();
  return stringify(data as Record<string, unknown>);
}

export async function formatToml(text: string): Promise<{ result: string; error: string | null }> {
  const { data, error } = await parseToml(text);
  if (error) return { result: text, error };
  if (data === null && !text.trim()) return { result: "", error: null };
  try {
    const result = await stringifyToml(data);
    return { result, error: null };
  } catch (e) {
    return { result: text, error: e instanceof Error ? e.message : String(e) };
  }
}
