"""Prove the OOPS seed carries the WHOLE of each course PDF — run after
`oops_pdf_extract.py`, from packages/database:

    python3 scripts/oops_pdf_verify.py [--src <dir with the module PDFs>]

For every module it compares the words on the PDF's pages (ligatures decoded,
page furniture and the cover/contents pages excluded) against everything the
seed holds for that topic — notes, mini project, MCQ prompts, options and
explanations — as multisets, so a dropped sentence, a lost code line or a
skipped table row shows up as a missing word, reported in context. It also
checks every "VISUAL N" in the PDF became a figure file that the markdown
points at, and that every MCQ has 4 options and a key among them.

Exit status is non-zero if anything is missing, so it can gate a reseed.
"""
import argparse, collections, difflib, json, os, re, sys
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oops_pdf_extract as X  # noqa: E402

# Text the seed drops ON PURPOSE: the PDF's own navigation and print furniture.
FURNITURE = re.compile(
    r"^(C\+\+|Reveal Answers|Five questions\..*|BOSS CHALLENGE|Practice|VISUAL \d+|\d{2}|"
    r"Object-Oriented Programming · Modern C\+\+|M\d · .*)$")
WORD = re.compile(r"[A-Za-z0-9_]+")


def pdf_words(path):
    doc = pymupdf.open(path)
    words, ctx, seq = collections.Counter(), {}, []
    n_line = [0]

    def add_line(text, pno, seg_no, spans):
        if FURNITURE.match(text):
            return
        text = re.sub(r"^\d{2} (?=\S)", "", text)
        text = re.sub(r"^VISUAL \d+ ?", "", text)
        text = re.sub(r"^[A-D]\. ?", "", text)
        text = re.sub(r"^Q\d+$", "", text)
        # "Q1 → B (2 1) a and b…": the letter becomes the answerKey
        text = re.sub(r"^Q\d+ → [A-D]\b\.?", "", text)
        if FURNITURE.match(text) or re.fullmatch(r"(Answer key|Reveal Answers?)", text, re.I):
            return
        n_line[0] += 1
        where = (n_line[0], f"p{pno + 1}: {text[:100]}", tuple(spans))
        for w in WORD.findall(text.lower()):
            words[w] += 1
            ctx.setdefault(w, where[1])
            seq.append((w, where))

    for pno in range(2, len(doc)):  # page 1 cover, page 2 contents
        page = doc[pno]
        for ln in X.visual_lines(X.page_spans(page)):
            # Spans that don't touch are separate words (aligned code columns).
            # A wide gap splits a line into SEGMENTS — table cells side by side,
            # whose wrapped text continues in the cell, not across the row.
            segs, cur = [], ""
            for i, s in enumerate(ln):
                gap = s.x0 - ln[i - 1].x1 if i else 0
                if i and gap > 14 and not ln[i - 1].mono:
                    segs.append(cur); cur = ""
                elif i and gap > 1.5 and not cur.endswith(" "):
                    cur += " "
                cur += s.text
            segs.append(cur)
            for seg_no, text in enumerate(segs):
                add_line(text.strip(), pno, seg_no, [x.text for x in ln])
    return doc, words, ctx, seq


def seed_words(topic, questions):
    parts = [topic["notes"], topic.get("miniProject") or ""]
    for q in questions:
        parts += [q["prompt"], q.get("explanation") or ""] + [o["label"] for o in q["options"]]
    text = "\n".join(parts)
    # image paths and the headings we add are not PDF words
    text = re.sub(r"\]\(/study-notes/[^)]*\)", "]", text)
    return WORD.findall(text.lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(X.DB, "pdfs", "OOPS"))
    args = ap.parse_args()
    topics = {t["slug"]: t for t in json.load(open(os.path.join(X.SEED, "domain-oops.json")))}
    quiz = json.load(open(os.path.join(X.SEED, "domain-oops-quiz.json")))

    failed = False
    for name in sorted(os.listdir(args.src)):
        if not name.endswith(".pdf"):
            continue
        path = os.path.join(args.src, name)
        num = X.module_number(pymupdf.open(path))
        if num not in X.MODULES:
            continue
        slug = X.MODULES[num][0]
        t = topics[slug]
        qs = [q for q in quiz if q["topicSlug"] == slug]
        doc, have, ctx, seq = pdf_words(path)
        seed_seq = seed_words(t, qs)

        # Line by line: every visual line of the PDF must appear, its words
        # contiguous and in order, somewhere in the seed. Line granularity is what
        # makes this robust — the seed legitimately REORDERS blocks (a module recap
        # printed after the challenge moves into the notes; the answer key becomes
        # per-question explanations; a question's code panel leads its prompt) but
        # it never reorders words inside a line.
        seed_text = " " + " ".join(seed_seq) + " "
        lines = collections.OrderedDict()
        for w, where in seq:
            lines.setdefault(where, []).append(w)  # keyed by line number: repeats stay apart
        losses = []
        for where, words in lines.items():
            if (" " + " ".join(words) + " ") in seed_text:
                continue
            # Fallback for table rows: every span's words, each contiguous.
            pieces = [WORD.findall(t.lower()) for t in where[2]]
            if all((" " + " ".join(p) + " ") in seed_text for p in pieces if p):
                continue
            losses.append((len(words), " ".join(words), where[1], ""))
        lost = sum(n for n, *_ in losses)
        total = len(seq)

        # Figures: one per "VISUAL N" label, each file present and referenced.
        visuals = sum(1 for p in range(1, len(doc)) for i in doc[p].get_image_info()
                      if i["bbox"][2] - i["bbox"][0] >= 200 and i["bbox"][3] - i["bbox"][1] >= 60)
        md = t["notes"] + (t.get("miniProject") or "") + "".join(q["prompt"] for q in qs)
        refs = re.findall(rf"/study-notes/oops/{slug}/(fig-\d+\.png)", md)
        on_disk = set(os.listdir(os.path.join(X.WEB_FIGS, slug))) if os.path.isdir(os.path.join(X.WEB_FIGS, slug)) else set()
        fig_problems = [r for r in refs if r not in on_disk]

        mcq_problems = [q["order"] for q in qs
                        if len(q["options"]) != 4 or q["answerKey"] not in {o["key"] for o in q["options"]}
                        or not q.get("explanation")]

        ok = lost == 0 and not fig_problems and len(refs) >= visuals and not mcq_problems
        failed |= not ok
        print(f"{'OK  ' if ok else 'FAIL'} M{num:02} {slug:30} words {total - lost}/{total}"
              f"  figures {len(set(refs))}/{visuals}  mcq {len(qs)}"
              f"  mini {'yes' if t.get('miniProject') else 'no'}")
        for n, run, where, instead in losses[:40]:
            print(f"      lost {run[:70]!r}  ({where})" + (f"  seed has {instead[:50]!r}" if instead else ""))
        if fig_problems:
            print(f"      figure files missing: {fig_problems}")
        if len(refs) < visuals:
            print(f"      only {len(refs)} figures for {visuals} placed images")
        if mcq_problems:
            print(f"      malformed MCQs: {mcq_problems}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
