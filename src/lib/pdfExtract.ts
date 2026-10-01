// =====================================================================
// Pure PDF text-layer extraction (plain mode) — moved out of the
// connector so diagnostics and FIXTURE TESTS exercise the exact same
// code the deployment runs. No Convex imports; pdfjs is passed in by
// the caller (keeps this module trivially testable).
// =====================================================================

/** Render pdfjs text items into plain reading-order lines (plain mode). */
export function renderLines(items: {
  str: string;
  transform: number[];
  width?: number;
}[]) {
  const lines = new Map<number, { x: number; w: number; s: string }[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4]!;
    const y = it.transform[5]!;
    const arr = lines.get(y) ?? [];
    arr.push({ x, w: it.width ?? 0, s: it.str });
    lines.set(y, arr);
  }
  const out: string[] = [];
  for (const [y, arr] of [...lines.entries()].sort((a, b) => b[0] - a[0])) {
    arr.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd: number | null = null;
    for (const seg of arr) {
      const gap = prevEnd === null ? 0 : seg.x - prevEnd;
      if (gap > 1.5 && text && !/\s$/.test(text) && !/^\s/.test(seg.s)) text += " ";
      text += seg.s;
      prevEnd = seg.x + seg.w;
    }
    const t = text.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

/**
 * Plain-mode section detection (port of the verified extract-legal-pdfs
 * logic): "12. Punishment for …—(1) …" yields an anchor + heading; range
 * lines ("12 to 16.") update the sequence but add no anchor. Lettered
 * variants ("2A.", "12B.") register their own anchor ("s 2A") when they
 * directly follow the base number. The FULL body is always kept —
 * sections are only the anchor index.
 */
export function detectSections(
  lines: string[],
  opts: { startAt: number; maxNo: number },
) {
  const re = /^[\[(]?\s*(\d{1,3})\s*(?:([A-Z])|-([A-Z]))?\s*\.\s*(.*)$/;
  const rangeRe = /^(\d{1,3})\s*(?:to|and)\s*(\d{1,3})([A-Z]?)\.\s*(.*)$/;
  const sections: { anchor: string; heading: string; start: number }[] = [];
  const body: string[] = [];
  let offset = 0;
  let last = 0;
  const registered = new Set<string>();
  for (const raw of lines) {
    const range = raw.match(rangeRe);
    if (range) {
      body.push(raw);
      offset += raw.length + 1;
      const n = parseInt(range[1]!, 10);
      if (n > last && n <= opts.maxNo) last = n;
      continue;
    }
    const m = raw.match(re);
    if (m) {
      const n = parseInt(m[1]!, 10);
      const letter = m[2] ?? m[3] ?? "";
      const num = `${n}${letter}`;
      if (
        n >= opts.startAt &&
        (n > last || (letter !== "" && n === last)) &&
        n <= opts.maxNo &&
        !registered.has(num) &&
        n - last <= 3
      ) {
        let heading = m[4] ?? "";
        const cut = heading.search(/\.--|\.—|—|\.–|–|\.(\(|\[)| (\(|\[)/);
        if (cut > 0) heading = heading.slice(0, cut);
        heading = heading
          .replace(/^["'\u201c\u201d]+|["'\u201c\u201d.]+$/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
        sections.push({ anchor: `s ${num}`, heading, start: offset });
        registered.add(num);
        last = n;
      }
    }
    body.push(raw);
    offset += raw.length + 1;
  }
  return { sections, body: normalizeText(body.join("\n")) };
}
