"""Rebuild the OOPS Domain content from the "Object-Oriented Programming · Modern C++"
course PDFs (Modules 01-09).

Run from packages/database, with pymupdf and pillow available:

    python3 scripts/oops_pdf_extract.py [--src <dir with the module PDFs>]

    → seed/domain-oops.json        one topic per module: notes + miniProject
    → seed/domain-oops-quiz.json   the "Practice" MCQs, keyed by topic slug
    → apps/web/public/study-notes/oops/<slug>/fig-N.png

then size the figures (`bun run gen:figures` in apps/web) and reseed the subject
(`bun run db:seed-domain-oops`).

The PDFs are found by their COVER, not their file name ("M O D U L E 0 4" on page
one), because the drop names them inconsistently (M3.pdf, DOC-…-WA0002.pdf, …).
`--src` defaults to ./pdfs/OOPS, the layout the other subjects' extractors use.

ONE TOPIC PER MODULE. Each module PDF ends in exactly one Interview Corner, one
five-question Practice set and one Boss Challenge, and the topic page has one tab
for each kind of content:

    Notes        everything up to Practice — the numbered sections, "How the
                 topics connect", Common Misconceptions, Interview Corner, the
                 recaps (a MODULE RECAP printed after the challenge moves up here)
    Practice     the Practice MCQs, parsed into DomainQuestion rows, the answer
                 key's paragraph becoming each question's explanation
    Mini Project the BOSS CHALLENGE section, verbatim (problem, hint, solution)

Module 09 (the capstone) has neither a practice set nor a challenge, so it is a
notes-only topic and shows no tab bar.

The PDFs are WeasyPrint renders, so the structure is recoverable from type and
geometry — the HTML is gone but its CSS is not:

    Poppins-Bold 19       section heading (## — its "01" counter is dropped)
    Poppins-Bold 13       sub-heading (###)
    Poppins 10.2          body; Bold/Italic runs → **/*; JetBrains Mono → `code`
    JetBrains Mono 8      code panel (dark fill) — rebuilt line by line from x
    Poppins-Bold ≤7.8     a callout's label pill (THINK, KEY IDEA, …) → blockquote
    filled header cells   a table; rows are split by hairline rules
    "• " / "1. "          list markers, set apart from the item's text

CODE LIGATURES. The code face is JetBrains Mono with its programming ligatures on,
and the subset's ToUnicode map is wrong for them: `<<` extracts as ":<", `<=` as
":=", `::` sometimes as "=:" or ".:" — and ":=" also stands for `>=`, `==` and
`!=`, so the text alone can't be repaired. The GLYPH ids are intact, though (the
subsets keep the full font's numbering), so the ligature glyph — always the last
of the run, after one or two blank "spacer" glyphs — names the operator exactly.
LIGATURES below was read off a render of every such glyph in the nine files.
"""
import argparse, collections, glob, io, json, os, re, shutil
import pymupdf
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.dirname(HERE)
SEED = os.path.join(DB, "seed")
WEB_FIGS = os.path.join(os.path.dirname(os.path.dirname(DB)), "apps", "web", "public",
                        "study-notes", "oops")

# module number → (slug, title, phase, group label)
MODULES = {
    1: ("foundations", "Foundations: Why OOP Exists", 1, "Getting Started"),
    2: ("classes-and-objects", "Classes & Objects", 1, "Getting Started"),
    3: ("encapsulation-and-abstraction", "Encapsulation & Abstraction", 2, "The Four Pillars"),
    4: ("inheritance", "Inheritance", 2, "The Four Pillars"),
    5: ("polymorphism", "Polymorphism", 2, "The Four Pillars"),
    6: ("relationships", "Relationships: Association, Aggregation & Composition", 3,
        "Designing with Objects"),
    7: ("solid-principles", "SOLID Principles", 3, "Designing with Objects"),
    8: ("design-patterns", "Design Patterns", 3, "Designing with Objects"),
    9: ("interview-capstone", "Interview Capstone", 4, "Interview Prep"),
}

# Ligature glyph id → the operator it draws. The glyph sits LAST in its run; the
# len-1 glyphs before it are spacers whose text is garbage.
LIGATURES = {
    836: "--", 837: "---", 841: "->", 856: "...", 860: "::", 872: "!=", 880: "*>", 881: "*/",
    899: "//", 980: "&&", 987: "||", 997: "++", 1003: "==", 1014: ">=", 1021: "<--",
    1039: "<=", 1046: "<<",
}

