"use client";

import { useState } from "react";
import { Search, Loader2, ShieldBan, ShieldCheck } from "lucide-react";
import { Role } from "@risingbrain/database/enums";
import { cn } from "@risingbrain/ui/cn";
import { Select } from "../../_components/fields";
import { ConfirmDialog } from "../../_components/confirm-dialog";
import { adminMutate } from "../../_lib/mutate";
import { apiFetch } from "@/lib/api-fetch";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabledAt: string | null;
  createdAt: string;
};

const ROLE_OPTIONS = [
  { value: Role.NORMAL, label: "Normal" },
  { value: Role.STUDENT, label: "Student" },
  { value: Role.SUBSCRIBER, label: "Subscriber" },
  { value: Role.ADMIN, label: "Admin" },
];

const ROLE_STYLE: Record<string, string> = {
  ADMIN: "bg-rb-green-500/15 text-brand ring-rb-green-500/30",
  SUBSCRIBER: "bg-amber-500/15 text-amber-500 ring-amber-500/30",
  STUDENT: "bg-sky-500/15 text-sky-500 ring-sky-500/30",
  NORMAL: "bg-surface-2 text-muted ring-border",
};

export function UsersManager({ currentUserId }: { currentUserId: string }) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AdminUser | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  async function search() {
    const q = query.trim();
    if (q.length < 2) {
      setError("Type at least 2 characters of an email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/users?email=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { users?: AdminUser[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Search failed.");
        return;
      }
      setUsers(data.users ?? []);
      setSearched(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function patchLocal(user: AdminUser) {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
  }

  async function changeRole(user: AdminUser, role: string) {
    const r = await adminMutate<{ user: AdminUser }>("PATCH", "/api/admin/users", { id: user.id, role });
    if (r.ok) patchLocal(r.data.user);
    else setError(r.error);
  }

  async function setDisabled(user: AdminUser, disabled: boolean) {
    setConfirmBusy(true);
    const r = await adminMutate<{ user: AdminUser }>("PATCH", "/api/admin/users", { id: user.id, disabled });
    setConfirmBusy(false);
    setConfirm(null);
    if (r.ok) patchLocal(r.data.user);
    else setError(r.error);
  }

  return (
    // `pb-10` rather than a symmetric `py-6`: this page owns its scroll now, and a
    // scrollport that ends flush with its last result reads as truncated.
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-6">
      <div className="mb-1 max-w-prose text-sm text-muted">
        Search a user by email to change their role or disable their account. The full list is
        never loaded.
      </div>

      {/* Search bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="mt-4 flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="name@example.com"
            type="search"
            autoFocus
            className="w-full rounded-xl border border-border bg-surface/60 py-2.5 pl-10 pr-3.5 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-rb-green-500/60 focus:ring-2 focus:ring-rb-green-500/20"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="btn-glow inline-flex items-center gap-1.5 rounded-xl bg-rb-green-500 px-5 text-sm font-semibold text-black disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Results */}
      <div className="mt-5 space-y-3">
        {users.map((u) => {
          const disabled = !!u.disabledAt;
          const isSelf = u.id === currentUserId;
          return (
            <div
              key={u.id}
              className={cn(
                "glass rounded-3xl p-4",
                disabled && "opacity-70 ring-1 ring-rose-500/20",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{u.email}</span>
                    {isSelf && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
                        You
                      </span>
                    )}
                    {disabled && (
                      <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-500 ring-1 ring-rose-500/30">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{u.name ?? "—"}</span>
                    <span>Joined {new Date(u.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1",
                    ROLE_STYLE[u.role] ?? ROLE_STYLE.NORMAL,
                  )}
                >
                  {u.role}
                </span>
              </div>

              {/* Actions */}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <label className="flex items-center gap-2 text-xs text-muted">
                  Role
                  <div className="w-40">
                    <Select
                      value={u.role}
                      onChange={(role) => void changeRole(u, role)}
                      options={ROLE_OPTIONS}
                    />
                  </div>
                </label>
                <div className="ml-auto">
                  {disabled ? (
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => void setDisabled(u, false)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-rb-green-500/40 px-3.5 py-2 text-sm font-medium text-brand transition-colors hover:bg-rb-green-500/10 disabled:opacity-40"
                    >
                      <ShieldCheck className="h-4 w-4" /> Enable
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => setConfirm(u)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 px-3.5 py-2 text-sm font-medium text-rose-500 transition-colors hover:bg-rose-500/10 disabled:opacity-40"
                    >
                      <ShieldBan className="h-4 w-4" /> Disable
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {searched && users.length === 0 && !loading && (
          <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
            No users match that email.
          </p>
        )}
        {!searched && !error && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border px-4 py-12 text-center">
            <Search className="mb-3 h-7 w-7 text-muted" />
            <p className="text-sm text-muted">Search a user by email to get started.</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title="Disable this account?"
        message={
          confirm
            ? `“${confirm.email}” will be logged out immediately and blocked from signing in (via password or social login) until re-enabled.`
            : ""
        }
        confirmLabel="Disable"
        busy={confirmBusy}
        onConfirm={() => confirm && void setDisabled(confirm, true)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
