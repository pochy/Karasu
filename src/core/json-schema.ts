export interface JsonSchemaValidationResult {
  valid: boolean;
  errors: string | null;
}

let ajvInstance: import("ajv").default | null = null;

async function ensureAjv(): Promise<import("ajv").default> {
  if (!ajvInstance) {
    const mod = await import("ajv");
    ajvInstance = new mod.default({ allErrors: true, strict: false });
  }
  return ajvInstance;
}

function formatAjvErrors(errors: import("ajv").ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "検証に失敗しました";
  return errors
    .map((err) => {
      const path = err.instancePath || "/";
      const msg = err.message ?? "不明なエラー";
      return `${path}: ${msg}`;
    })
    .join("\n");
}

export async function validateJsonAgainstSchema(
  jsonText: string,
  schemaText: string,
): Promise<JsonSchemaValidationResult> {
  if (!schemaText.trim()) {
    return { valid: false, errors: "JSON Schema を入力してください" };
  }

  let schema: unknown;
  try {
    schema = JSON.parse(schemaText);
  } catch (e) {
    return {
      valid: false,
      errors: `Schema の JSON 構文エラー: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!jsonText.trim()) {
    return { valid: false, errors: "検証する JSON を入力してください" };
  }

  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    return {
      valid: false,
      errors: `JSON の構文エラー: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    const ajv = await ensureAjv();
    const validate = ajv.compile(schema as object);
    const valid = validate(data);
    if (valid) return { valid: true, errors: null };
    return { valid: false, errors: formatAjvErrors(validate.errors) };
  } catch (e) {
    return { valid: false, errors: e instanceof Error ? e.message : String(e) };
  }
}
