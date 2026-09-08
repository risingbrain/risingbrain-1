/**
 * Client-side fetch helper for admin routes. Unlike `lib/persist.ts`
 * (fire-and-forget optimistic POSTs), admin edits are explicit form submits that
 * need the server's response (the new id, or a validation error), so this awaits
 * and returns the parsed body. Callers `router.refresh()` on success to re-pull
 * the fresh server-rendered tree.
 */
import { apiFetch } from "@/lib/api-fetch";

export type MutateResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function adminMutate<T = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<MutateResult<T>> {
  try {
    const res = await apiFetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* empty/non-JSON body */
    }
    if (!res.ok) {
      const error =
        (data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : null) ?? `Request failed (${res.status})`;
      return { ok: false, error, status: res.status };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Network error. Please try again.", status: 0 };
  }
}
