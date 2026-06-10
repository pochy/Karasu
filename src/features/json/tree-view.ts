const MAX_INLINE_LEN = 120;

function truncate(text: string): string {
  if (text.length <= MAX_INLINE_LEN) return text;
  return `${text.slice(0, MAX_INLINE_LEN)}…`;
}

function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function primitiveClass(value: unknown): string {
  if (value === null) return "json-tree-value--null";
  switch (typeof value) {
    case "string":
      return "json-tree-value--string";
    case "number":
      return "json-tree-value--number";
    case "boolean":
      return "json-tree-value--boolean";
    default:
      return "";
  }
}

function createRow(
  keyLabel: string | null,
  value: unknown,
  depth: number,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "json-tree-node";
  row.style.setProperty("--depth", String(depth));

  if (value !== null && typeof value === "object") {
    const isArray = Array.isArray(value);
    const entries = isArray
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    const open = entries.length > 0 && depth < 1;
    const summary = isArray
      ? `${entries.length} 件`
      : `${entries.length} キー`;

    const head = document.createElement("button");
    head.type = "button";
    head.className = "json-tree-head";
    head.setAttribute("aria-expanded", String(open));
    const keyPart =
      keyLabel !== null
        ? `<span class="json-tree-key">${escapeHtml(keyLabel)}</span><span class="json-tree-colon">:</span>`
        : "";
    const openBracket = isArray ? "[" : "{";
    const closeBracket = isArray ? "]" : "}";
    head.innerHTML = `<span class="json-tree-chevron" aria-hidden="true">${open ? "▼" : "▶"}</span>${keyPart}<span class="json-tree-summary">${openBracket} ${summary} ${closeBracket}</span>`;

    const children = document.createElement("div");
    children.className = "json-tree-children";
    children.hidden = !open;

    for (const [key, child] of entries) {
      children.appendChild(createRow(key, child, depth + 1));
    }

    head.addEventListener("click", () => {
      const expanded = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", String(!expanded));
      const chevron = head.querySelector(".json-tree-chevron");
      if (chevron) chevron.textContent = expanded ? "▶" : "▼";
      children.hidden = expanded;
    });

    row.appendChild(head);
    row.appendChild(children);
    return row;
  }

  const line = document.createElement("div");
  line.className = "json-tree-leaf";
  const keyHtml =
    keyLabel !== null
      ? `<span class="json-tree-key">${escapeHtml(keyLabel)}</span><span class="json-tree-colon">:</span>`
      : "";
  line.innerHTML = `${keyHtml}<span class="json-tree-value ${primitiveClass(value)}">${escapeHtml(truncate(formatPrimitive(value)))}</span>`;
  row.appendChild(line);
  return row;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderJsonTree(container: HTMLElement, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    container.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "json-tree-empty";
    empty.textContent = "JSON を入力するか、ファイルを開いてください。";
    container.appendChild(empty);
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }

  container.replaceChildren();
  container.appendChild(createRow(null, data, 0));
  return null;
}
