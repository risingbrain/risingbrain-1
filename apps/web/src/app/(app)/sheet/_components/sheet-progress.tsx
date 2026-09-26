"use client";

import { createContext, useContext } from "react";

/**
 * Lets a ProblemRow report a solve/un-solve up to SheetSelector, which owns the
 * single `solvedIds` source of truth. Every solved count (pattern circle, topic
 * bar, sheet tab, difficulty panel, streak) is DERIVED from that set, so the
 * checkmark and the totals can never drift apart across filter-driven
 * unmount/remount — without threading callbacks through Topic → Pattern → Row.
 */
export const SheetSolvedContext = createContext<(problemId: string, solved: boolean) => void>(
  () => {}
);

export function useReportSolved() {
  return useContext(SheetSolvedContext);
}

/**
 * Whether the current visitor is signed in. Provided once at the SheetSelector
 * level so any deeply-nested interactive component (ProblemRow, NoteModal…)
 * can gate its actions and redirect to /login when the user is a guest.
 */
export const SheetGuestContext = createContext<boolean>(false);

export function useSheetSignedIn() {
  return useContext(SheetGuestContext);
}

/**
 * Lets a ProblemRow report a bookmark add/remove up to SheetSelector so the
 * live "bookmarked only" filter set stays in sync with the row's optimistic
 * state — without threading callbacks through Topic → Pattern → Row.
 */
export const SheetBookmarkContext = createContext<(problemId: string, bookmarked: boolean) => void>(
  () => {}
);

export function useSheetBookmarkReport() {
  return useContext(SheetBookmarkContext);
}

/**
 * Lets a pattern report "the visitor is working here" (any click inside it) up
 * to SheetSelector, which saves it as the active sheet's resume position. See
 * resume-cookie.ts.
 */
export const SheetPositionContext = createContext<(patternId: string) => void>(() => {});

export function useRecordSheetPosition() {
  return useContext(SheetPositionContext);
}
