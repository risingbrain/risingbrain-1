"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** The admin layout's scrollport — the box that scrolls under the section header. */
export const ADMIN_SCROLLPORT_ID = "admin-scrollport";

/**
 * Puts the admin scrollport back at the top after an in-page navigation.
 *
 * Every admin link is `scroll={false}`, which turns OFF the router's own
 * post-navigation scroll, and this replaces it. That trade is the point: the
 * router calls `scrollIntoView()` on the new page's root node (see
 * `layout-router`'s ScrollAndFocusHandler), and `scrollIntoView` aligns its
 * target to the START of *every* scrollport above it — the viewport included.
 * On this route the page root sits below the section header, which lives
 * OUTSIDE the scrollport precisely so it can stay put, so "align it to the top
 * of the viewport" means shifting the whole shell — icon rail, header and tabs
 * — up and off the screen. Nothing brings it back: on desktop the shell is
 * `position: fixed`, so it has no scrollbar of its own. Paginating the feedback
 * inbox is where it surfaced (from page 2 on you have scrolled far enough down
 * the list that the router stops bailing out early), but every admin link
 * carried the same hazard.
 *
 * So: do the one scroll that was actually wanted, on the one box that owns it.
 */
export function ScrollportReset() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    // On desktop the pane owns the scroll; below `lg` the document does. Reset
    // both — each is a no-op wherever it isn't the scroller, and the window
    // reset also heals a page that has already been shifted.
    const pane = document.getElementById(ADMIN_SCROLLPORT_ID);
    if (pane) pane.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname, search]);

  return null;
}
