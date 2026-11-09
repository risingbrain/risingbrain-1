import type { ReactNode } from "react";

/**
 * Hints are authored as plain prose with code mixed in ("Start with l = 0 and
 * r = n-1. If nums[l] + nums[r] < target do l++"). In a proportional font the
 * code blends into the sentence — `l` reads as `I`, `O(n^2)` looks like noise —
 * so this splits a hint into prose and code segments and renders the code in a
 * monospace chip. It is a heuristic over ~600 hand-written hints, tuned to
 * avoid false positives in prose: English words only become code when an
 * operator ties them to something that already is code.
 */

export type HintSegment = { code: boolean; text: string };

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
  "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", n: "ⁿ", k: "ᵏ", m: "ᵐ",
};

/** `n^2` → `n²`, `2^n` → `2ⁿ` (only for single-char exponents we can map). */
function superscripts(s: string): string {
  const sup = (e: string) => [...e].map((c) => SUP[c] ?? c).join("");
  return s.replace(/\^(?:\((\d+|[nkm])\)|(\d+|[nkm])(?![A-Za-z]))/g, (_all, a?: string, b?: string) =>
    sup((a ?? b)!),
  );
}

const OPERATORS = new Set([
  "=", "==", "===", "!=", "<", ">", "<=", ">=", "+", "*", "/", "%",
  "+=", "-=", "*=", "/=", "&&", "||", "^", "<<", ">>", "&", "|",
]);

// Single letters conventionally used as variables. "a" and "I" are excluded:
// in prose they are almost always English.
const VAR_LETTER = /^[ijklmnrxyzpqcuvw]$/;

const unbalanced = (w: string) =>
  w.split("[").length !== w.split("]").length ||
  w.split("(").length !== w.split(")").length ||
  w.split("{").length !== w.split("}").length;

// After "x = word", these may follow and the word is still a value ("< target
// do l++"); any other plain word means it was prose ("= sum of", "= min cost").
const CONNECTOR = /^(do|then|and|or|so|return|while|if|else|is|→)$/;

function isCodeWord(w: string): boolean {
  if (!w) return false;
  // A fragment of a bracket that spans prose ("min(tallest", "[0") is not code.
  if (unbalanced(w)) return false;
  // indexing, assignment, operators ("/" left out: "true/false", "and/or")
  if (/[[\]{}=<>*%^_]/.test(w)) return true;
  if (/\w\(.*\)$/.test(w)) return true; // call: count(), max(a,b)
  if (/^\w+(\+\+|--)$/.test(w) || /^(\+\+|--)\w+$/.test(w)) return true; // l++, --r
  if (/\w\+\w/.test(w)) return true; // i+1
  if (/^[A-Za-z_]\w{0,2}-\d+$/.test(w)) return true; // n-1, i-1, len-2
  if (/^[a-z]+[A-Z]\w*$/.test(w)) return true; // camelCase: leftMax
  // member access / method call (arr.length, map.get(x)) — but not "e.g", "i.e"
  if (/^[a-z_]\w*(\.[a-z_]\w*)+(\(.*\))?$/i.test(w) && !/^(e\.g|i\.e)$/i.test(w)) return true;
  if (VAR_LETTER.test(w)) return true;
  return false;
}

/** Split leading/trailing punctuation off a whitespace token, keeping balanced
 * brackets attached to the code (so `arr[i],` → `arr[i]` + `,`). */
