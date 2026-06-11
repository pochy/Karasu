let yamlMod: typeof import("yaml") | null = null;

export async function ensureYaml(): Promise<typeof import("yaml")> {
  if (!yamlMod) yamlMod = await import("yaml");
  return yamlMod;
}

export async function parseYaml(text: string): Promise<{ data: unknown; error: string | null }> {
  if (!text.trim()) return { data: null, error: null };
  const { parse, YAMLParseError } = await ensureYaml();
  try {
    return { data: parse(text), error: null };
  } catch (e) {
    const message =
      e instanceof YAMLParseError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    return { data: null, error: message };
  }
}

export async function stringifyYaml(data: unknown): Promise<string> {
  const { stringify } = await ensureYaml();
  return stringify(data, { indent: 2, lineWidth: 0 });
}

export async function formatYaml(text: string): Promise<{ result: string; error: string | null }> {
  const { data, error } = await parseYaml(text);
  if (error) return { result: text, error };
  if (data === null && !text.trim()) return { result: "", error: null };
  try {
    const result = await stringifyYaml(data);
    return { result, error: null };
  } catch (e) {
    return { result: text, error: e instanceof Error ? e.message : String(e) };
  }
}
