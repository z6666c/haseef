/**
 * عارض Markdown صغير وآمن لنماذج المكتبة والسياسات.
 * يهرّب كل HTML أولاً، ثم يولّد وسوماً معروفة فقط: عناوين، فقرات، قوائم، جداول، غامق، مائل، روابط https.
 * لا يقبل HTML خاماً من النص، فلا يمكن لمحتوى مرفوع أن يحقن سكربت.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/«(.+?)»/g, '<mark class="md-slot">«$1»</mark>');   // حقول تُستبدل ببيانات المنشأة
  out = out.replace(/\[(.+?)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(h[1].length + 1, 5); html.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }

    if (/^---+\s*$/.test(line)) { html.push("<hr />"); i++; continue; }

    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) { q.push(inline(lines[i].replace(/^>\s?/, ""))); i++; }
      html.push(`<blockquote>${q.join("<br />")}</blockquote>`);
      continue;
    }

    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      html.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    const ul = /^\s*[-*]\s+/, ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(re, "").replace(/^\[ \]\s*/, "☐ ").replace(/^\[x\]\s*/i, "☑ "))}</li>`); i++; }
      html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||>|\s*[-*]\s|\s*\d+[.)]\s|---)/.test(lines[i])) {
      para.push(inline(lines[i])); i++;
    }
    if (para.length) html.push(`<p>${para.join("<br />")}</p>`);
    else i++;
  }
  return html.join("\n");
}
