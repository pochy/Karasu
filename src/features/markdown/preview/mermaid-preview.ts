const MAX_DIAGRAMS = 20;
const MAX_BLOCK_CHARS = 8192;

let initialized = false;

export async function renderMermaidIn(container: HTMLElement): Promise<void> {
  const all = container.querySelectorAll("pre.mermaid");
  const nodes: HTMLElement[] = [];

  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue;
    if (nodes.length >= MAX_DIAGRAMS) {
      el.title = "Mermaid 図の上限（20個）を超えたため未描画";
      continue;
    }
    const text = el.textContent ?? "";
    if (text.length > MAX_BLOCK_CHARS) {
      el.title = "ブロックが大きすぎるため未描画";
      continue;
    }
    nodes.push(el);
  }

  if (nodes.length === 0) return;

  const { default: mermaid } = await import("mermaid");
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
    });
    initialized = true;
  }

  await mermaid.run({ nodes, suppressErrors: true });
}