FOOTER_Y = 785          # page furniture (module tag, page number, course name) below
CODE_FILL_MAX = 0.12    # a fill this dark is a code panel
TABLE_HEAD = (0.96, 0.96, 0.98)
CALLOUT_LABELS = {
    "THINK", "KEY IDEA", "SPOT THE PROBLEM", "WATCH OUT", "REMEMBER", "PREDICT", "HINT",
    "QUICK CHECK", "ANSWER", "TRY IT", "NOTE", "TIP", "REAL WORLD", "INTERVIEW TIP",
    "COMMON MISTAKE", "IN PRACTICE", "RULE", "RULE OF THUMB", "DEFINITION", "WHY",
}


# ───────────────────────────────────────────────────────────────── page reading

def decode_map(page):
    """(origin x, origin y) → the true character, for every glyph of a ligature run."""
    fixed = {}
    for t in page.get_texttrace():
        if "Mono" not in t["font"]:
            continue
        ch = t["chars"]
        for i, c in enumerate(ch):
            lig = LIGATURES.get(c[1])
            if not lig:
                continue
            n = len(lig)
            for k in range(n):
                j = i - (n - 1) + k
                if j >= 0:
                    o = ch[j][2]
                    fixed[(round(o[0], 1), round(o[1], 1))] = lig[k]
    return fixed


class Span:
    __slots__ = ("text", "font", "size", "color", "x0", "x1", "y0", "y1", "base", "chars")

    def __init__(self, s, fixed):
        chars = []
        for c in s["chars"]:
            o = c["origin"]
            chars.append((fixed.get((round(o[0], 1), round(o[1], 1)), c["c"]), c["bbox"][0], c["bbox"][2]))
        self.chars = chars
        self.text = "".join(c[0] for c in chars)
        self.font, self.size, self.color = s["font"], s["size"], s["color"]
        self.x0, self.y0, self.x1, self.y1 = s["bbox"]
        self.base = s["origin"][1]

    @property
    def mono(self): return "Mono" in self.font
    @property
    def bold(self): return "Bold" in self.font or "weight=5" in self.font or "weight=6" in self.font
    @property
    def italic(self): return "Italic" in self.font or "Oblique" in self.font


def page_spans(page):
    fixed = decode_map(page)
    out = []
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                sp = Span(s, fixed)
                if sp.text and sp.y0 < FOOTER_Y:
                    out.append(sp)
    return out


def visual_lines(spans):
    """Group spans that share a baseline into one left-to-right line."""
    rows = []
    for s in sorted(spans, key=lambda s: (round(s.base, 0), s.x0)):
        if rows and abs(rows[-1][0].base - s.base) < 2.5:
            rows[-1].append(s)
        else:
            rows.append([s])
    for r in rows:
        r.sort(key=lambda s: s.x0)
    return rows


def inside(s, r, pad=1.5):
    cx, cy = (s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2
    return r.x0 - pad <= cx <= r.x1 + pad and r.y0 - pad <= cy <= r.y1 + pad


# ───────────────────────────────────────────────────────────────── inline text

def inline_md(spans):
    """Spans of one paragraph → markdown with **bold**, *italic*, `code`."""
    parts = []  # (style, text)
    for s in spans:
        t = s.text
        style = "code" if s.mono else ("b" if s.bold else ("i" if s.italic else ""))
        if not t.strip() and parts:
            # a space between two runs of the same style stays inside the run
            parts[-1] = (parts[-1][0], parts[-1][1] + t)
            continue
        if parts and parts[-1][0] == style:
            parts[-1] = (style, parts[-1][1] + t)
        else:
            parts.append((style, t))
    out = ""
    for style, t in parts:
        if not style:
            out += t
            continue
        lead = t[: len(t) - len(t.lstrip())]
        trail = t[len(t.rstrip()):]
        core = t.strip()
        if style == "code":
            core = core.replace("`", "'")
            out += f"{lead}`{core}`{trail}"
        elif style == "b":
            out += f"{lead}**{core}**{trail}"
        else:
            out += f"{lead}*{core}*{trail}"
    return tidy(out)


def tidy(s):
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\s+([,.;:!?)])(?=\s|$|[,.;:!?)])", r"\1", s)   # "`x` ," → "`x`,"
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"` '(?=s\b)", "`'", s)                         # "`Van` 's" → "`Van`'s"
    s = re.sub(r"` -(?=\w)", "`-", s)                          # "`x` -style" → "`x`-style"
    s = re.sub(r"\*\*(\s*)\*\*", r"\1", s)                  # bold run re-opened at a wrap
    s = s.replace("→", " → ").replace("  ", " ")
    s = re.sub(r" {2,}", " ", s)
    return s.strip()


