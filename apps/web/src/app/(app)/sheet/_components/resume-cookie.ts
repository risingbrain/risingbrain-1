/**
 * "Continue where you left off" for the DSA sheets — kept in first-party
 * cookies ONLY (no DB column). Every sheet has its OWN cookie
 * (`rb_sheet_pos_<sheetSlug>`) holding the last pattern worked in on that
 * sheet, so each sheet resumes independently: DP on Pattern Wise and Graphs on
 * SBC are both remembered. Each value is also timestamped, which is how the
 * bare `/sheet` hub picks the sheet worked in most recently.
 *
 * The server reads them while rendering, so the page arrives already on the
 * right sheet with that pattern expanded (no flash of the first sheet); the
 * client rewrites the active sheet's cookie whenever the visitor works inside
 * one of its patterns.
 *
 * Values are stamped with an OWNER — a hash of the signed-in user's id, or "g"
 * for a guest — and are only honoured for that same owner. So they survive
 * logout and are picked up again when the same account signs back in on this
 * browser, while someone else signing in here never lands on another person's
 * spot. Nothing sensitive is stored: a pattern id, a timestamp and the hash.
 *
 * Plain module (no server-only imports) — shared by the server view and the
 * client selector. The owner hash itself is computed server-side.
 */

const COOKIE_PREFIX = "rb_sheet_pos_";
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const GUEST_OWNER = "g";

export const resumeCookieName = (sheetSlug: string) => `${COOKIE_PREFIX}${sheetSlug}`;

export type SheetPosition = {
  owner: string;
  patternId: string;
  /** Epoch ms of the last write — the hub opens the most recent sheet. */
  at: number;
};

const OWNER_RE = /^(g|[0-9a-f]{16})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TS_RE = /^\d{1,15}$/;

/** `owner|patternId|epochMs`. */
export function serializePosition(pos: SheetPosition): string {
  return `${pos.owner}|${pos.patternId}|${pos.at}`;
}

/**
 * Parses and validates one raw cookie value. Anything malformed or tampered
 * with is simply ignored (null) — that sheet just opens in its default state.
 */
export function parsePosition(raw: string | undefined | null): SheetPosition | null {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parts = value.split("|");
  if (parts.length !== 3) return null;
  const [owner, patternId, at] = parts as [string, string, string];
  if (!OWNER_RE.test(owner) || !ID_RE.test(patternId) || !TS_RE.test(at)) return null;
  return { owner, patternId, at: Number(at) };
}

/** Client-side write for one sheet. Scoped to /sheet (covers /sheet/<slug>), 365-day TTL. */
export function writePositionCookie(sheetSlug: string, pos: SheetPosition): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${resumeCookieName(sheetSlug)}=${encodeURIComponent(serializePosition(pos))}` +
    `; Path=/sheet; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

type SheetShape = { id: string; slug: string; topics: { patterns: { id: string }[] }[] };

export type ResumeState = {
  /** Sheet to open on the bare `/sheet` hub (most recently worked in), if any. */
  sheetId: string | null;
  /** sheetId → last pattern worked in on that sheet (only still-existing ones). */
  patterns: Record<string, string>;
};

/**
 * Turns the per-sheet cookies into what the page should open on.
 *
 *  - Only values stamped with THIS visitor's owner count.
 *  - A pattern that no longer exists in its sheet is dropped silently.
 *  - `sheetId` is the most recently written sheet; the caller uses it only on
 *    the hub — an explicit `/sheet/<slug>` URL always decides the sheet.
 *
 * With no usable cookies this is `{ sheetId: null, patterns: {} }`: first
 * sheet, all patterns collapsed — exactly the pre-resume behaviour.
 */
export function resolveResume(
  sheets: SheetShape[],
  readCookie: (name: string) => string | undefined,
  owner: string,
): ResumeState {
  const patterns: Record<string, string> = {};
  let latest: { sheetId: string; at: number } | null = null;

  for (const sheet of sheets) {
    const pos = parsePosition(readCookie(resumeCookieName(sheet.slug)));
    if (!pos || pos.owner !== owner) continue;
    const exists = sheet.topics.some((t) => t.patterns.some((p) => p.id === pos.patternId));
    if (!exists) continue;
    patterns[sheet.id] = pos.patternId;
    if (!latest || pos.at > latest.at) latest = { sheetId: sheet.id, at: pos.at };
  }

  return { sheetId: latest?.sheetId ?? null, patterns };
}
