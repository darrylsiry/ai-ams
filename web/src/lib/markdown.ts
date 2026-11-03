// A small Markdown reader for the assistant's answers: headings, paragraphs, bullet and numbered
// lists, pipe tables, fenced code, quotes, rules; inline bold, italics, code and links. Pure module
// (no React) so node:test can check it; components/markdown.tsx renders the blocks.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start?: number; items: Inline[][] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] }
  | { type: "code"; text: string }
  | { type: "quote"; children: Inline[] }
  | { type: "rule" };

const INLINE = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*?\*)|((?<![\w@.])_[^_\s][^_]*?_(?![\w@]))/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length) {
    const m = INLINE.exec(rest);
    if (!m) { out.push({ type: "text", text: rest }); break; }
    if (m.index > 0) out.push({ type: "text", text: rest.slice(0, m.index) });
    const tok = m[0];
    if (m[1]) out.push({ type: "code", text: tok.slice(1, -1) });
    else if (m[2]) out.push({ type: "strong", children: parseInline(tok.slice(2, -2)) });
    else if (m[3]) {
      const close = tok.indexOf("](");
      out.push({ type: "link", href: tok.slice(close + 2, -1), children: parseInline(tok.slice(1, close)) });
    } else out.push({ type: "em", children: parseInline(tok.slice(1, -1)) });
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
const isTableRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: "heading", level: h[1].length, children: parseInline(h[2].trim()) }); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push({ type: "rule" }); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const header = cells(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]).map(parseInline));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const start = ordered ? parseInt(li[1], 10) : undefined;
      const items: Inline[][] = [];
      while (i < lines.length) {
        // A blank line between items doesn't start a new list, or a ranked answer would read 1, 1, 1.
        if (!lines[i].trim()) {
          let next = i + 1;
          while (next < lines.length && !lines[next].trim()) next++;
          const after = next < lines.length ? /^\s*([-*+]|\d+[.)])\s+/.exec(lines[next]) : null;
          if (after && /\d/.test(after[1]) === ordered) { i = next; continue; }
          break;
        }
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m && /\d/.test(m[1]) !== ordered) break;   // a numbered list after bullets (or the reverse) is a new list
        if (m) { items.push(parseInline(m[2].trim())); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) {   // a wrapped continuation line
          const last = items[items.length - 1];
          last.push({ type: "text", text: " " }, ...parseInline(lines[i].trim()));
          i++;
        } else break;
      }
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", children: parseInline(buf.join(" ")) });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s|\s*>\s?)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isTableRule(lines[i + 1]))) {
      buf.push(lines[i++].trim());
    }
    if (buf.length) blocks.push({ type: "paragraph", children: parseInline(buf.join(" ")) });
    else i++;
  }
  return blocks;
}

/** Plain text of inline content (for titles and tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : inlineText(n.children))).join("");
}

const APP_ROUTE = /^\/(?:(?:tasks|clients|policies|certificates|claims|sales)(?:\/(?:\d+|new))?|inbox(?:\/\d+)?|renewals|search|accounting(?:\/(?:receipts(?:\/new)?|invoices|commissions(?:\/\d+)?|payables|producers|trust|ledger))?|reports(?:\/(?!csv\b)[a-z-]+)?|documents\/render|admin(?:\/(?:audit|carriers|users(?:\/\d+)?|settings|roadmap))?)?$/;
const APP_PARAMS = new Set(["tab", "view", "days", "status", "month", "user", "owner", "action", "id", "kind", "policy", "invoice", "certificate", "client", "task", "q", "due", "scope", "page", "from", "to", "category", "type"]);

/** A link the assistant may offer: a real page in this app, so never a mistyped or made-up address, nothing that asks it again or signs out, and no ?msg= that would show planted words as the app's own message. */
export function isAppLink(href: string): boolean {
  if (/[\\\s]/.test(href)) return false;
  const [rest, ...fragment] = href.split("#");
  const [path, query, ...more] = rest.split("?");
  if (more.length || fragment.length > 1 || !APP_ROUTE.test(path)) return false;
  return !query || query.split("&").every((pair) => APP_PARAMS.has(pair.split("=")[0]));
}

const plainLinks = (nodes: Inline[]): Inline[] => nodes.flatMap((n): Inline[] => {
  if (n.type === "link") return isAppLink(n.href) ? [{ ...n, children: plainLinks(n.children) }] : plainLinks(n.children);
  if (n.type === "strong" || n.type === "em") return [{ ...n, children: plainLinks(n.children) }];
  return [n];
});

/**
 * The same blocks with every link outside the app reduced to its words. An answer can repeat text from a
 * client's email, so a link planted there must not become something a person can click.
 */
export function onlyAppLinks(blocks: Block[]): Block[] {
  return blocks.map((b): Block => {
    switch (b.type) {
      case "heading": case "paragraph": case "quote": return { ...b, children: plainLinks(b.children) };
      case "list": return { ...b, items: b.items.map(plainLinks) };
      case "table": return { ...b, header: b.header.map(plainLinks), rows: b.rows.map((r) => r.map(plainLinks)) };
      default: return b;
    }
  });
}