function peel(tok: string): [string, string, string] {
  let lead = "";
  let core = tok;
  let trail = "";
  const count = (s: string, c: string) => s.split(c).length - 1;
  while (core.startsWith("(") && count(core, "(") > count(core, ")")) {
    lead += "(";
    core = core.slice(1);
  }
  for (;;) {
    const last = core.slice(-1);
    if (/[.,;:!?"'’]/.test(last) && core.length > 1 && !/\.\.$/.test(core)) {
      trail = last + trail;
      core = core.slice(0, -1);
    } else if (last === ")" && count(core, ")") > count(core, "(")) {
      trail = last + trail;
      core = core.slice(0, -1);
    } else break;
  }
  return [lead, core, trail];
}

// Words that mark a bracket's contents as prose, not an expression.
const PROSE_WORD =
  /\b(the|an|on|its|of|is|are|if|and|or|to|for|with|from|only|count|that|this|it|in|at|by|as|be|not|all)\b/i;
const GLUE = "\u0001"; // stands in for a space inside a bracket group

/**
 * Join the spaces inside short, expression-like bracket groups so the
 * whitespace tokenizer keeps them whole: `[l+1, r+1]`, `max(piles)`,
 * `ceil(pile / k)`, `(pile + k - 1)`. Groups holding prose are left alone.
 */
function glueBrackets(s: string): string {
  const pairs: Record<string, string> = { "[": "]", "(": ")", "{": "}" };
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const close = pairs[ch];
    if (close) {
      let depth = 0;
      let j = i;
      for (; j < s.length && j - i <= 48; j++) {
        if (s[j] === ch) depth++;
        else if (s[j] === close && --depth === 0) break;
      }
      const inner = s.slice(i + 1, j);
      const bare = ch === "(" && !/\w$/.test(s.slice(0, i)); // "(" not a call
      const ok =
        j < s.length && s[j] === close && / /.test(inner) && !PROSE_WORD.test(inner) &&
        (ch === "{" || !/[.;:]\s/.test(inner)) && (!bare || (!inner.includes(",") && /[+*/%=<>-]/.test(inner)));
      if (ok) {
        out += s.slice(i, j + 1).replace(/ /g, GLUE);
        i = j + 1;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Find big-O expressions first; they can contain spaces ("O(n log n)"). */
// …and quoted literals like '+', '*' or 'a*b*', which would otherwise lose a quote.
const BIG_O = /\bO\((?:[^()]|\([^()]*\))*\)|(?<![\w'])'[^'\s]{1,6}'(?![\w'])/g;

export function segmentHint(raw: string): HintSegment[] {
  const text = raw.replace(/\s*->\s*/g, " → ");
  const out: HintSegment[] = [];
  const push = (code: boolean, t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.code === code) prev.text += t;
    else out.push({ code, text: t });
  };

  let cursor = 0;
  for (const m of text.matchAll(BIG_O)) {
    prose(text.slice(cursor, m.index));
    push(true, superscripts(m[0]));
    cursor = m.index! + m[0].length;
  }
  prose(text.slice(cursor));

  // Collapse "code␠op␠code" runs: tokens joined by operators become one chip.
  function prose(chunk: string) {
    const toks = glueBrackets(chunk).split(/(\s+)/); // keep whitespace tokens
    type T = { lead: string; core: string; trail: string; code: boolean; op: boolean; ws: boolean };
    const ts: T[] = toks.map((t) => {
      if (/^\s*$/.test(t)) return { lead: "", core: t, trail: "", code: false, op: false, ws: true };
      const [lead, core, trail] = peel(t);
      const op = OPERATORS.has(core) && !lead && !trail;
      return { lead, core, trail, code: !op && isCodeWord(core), op, ws: false };
    });
    // An operator between two words binds them into code when either side is
    // already code ("nums[l] + nums[r] < target" → one chip).
    const word = (i: number, dir: 1 | -1) => {
      let j = i + dir;
      while (ts[j]?.ws) j += dir;
      const w = ts[j];
      return w && !w.ws && !w.op ? j : -1;
    };
    for (let pass = 0; pass < 3; pass++) {
      ts.forEach((t, i) => {
        if (!t.op) return;
        const l = word(i, -1);
        const r = word(i, 1);
        const L = ts[l];
        const R = ts[r];
        if (!L || !R) return;
        if (L.trail || R.lead) return; // punctuation breaks the run
        // Title-case words are prose ("Answer = max(…)").
        const binds = (x: T) => x.code || !/^[A-Z][a-z]/.test(x.core);
        // A plain word on the right is only a value if the sentence doesn't
        // carry on in prose after it.
        const A = ts[word(r, 1)];
        const rightOk =
          R.code || /^-?\d+$/.test(R.core) || R.trail !== "" || !A || A.code || CONNECTOR.test(A.core);
        if ((L.code || R.code) && binds(L) && binds(R) && rightOk && !unbalanced(L.core) && !unbalanced(R.core)) {
          L.code = R.code = t.code = true;
        }
      });
    }
    // Emit, letting whitespace inside a code run stay inside the chip.
    ts.forEach((t, i) => {
      if (t.ws) {
        // Space stays inside a chip only around an operator that joined the
        // run — two adjacent variables ("x n times") are separate chips.
        const prev = ts[i - 1];
        const next = ts[i + 1];
        const joined = prev?.code && !prev.trail && next?.code && !next.lead && (prev.op || next.op);
        push(Boolean(joined), t.core);
        return;
      }
      const core = t.core.split(GLUE).join(" ");
      push(false, t.lead);
      push(t.code, t.code ? superscripts(core) : core === "-" ? "–" : core);
      push(false, t.trail);
    });
  }

  return out;
}

export function HintText({ text }: { text: string }): ReactNode {
  return segmentHint(text).map((s, i) =>
    s.code ? (
      <code
        key={i}
        className="whitespace-nowrap rounded-md bg-foreground/[0.07] px-1.5 py-px font-mono text-[0.86em] text-foreground ring-1 ring-inset ring-foreground/10"
      >
        {s.text}
      </code>
    ) : (
      <span key={i}>{s.text}</span>
    ),
  );
}
