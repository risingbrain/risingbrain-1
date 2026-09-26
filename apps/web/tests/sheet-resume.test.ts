/**
 * "Continue where you left off" on the DSA sheets — the per-sheet resume
 * cookies (`rb_sheet_pos_<slug>`).
 *
 * Pins the rules the page relies on: each sheet resumes independently, the hub
 * opens the most recently worked sheet, a cookie only counts for the owner who
 * wrote it (so the same account gets it back after re-login and nobody else
 * does), and anything stale or tampered with falls back to the default render.
 */
import { describe, expect, test } from "bun:test";
import {
  GUEST_OWNER,
  parsePosition,
  resolveResume,
  resumeCookieName,
  serializePosition,
} from "@/app/(app)/sheet/_components/resume-cookie";

const ME = "0123456789abcdef";
const SOMEONE_ELSE = "fedcba9876543210";

const sheets = [
  { id: "s1", slug: "pattern-wise-sheet", topics: [{ patterns: [{ id: "arrays" }, { id: "dp" }] }] },
  { id: "s2", slug: "last-minute-100", topics: [{ patterns: [{ id: "graphs" }] }] },
  { id: "s3", slug: "sbc", topics: [{ patterns: [{ id: "trees" }, { id: "heap" }] }] },
];

/** A cookie reader over a plain name → value map, values as the browser stores them. */
const jar = (entries: Record<string, { owner: string; patternId: string; at: number }>) => {
  const map = new Map(
    Object.entries(entries).map(([slug, pos]) => [
      resumeCookieName(slug),
      encodeURIComponent(serializePosition(pos)),
    ]),
  );
  return (name: string) => map.get(name);
};

describe("parsePosition", () => {
  test("round-trips a serialized, URI-encoded value", () => {
    const pos = { owner: ME, patternId: "cmabc_12-x", at: 1790400000000 };
    expect(parsePosition(encodeURIComponent(serializePosition(pos)))).toEqual(pos);
  });

  test("accepts the guest owner", () => {
    expect(parsePosition(`${GUEST_OWNER}|dp|1`)?.owner).toBe(GUEST_OWNER);
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["too few parts", `${ME}|dp`],
    ["too many parts", `${ME}|dp|1|x`],
    ["bad owner", `nothex00nothex00|dp|1`],
    ["bad pattern id", `${ME}|<script>|1`],
    ["non-numeric time", `${ME}|dp|soon`],
    ["broken encoding", "%E0%A4%A"],
  ])("rejects %s", (_label, raw) => {
    expect(parsePosition(raw)).toBeNull();
  });
});

describe("resolveResume", () => {
  test("no cookies → default render (first sheet, nothing open)", () => {
    expect(resolveResume(sheets, () => undefined, ME)).toEqual({ sheetId: null, patterns: {} });
  });

  test("each sheet keeps its own pattern; the hub opens the most recent sheet", () => {
    const read = jar({
      "pattern-wise-sheet": { owner: ME, patternId: "dp", at: 100 },
      sbc: { owner: ME, patternId: "heap", at: 300 },
      "last-minute-100": { owner: ME, patternId: "graphs", at: 200 },
    });
    expect(resolveResume(sheets, read, ME)).toEqual({
      sheetId: "s3",
      patterns: { s1: "dp", s2: "graphs", s3: "heap" },
    });
  });

  test("the same account gets its cookies back after re-login; another account does not", () => {
    const read = jar({ sbc: { owner: ME, patternId: "trees", at: 1 } });
    expect(resolveResume(sheets, read, ME).patterns).toEqual({ s3: "trees" });
    expect(resolveResume(sheets, read, SOMEONE_ELSE)).toEqual({ sheetId: null, patterns: {} });
    expect(resolveResume(sheets, read, GUEST_OWNER)).toEqual({ sheetId: null, patterns: {} });
  });

  test("a pattern that no longer exists in its sheet is ignored", () => {
    const read = jar({
      sbc: { owner: ME, patternId: "deleted-pattern", at: 999 },
      "pattern-wise-sheet": { owner: ME, patternId: "arrays", at: 1 },
    });
    // The stale SBC cookie neither opens a pattern nor wins the hub.
    expect(resolveResume(sheets, read, ME)).toEqual({ sheetId: "s1", patterns: { s1: "arrays" } });
  });

  test("a pattern id from a different sheet does not leak across", () => {
    const read = jar({ "last-minute-100": { owner: ME, patternId: "dp", at: 1 } });
    expect(resolveResume(sheets, read, ME)).toEqual({ sheetId: null, patterns: {} });
  });
});
