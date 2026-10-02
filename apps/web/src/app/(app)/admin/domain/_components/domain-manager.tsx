"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, FileText } from "lucide-react";
import { DomainSubject } from "@risingbrain/database/enums";
import { Field, TextInput, TextArea, NumberInput, Select, Toggle, Section, SlugNote } from "../../_components/fields";
import { TreeRow, SidebarGroupLabel } from "../../_components/tree";
import { EditorFrame, EditorEmpty } from "../../_components/editor-frame";
import { ManagerShell } from "../../_components/manager-shell";
import { ConfirmDialog } from "../../_components/confirm-dialog";
import { adminMutate } from "../../_lib/mutate";
import type { AdminDomainTopic } from "../_data";

const ENDPOINT = "/api/admin/domain/topic";
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const SUBJECTS: { value: DomainSubject; label: string }[] = [
  { value: DomainSubject.OOPS, label: "OOPS" },
  { value: DomainSubject.DBMS, label: "DBMS" },
  { value: DomainSubject.OS, label: "Operating Systems" },
  { value: DomainSubject.CN, label: "Computer Networks" },
  { value: DomainSubject.SQL, label: "SQL" },
];
const subjectLabel = (s: DomainSubject) => SUBJECTS.find((x) => x.value === s)?.label ?? s;

export function DomainManager({ topics }: { topics: AdminDomainTopic[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => router.refresh());

  async function createTopic(subject: DomainSubject) {
    const r = await adminMutate<{ id: string }>("POST", ENDPOINT, {
      subject,
      title: "New topic",
      groupLabel: "New group",
      notes: "# New topic\n\nWrite the notes here.",
    });
    if (r.ok) {
      setSelectedId(r.data.id);
      refresh();
    }
  }

  async function reorder(aId: string, bId: string) {
    const r = await adminMutate("POST", "/api/admin/reorder", { entity: "domainTopic", aId, bId });
    if (r.ok) refresh();
  }

  const selected = topics.find((t) => t.id === selectedId) ?? null;
  const subjectSiblings = selected ? topics.filter((t) => t.subject === selected.subject) : [];
  const idx = selected ? subjectSiblings.findIndex((t) => t.id === selected.id) : -1;

  const sidebar = (
    <>
      {SUBJECTS.map((s) => {
        const group = topics.filter((t) => t.subject === s.value);
        return (
          <div key={s.value}>
            <SidebarGroupLabel label={s.label} onAdd={() => void createTopic(s.value)} />
            {group.map((t) => (
              <TreeRow
                key={t.id}
                label={t.title}
                icon={FileText}
                depth={0}
                active={selectedId === t.id}
                muted={!t.isPublished}
                onSelect={() => setSelectedId(t.id)}
                badge={
                  <span className="ml-auto max-w-[45%] shrink-0 truncate rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    {t.groupLabel}
                  </span>
                }
              />
            ))}
            {group.length === 0 && <p className="px-3 py-1 text-xs text-muted/60">No topics yet.</p>}
          </div>
        );
      })}
    </>
  );

  return (
    <ManagerShell
      sidebarTitle="Domain topics"
      sidebar={sidebar}
      hasSelection={!!selected}
      onBack={() => setSelectedId(null)}
      detail={
        !selected ? (
          <EditorEmpty
            icon={Database}
            title="Nothing selected"
            message="Pick a topic to edit its notes — or add one to any subject from the list."
          />
        ) : (
          <TopicEditor
            key={selected.id}
            node={selected}
            crumbs={[subjectLabel(selected.subject), selected.groupLabel]}
            onMoveUp={idx > 0 ? () => void reorder(selected.id, subjectSiblings[idx - 1]!.id) : undefined}
            onMoveDown={
              idx >= 0 && idx < subjectSiblings.length - 1
                ? () => void reorder(selected.id, subjectSiblings[idx + 1]!.id)
                : undefined
            }
            onSaved={refresh}
            onDeleted={() => {
              setSelectedId(null);
              refresh();
            }}
          />
        )
      }
    />
  );
}

function TopicEditor({
  node,
  crumbs,
  onMoveUp,
  onMoveDown,
  onSaved,
  onDeleted,
}: {
  node: AdminDomainTopic;
  crumbs: string[];
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const initial = {
    subject: node.subject,
    title: node.title,
    groupLabel: node.groupLabel,
    groupOrder: node.groupOrder,
    summary: node.summary ?? "",
    notes: node.notes,
    miniProject: node.miniProject ?? "",
    order: node.order,
    isPublished: node.isPublished,
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dirty = !eq(form, initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    const r = await adminMutate("PATCH", ENDPOINT, { id: node.id, ...form });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaved(true);
    onSaved();
  }

  async function remove() {
    setDeleting(true);
    const r = await adminMutate("DELETE", ENDPOINT, { id: node.id });
    setDeleting(false);
    setConfirming(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onDeleted();
  }

  return (
    <>
      <EditorFrame
        eyebrow="Domain topic"
        breadcrumb={crumbs}
        icon={FileText}
        title={node.title || "Untitled topic"}
        dirty={dirty}
        saving={saving}
        saved={saved}
        error={error}
        onSave={() => void save()}
        onReset={() => setForm(initial)}
        onDelete={() => setConfirming(true)}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      >
        <Section title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Subject" required>
              <Select value={form.subject} onChange={(v) => set("subject", v as DomainSubject)} options={SUBJECTS} />
            </Field>
            <Field label="Group label" required hint="left-nav section">
              <TextInput value={form.groupLabel} onChange={(e) => set("groupLabel", e.target.value)} className="font-sans" />
            </Field>
          </div>
          <Field label="Title" required>
            <TextInput value={form.title} onChange={(e) => set("title", e.target.value)} className="font-sans" />
          </Field>
          <Field label="Summary" hint="one-line subtitle">
            <TextInput value={form.summary} onChange={(e) => set("summary", e.target.value)} className="font-sans" />
          </Field>
        </Section>

        <Section title="Content" description="Markdown — rendered on the public topic page.">
          <Field label="Notes" required hint="theory, diagrams, code examples">
            <TextArea value={form.notes} onChange={(e) => set("notes", e.target.value)} className="min-h-[320px]" />
          </Field>
          <Field label="Mini project" hint="optional third tab — leave empty for none">
            <TextArea
              value={form.miniProject}
              onChange={(e) => set("miniProject", e.target.value)}
              className="min-h-[200px]"
            />
          </Field>
        </Section>

        <Section title="Visibility & order">
          <Toggle checked={form.isPublished} onChange={(v) => set("isPublished", v)} label="Published" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Group order">
              <NumberInput value={form.groupOrder} onChange={(e) => set("groupOrder", Number(e.target.value) || 0)} />
            </Field>
            <Field label="Order" hint="within group">
              <NumberInput value={form.order} onChange={(e) => set("order", Number(e.target.value) || 0)} />
            </Field>
          </div>
          <SlugNote slug={node.slug} />
        </Section>
      </EditorFrame>
      <ConfirmDialog
        open={confirming}
        title="Delete this topic?"
        message={`This permanently deletes “${node.title}”.`}
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