def join_lines(lines):
    """Join wrapped lines of one paragraph. A line ending in a hyphenated word
    ("well-" / "designed") is glued without a space."""
    spans = []
    for i, ln in enumerate(lines):
        if i and spans:
            prev = spans[-1].text
            if not (prev.endswith("-") and len(prev) > 1 and prev[-2].isalpha()):
                spans.append(_space_like(spans[-1]))
        spans.extend(ln)
    return spans


def _space_like(s):
    sp = Span.__new__(Span)
    sp.text, sp.font, sp.size, sp.color = " ", "Poppins", s.size, s.color
    sp.x0 = sp.x1 = s.x1
    sp.y0, sp.y1, sp.base, sp.chars = s.y0, s.y1, s.base, []
    return sp


# ───────────────────────────────────────────────────────────────── blocks

def code_text(spans):
    """A code panel's spans → source text, columns recovered from x."""
    spans = [s for s in spans if not (s.size < 7 and s.text.strip() in ("C++", "C", "OUTPUT", "TERMINAL"))]
    if not spans:
        return ""
    chars = [(c, x0, x1, s.base) for s in spans for (c, x0, x1) in s.chars]
    widths = sorted(x1 - x0 for c, x0, x1, _ in chars if c.strip() and x1 - x0 > 0.5)
    cw = widths[len(widths) // 2] if widths else 4.8
    left = min(x0 for c, x0, x1, _ in chars if c.strip())
    rows = collections.OrderedDict()
    for c, x0, x1, base in sorted(chars, key=lambda t: (t[3], t[1])):
        key = next((k for k in rows if abs(k - base) < 2.5), base)
        rows.setdefault(key, []).append((c, x0))
    keys = sorted(rows)
    # Line pitch → blank lines between statements survive.
    pitch = min((b - a for a, b in zip(keys, keys[1:]) if b - a > 3), default=12.5)
    lines, prev = [], None
    for k in keys:
        if prev is not None:
            for _ in range(int(round((k - prev) / pitch)) - 1):
                lines.append("")
        buf = []
        for c, x0 in rows[k]:
            col = int(round((x0 - left) / cw))
            while len(buf) < col:
                buf.append(" ")
            if len(buf) > col and c == " ":
                continue
            buf.append(c)
        lines.append("".join(buf).rstrip())
        prev = k
    return "\n".join(lines).strip("\n")


def table_md(rows):
    """rows: list of list of cell-markdown. First row is the header."""
    w = max(len(r) for r in rows)
    rows = [r + [""] * (w - len(r)) for r in rows]
    esc = lambda c: c.replace("|", "\\|").replace("\n", " ")
    head = rows[0]
    if not any(h.strip() for h in head):
        head = [" "] * w
    out = ["| " + " | ".join(esc(c) or " " for c in head) + " |",
           "|" + "|".join([" --- "] * w) + "|"]
    for r in rows[1:]:
        out.append("| " + " | ".join(esc(c) for c in r) + " |")
    return "\n".join(out)


def text_base(ln):
    """Baseline of a line's body text (a label pill or code pill can sit apart)."""
    body = [s for s in ln if s.text.strip() and not s.mono and s.size > 8]
    return (body or ln)[0].base


def para_blocks(lines):
    """Visual lines (no code/table/image) → list of ('p'|'li'|'h2'|'h3'|'label'|'caption', …)."""
    out = []
    cur, cur_kind, cur_meta = [], None, None

    def flush():
        nonlocal cur, cur_kind, cur_meta
        if cur:
            out.append((cur_kind, inline_md(join_lines(cur)), cur_meta))
        cur, cur_kind, cur_meta = [], None, None

    # Paragraph breaks are read from BASELINE pitch, not box gaps: an inline-code
    # pill sits ~2pt lower than the text around it, so a wrapped line that starts
    # with `code` would otherwise look like a fresh paragraph.
    prev_bottom, prev_x, prev_base, after_label = None, None, None, False
    for ln in lines:
        first = ln[0]
        text = "".join(s.text for s in ln).strip()
        if not text:
            continue
        size = max(s.size for s in ln if s.text.strip())
        # Headings
        if any(s.bold and abs(s.size - 19) < 0.6 for s in ln):
            flush()
            # drop the "01" section counter, but keep inline code in the title
            # ("2.4 The `this` reference")
            words = [s for s in ln if not (s.mono and s.size > 10.5 and re.fullmatch(r"\d{2}", s.text.strip()))]
            t = inline_md(words)
            if out and out[-1][0] == "h2" and prev_bottom is not None and first.y0 - prev_bottom < 6:
                out[-1] = ("h2", out[-1][1] + " " + t, None)
            else:
                out.append(("h2", t.replace("**", ""), None))
            prev_bottom = max(s.y1 for s in ln)
            continue
        if all(s.bold for s in ln if s.text.strip()) and abs(size - 13) < 0.6:
            flush(); out.append(("h3", inline_md(ln).replace("**", ""), None)); prev_bottom = max(s.y1 for s in ln); continue
        # Figure caption: "VISUAL N" + italic line
        if first.bold and first.size < 7.6 and first.text.strip().startswith("VISUAL"):
            flush()
            out.append(("caption", inline_md(ln[1:]), first.text.strip()))
            prev_bottom = max(s.y1 for s in ln)
            continue
        # Callout label pill
        lab = first.text.strip()
        if first.bold and first.size < 8 and lab.isupper() and len(lab) > 2:
            flush()
            out.append(("label", lab, None))
            ln = ln[1:]
            if not "".join(s.text for s in ln).strip():
                prev_bottom = first.y1
                continue
            first = ln[0]
            # The label shares a baseline with the callout's first line, so that
            # line opens a paragraph and the lines under it continue it.
            cur_kind, cur_meta = "p", None
            cur.append(ln)
            prev_bottom = max(s.y1 for s in ln)
            prev_base, after_label = text_base(ln), True
            prev_x = None
            continue
        # List marker
        m_text = first.text.strip()
        marker = None
        if m_text in ("•", "◦", "▪") or re.fullmatch(r"\d{1,2}\.", m_text) or re.fullmatch(r"[A-D]\.", m_text):
            marker = m_text
            ln = ln[1:]
            if not ln:
                # marker alone; text may follow on this baseline from another block
                continue
        new_para = (
            marker is not None or cur_kind is None or prev_bottom is None
            or prev_base is None
            # the line under a label pill sits ~4pt further down than a plain wrap
            or text_base(ln) - prev_base > 1.85 * size + (5 if after_label else 0)
            or (cur_kind == "p" and prev_x is not None and ln[0].x0 > prev_x + 8 and cur_meta is None)
        )
        if new_para:
            flush()
            cur_kind = "li" if marker else "p"
            cur_meta = marker
        cur.append(ln)
        prev_bottom = max(s.y1 for s in ln)
        prev_base, after_label = text_base(ln), False
        prev_x = ln[0].x0
    flush()
    return out


def page_items(doc, pno, figs_out):
    """One page → ordered list of (y, kind, payload)."""
    page = doc[pno]
    spans = page_spans(page)
    drawings = page.get_drawings()
    items = []
    used = set()

    # Code panels
    panels = []
    for d in drawings:
        f = d.get("fill")
        r = d["rect"]
        if f and max(f) < CODE_FILL_MAX and r.width > 150 and r.height > 15:
            if not any(abs(p.y0 - r.y0) < 1 and abs(p.x0 - r.x0) < 1 for p in panels):
                panels.append(r)
    for r in panels:
        mine = [s for s in spans if id(s) not in used and inside(s, r)]
        # Mid-page section headings sit on a dark band too — that is not code.
        if not any(s.mono and s.size < 9.5 for s in mine) or any(s.size > 15 for s in mine):
            continue
        for s in mine:
            used.add(id(s))
        txt = code_text(mine)
        # Source panels carry a "C++" pill; the unlabelled ones are program
        # output and console sessions, fenced as plain text.
        lang = "cpp" if any(s.size < 7 and s.text.strip() == "C++" for s in mine) else "text"
        if txt.strip():
            items.append((r.y0, "code", (txt, lang)))

    # Tables: rows of light header cells
    heads = collections.defaultdict(list)
    for d in drawings:
        f = d.get("fill")
        r = d["rect"]
        if f and all(abs(a - b) < 0.012 for a, b in zip(f, TABLE_HEAD)) and 15 < r.height < 40 and r.width > 30:
            heads[round(r.y0)].append(r)
    for y, cells in heads.items():
        cells = sorted({(round(c.x0), round(c.x1)): c for c in cells}.values(), key=lambda c: c.x0)
        if len(cells) < 2:
            continue
        x0, x1 = cells[0].x0, cells[-1].x1
        # header-cell fills sometimes skip the first column; widen to the body edge
        if x0 > 60 and any(s.x0 < x0 - 5 and s.y0 > cells[0].y0 - 2 and s.y1 < cells[0].y1 + 2 for s in spans):
            cells.insert(0, pymupdf.Rect(51, cells[0].y0, cells[0].x0, cells[0].y1))
            x0 = 51
        bounds = [c.x0 for c in cells] + [x1]
        seps = sorted({round(d["rect"].y0, 1) for d in drawings
                       if not d.get("fill") and d["rect"].height < 1 and d["rect"].y0 > cells[0].y1 - 1
                       and d["rect"].x0 >= x0 - 1 and d["rect"].x1 <= x1 + 1})
        # header + body rows; the last row has no rule beneath it
        body = [s for s in spans if id(s) not in used and x0 - 2 <= s.x0 <= x1 and s.y0 > cells[0].y0 - 2]
        body.sort(key=lambda s: s.y0)
        edges = [cells[0].y0 - 1] + [v for v in seps]
        # extend the final row while lines keep coming without a gap
        last = edges[-1]
        bottom = last
        for s in body:
            if s.y0 >= last - 1:
                if s.y0 - bottom > 10 and bottom > last:
                    break
                if s.y0 - last > 60:
                    break
                bottom = max(bottom, s.y1)
        edges.append(bottom + 1)
        rows = []
        for a, b in zip(edges, edges[1:]):
            row_spans = [s for s in body if a - 1 <= (s.y0 + s.y1) / 2 <= b]
            if not row_spans:
                continue
            row = []
            for c0, c1 in zip(bounds, bounds[1:]):
                cs = [s for s in row_spans if c0 - 3 <= s.x0 < c1 - 3]
                for s in cs:
                    used.add(id(s))
                lines = visual_lines(cs)
                row.append(inline_md(join_lines(lines)) if lines else "")
            rows.append(row)
        if rows:
            # header labels are styled small caps; read them as words
            rows[0] = [h.replace("**", "").title() if h.isupper() or h.replace("**", "").isupper() else h.replace("**", "") for h in rows[0]]
            items.append((cells[0].y0, "table", table_md(rows)))

    # Images actually placed on this page (not the heading underline)
    for info in page.get_image_info(xrefs=True):
        r = pymupdf.Rect(info["bbox"])
        if r.width < 200 or r.height < 60 or not info.get("xref"):
            continue
        figs_out.append(info["xref"])
        items.append((r.y0, "img", (len(figs_out), r)))

    # Remaining text → paragraphs, split into runs between the boxes above
    rest = [s for s in spans if id(s) not in used]
    # Callout boxes: light full-width fills holding a label pill
    boxes = []
    for d in drawings:
        f = d.get("fill")
        r = d["rect"]
        if f and min(f) > 0.85 and r.width > 400 and r.height > 25 and r not in boxes:
            if not any(abs(b.y0 - r.y0) < 1 and abs(b.y1 - r.y1) < 1 for b in boxes):
                boxes.append(r)
    lines = visual_lines(rest)
    groups = []  # (y, box-or-None, [lines])
    for ln in lines:
        y = ln[0].y0
        box = next((b for b in boxes if b.y0 - 1 <= y <= b.y1 + 1 and ln[0].x0 > b.x0 + 3), None)
        if groups and groups[-1][1] is box and box is not None:
            groups[-1][2].append(ln)
        elif groups and box is None and groups[-1][1] is None and not _crosses(items, groups[-1][2][-1], ln):
            groups[-1][2].append(ln)
        else:
            groups.append((y, box, [ln]))
    for y, box, lns in groups:
        blocks = para_blocks(lns)
        if box is not None and blocks and blocks[0][0] == "label":
            items.append((y, "callout", blocks))
        else:
            for b in blocks:
                items.append((y, "blocks", [b]))
                y += 0.01
    items.sort(key=lambda t: t[0])
    return items


def _crosses(items, a, b):
    ya, yb = a[0].y1, b[0].y0
    return any(ya - 1 <= it[0] <= yb + 1 for it in items if it[1] in ("code", "table", "img"))


# ───────────────────────────────────────────────────────────────── module → markdown

def strip_dash(t):
    """The PDF often prints its own "—" after a label pill: "ANSWER — B, it prints"."""
    t = t.strip()
    t = re.sub(r"^(\*\*|\*)?\s*—\s*", lambda m: m.group(1) or "", t)
    return t.lstrip(" —")


def label_title(lab):
    return lab.capitalize() if lab != "KEY IDEA" else "Key idea"


def blocks_to_md(blocks):
    out = []
    pending_label = None
    for kind, text, meta in blocks:
        if kind == "label":
            pending_label = text
            continue
        if kind == "h2":
            out.append(f"## {text}")
        elif kind == "h3":
            out.append(f"### {text}")
        elif kind == "li":
            mark = meta if re.fullmatch(r"\d{1,2}\.", meta or "") else "-"
            if meta and re.fullmatch(r"[A-D]\.", meta):
                text = f"**{meta[0]}.** {text}"
            out.append(f"{mark} {text}")
        else:
            if pending_label:
                text = f"**{label_title(pending_label)}** — {strip_dash(text)}"
                pending_label = None
            out.append(text)
    if pending_label:
        out.append(f"**{label_title(pending_label)}**")
    # consecutive list items are one list
    md = ""
    for i, b in enumerate(out):
        if i:
            li_prev = re.match(r"(-|\d{1,2}\.) ", out[i - 1])
            li_cur = re.match(r"(-|\d{1,2}\.) ", b)
            md += "\n" if (li_prev and li_cur) else "\n\n"
        md += b
    return md


def callout_md(blocks):
    label = blocks[0][1]
    body = blocks_to_md(blocks[1:]) if len(blocks) > 1 else ""
    first, _, rest = body.partition("\n")
    head = f"**{label_title(label)}** — {strip_dash(first)}" if first and not first.startswith(("-", "1.", "#")) else f"**{label_title(label)}**\n\n{first}"
    text = head + ("\n" + rest if rest else "")
    return "\n".join("> " + l if l.strip() else ">" for l in text.split("\n"))


def module_number(doc):
    m = re.search(r"M O D U L E\s+((?:\d\s*){2})", doc[0].get_text())
    return int(m.group(1).replace(" ", "")) if m else None


def cover(doc):
    """(subtitle, learning outcomes) from the cover and contents pages."""
    lines = [l.strip() for l in doc[0].get_text().split("\n") if l.strip()]
    # cover: …, MODULE nn, TITLE (1-2 lines), tagline (1-2 lines), blurb…, "1.1", …
    i = next(i for i, l in enumerate(lines) if l.startswith("M O D U L E"))
    rest = lines[i + 1:]
    j = 0
    while j < len(rest) and rest[j].isupper():
        j += 1
    tag = []
    while j < len(rest) and not re.fullmatch(r"\d\.\d", rest[j]) and not rest[j].startswith("R E A D"):
        tag.append(rest[j]); j += 1
    tagline = " ".join(tag)
    return re.split(r"\s+(?:Written for beginners|Not a definition)", tagline)[0].strip()


def extract_module(path):
    doc = pymupdf.open(path)
    num = module_number(doc)
    slug, title, phase, group = MODULES[num]
    tagline = cover(doc)

    xrefs = []
    stream = []  # (kind, payload)
    for pno in range(1, len(doc)):
        for y, kind, payload in page_items(doc, pno, xrefs):
            if pno == 1 and kind != "callout" and y < 0:
                continue
            stream.append((pno, kind, payload))

    # A paragraph cut by a page break: the last paragraph on a page ends mid-
    # sentence and the next page opens in lower case — they are one paragraph.
    stitched = []
    for item in stream:
        pno, kind, payload = item
        if (stitched and kind == "blocks" and payload[0][0] == "p"
                and stitched[-1][1] == "blocks" and stitched[-1][0] == pno - 1):
            pk, ptext, pmeta = stitched[-1][2][0]
            k, text, meta = payload[0]
            if pk == "p" and k == "p" and not re.fullmatch(r"Q\d+", ptext) and not re.search(r"[.:?!)\"'”]$", ptext) \
                    and (text[:1].islower() or text[:1] == "`"):
                stitched[-1] = (pno, "blocks", [(pk, ptext + " " + text, pmeta)])
                continue
        stitched.append(item)
    stream = stitched

    # Page 2 is the contents page: keep only the outcomes list and the how-to note.
    intro_md = []
    p2 = [s for s in stream if s[0] == 1]
    stream = [s for s in stream if s[0] != 1]
    # The outcomes sit in a boxed list ("BY THE END OF THIS MODULE YOU WILL BE
    # ABLE TO"); the how-to note is a plain paragraph under it.
    outcomes = []
    for _, kind, payload in p2:
        if kind == "callout" and payload[0][1].startswith("BY THE END"):
            outcomes += [f"- {text}" for k, text, _m in payload[1:] if k == "li"]
        elif kind == "blocks":
            k, text, meta = payload[0]
            if k == "p" and text.startswith("**How to use this module"):
                intro_md.append("> " + text)
    if outcomes:
        intro_md.insert(0, "## What you'll learn\n\n" + "\n".join(outcomes))

    # Walk the stream, cutting it into named sections at each "##".
    sections = [["_intro", []]]
    for pno, kind, payload in stream:
        if kind == "blocks":
            k, text, meta = payload[0]
            if k == "h2":
                sections.append([text, []])
                continue
            # A caption belongs to the figure just above it.
            if k == "caption":
                cur = sections[-1][1]
                for idx in range(len(cur) - 1, -1, -1):
                    if cur[idx][0] == "img":
                        cur[idx] = ("img", (cur[idx][1][0], text or meta))
                        break
                continue
            sections[-1][1].append(("b", payload[0]))
        elif kind == "img":
            sections[-1][1].append(("img", (payload[0], None)))
        else:
            sections[-1][1].append((kind, payload))

    def render(items, promote=False):
        md, run = [], []

        def flush():
            if run:
                md.append(blocks_to_md(run))
                run.clear()

        for kind, payload in items:
            if kind == "b":
                k, text, meta = payload
                if promote and k == "h3":
                    payload = ("h2", text, meta)
                run.append(payload)
                continue
            flush()
            if kind == "code":
                txt, lang = payload
                md.append(f"```{lang}\n{txt}\n```")
            elif kind == "table":
                md.append(payload)
            elif kind == "callout":
                md.append(callout_md(payload))
            elif kind == "img":
                n, cap = payload
                alt = (cap or f"Figure {n}").replace("*", "").replace("[", "(").replace("]", ")")
                md.append(f"![{alt}](/study-notes/oops/{slug}/fig-{n}.png)")
                if cap:
                    md.append(f"*{cap.strip('*')}*")
        flush()
        return "\n\n".join(m for m in md if m.strip())

    notes, recap_after, practice, boss = [], [], None, None
    seen_boss = False
    for name, items in sections:
        key = name.replace("*", "").strip().lower()
        if name == "_intro":
            body = render(items)
            notes.append("\n\n".join(intro_md + ([body] if body else [])))
        elif key == "practice":
            practice = items
        elif key.startswith("boss challenge"):
            boss = items
            seen_boss = True
        elif seen_boss:
            recap_after.append(f"## {pretty_heading(name)}\n\n{render(items)}")
        else:
            body = render(items)
            if key == "common misconceptions":
                body = re.sub(r"\s*✅\s*", "  \n✅ ", body)
                body = re.sub(r"\s*💡\s*", "  \n💡 ", body)
            notes.append(f"## {pretty_heading(name)}\n\n{body}")
    notes.extend(recap_after)

    questions = parse_practice(practice, slug, render) if practice else []
    mini = render(boss, promote=True) if boss else None

    # Figures: renumbered 1..N in reading order (notes → practice → project) so
    # the files have no gaps, then written for gen:figures.
    notes_md = "\n\n".join(n for n in notes if n.strip()).strip() + "\n"
    pat = re.compile(rf"/study-notes/oops/{re.escape(slug)}/fig-(\d+)\.png")
    order = []
    for text in [notes_md] + [q["prompt"] for q in questions] + [mini or ""]:
        for m in pat.finditer(text):
            if int(m.group(1)) not in order:
                order.append(int(m.group(1)))
    renum = {old: i + 1 for i, old in enumerate(order)}
    fix = lambda t: pat.sub(lambda m: f"/study-notes/oops/{slug}/fig-{renum[int(m.group(1))]}.png", t) if t else t
    notes_md, mini = fix(notes_md), fix(mini)
    for q in questions:
        q["prompt"] = fix(q["prompt"])
    figures = [(renum[old], xrefs[old - 1]) for old in order]
    return doc, num, {
        "subject": "OOPS",
        "phase": phase,
        "groupLabel": group,
        "order": num,
        "slug": slug,
        "title": title,
        "summary": tagline,
        "notes": notes_md,
        "miniProject": (mini.strip() + "\n") if mini else None,
        "figures": len(figures),
    }, questions, figures


def pretty_heading(h):
    h = h.replace("**", "")
    if h.isupper():
        return h.title()
    return h


def parse_practice(items, slug, render):
    """Practice section → DomainQuestion JSON. Questions start at a "Q<n>" line; the
    "Reveal Answers" key supplies answer + explanation."""
    qs, cur = [], None
    key_mode = False
    answers = {}
    preamble = []  # a figure printed before Q1 that several questions refer to
    for kind, payload in items:
        if kind == "b":
            k, text, meta = payload
            plain = text.replace("*", "").replace("`", "").strip()
            if re.fullmatch(r"Reveal Answers?", plain, re.I) or plain.lower().startswith("answer key"):
                key_mode = True
                continue
            if key_mode:
                m = re.match(r"^\**\s*Q(\d+)\s*→\s*([A-D])\b", text.replace("**", "").strip())
                if m:
                    n, letter = int(m.group(1)), m.group(2)
                    expl = re.sub(r"^\**\s*Q\d+\s*→\s*[A-D]\s*\**\s*", "", text).strip()
                    expl = expl.lstrip("*").strip()
                    answers[n] = (letter.lower(), expl)
                elif answers:
                    last = max(answers)
                    answers[last] = (answers[last][0], answers[last][1] + "\n\n" + text)
                continue
            m = re.fullmatch(r"Q(\d+)", plain)
            if m:
                cur = {"n": int(m.group(1)), "prompt": [], "options": []}
                qs.append(cur)
                continue
            if cur is None:
                continue
            if k == "li" and meta and re.fullmatch(r"[A-D]\.", meta):
                cur["options"].append({"key": meta[0].lower(), "label": text})
                continue
            if cur["options"] and k == "p":
                # an option that wrapped onto a second visual line
                cur["options"][-1]["label"] += " " + text
                continue
            cur["prompt"].append(("b", payload))
        elif cur is not None and not key_mode:
            cur["prompt"].append((kind, payload))
        elif cur is None and kind == "img":
            preamble.append((kind, payload))
    out = []
    for q in qs:
        if q["n"] not in answers:
            raise SystemExit(f"{slug}: Q{q['n']} has no answer in the key")
        letter, expl = answers[q["n"]]
        if letter not in {o["key"] for o in q["options"]}:
            raise SystemExit(f"{slug}: Q{q['n']} answer {letter} not among its options")
        prompt = q["prompt"]
        if preamble:
            text = " ".join(p[1][1] for p in prompt if p[0] == "b")
            # "Look at fragment A" / "diagram B": the shared figure goes with the
            # question, since the Practice tab shows questions only.
            if re.search(r"\b(fragment|diagram|figure|picture|image)\b", text, re.I):
                prompt = preamble + prompt
        out.append({
            "subject": "OOPS",
            "topicSlug": slug,
            "order": q["n"],
            "prompt": render(prompt),
            "options": q["options"],
            "answerKey": letter,
            "explanation": clean_expl(expl),
        })
    return out


def clean_expl(e):
    """The key's paragraph after "Q1 → B": "( `2 1` ) a and b…" or ". A plain…".
    The parenthetical restates the answer, so it stays, tightened."""
    e = e.replace("**", "")
    e = re.sub(r"\(\s+", "(", e)
    e = re.sub(r"\s+\)", ")", e)
    e = re.sub(r"^[.,:;—\s]+", "", e)
    e = re.sub(r"^(\([^)]*\))\.?\s*", r"\1 ", e)
    return e.strip()


def save_png(doc, xref, dest):
    info = doc.extract_image(xref)
    im = Image.open(io.BytesIO(info["image"]))
    if im.mode != "RGB":
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1] if im.mode in ("RGBA", "LA") else None)
        im = bg
    im.save(dest, "PNG", optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(DB, "pdfs", "OOPS"))
    args = ap.parse_args()

    found = {}
    for path in sorted(glob.glob(os.path.join(args.src, "*.pdf"))):
        try:
            n = module_number(pymupdf.open(path))
        except Exception:
            n = None
        if n in MODULES:
            if n in found:
                raise SystemExit(f"Module {n} found twice: {found[n]} and {path}")
            found[n] = path
    missing = sorted(set(MODULES) - set(found))
    if missing:
        raise SystemExit(f"Missing module PDF(s) {missing} under {args.src}")

    topics, quiz = [], []
    if os.path.isdir(WEB_FIGS):
        shutil.rmtree(WEB_FIGS)
    for n in sorted(found):
        doc, num, topic, questions, figures = extract_module(found[n])
        d = os.path.join(WEB_FIGS, topic["slug"])
        os.makedirs(d, exist_ok=True)
        for fig_no, xref in figures:
            save_png(doc, xref, os.path.join(d, f"fig-{fig_no}.png"))
        topics.append(topic)
        quiz.extend(questions)
        print(f"M{num:02} {topic['slug']:32} notes={len(topic['notes']):6} "
              f"mini={len(topic['miniProject'] or ''):5} mcq={len(questions)} figs={len(figures)}"
              f"  ← {os.path.basename(found[n])}")

    with open(os.path.join(SEED, "domain-oops.json"), "w") as f:
        json.dump(topics, f, indent=1, ensure_ascii=False)
        f.write("\n")
    with open(os.path.join(SEED, "domain-oops-quiz.json"), "w") as f:
        json.dump(quiz, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{len(topics)} topics, {len(quiz)} questions")


if __name__ == "__main__":
    main()
