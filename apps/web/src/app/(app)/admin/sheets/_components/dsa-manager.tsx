"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Folder, GitBranch, Code2, Plus } from "lucide-react";
import { Difficulty } from "@risingbrain/database/enums";
import { Field, TextInput, TextArea, NumberInput, Select, Toggle, Section, SlugNote } from "../../_components/fields";
import { TreeRow, AddButton, CountBadge } from "../../_components/tree";
import { EditorFrame, EditorEmpty } from "../../_components/editor-frame";
import { ManagerShell } from "../../_components/manager-shell";
import { ConfirmDialog } from "../../_components/confirm-dialog";
import { adminMutate } from "../../_lib/mutate";
import type { AdminDsaTree, AdminCompany } from "../_data";

type NodeType = "sheet" | "topic" | "pattern" | "problem";
type Sel = { type: NodeType; id: string } | null;

const ENDPOINT: Record<NodeType, string> = {
  sheet: "/api/admin/dsa/sheet",
  topic: "/api/admin/dsa/topic",
  pattern: "/api/admin/dsa/pattern",
  problem: "/api/admin/dsa/problem",
};
const ENTITY: Record<NodeType, string> = {
  sheet: "dsaSheet",
  topic: "dsaTopic",
  pattern: "dsaPattern",
  problem: "dsaProblem",
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function DsaManager({ tree, companies }: { tree: AdminDsaTree; companies: AdminCompany[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Sel>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const refresh = () => startTransition(() => router.refresh());

  async function createChild(type: NodeType, parentKey: string, parentId: string, defaults: object) {
    const r = await adminMutate<{ id: string }>("POST", ENDPOINT[type], { [parentKey]: parentId, ...defaults });
    if (r.ok) {
      setExpanded((prev) => new Set(prev).add(parentId));
      setSelected({ type, id: r.data.id });
      refresh();
    }
  }

  async function createSheet() {
    const r = await adminMutate<{ id: string }>("POST", ENDPOINT.sheet, { name: "New sheet" });
    if (r.ok) {
      setSelected({ type: "sheet", id: r.data.id });
      refresh();
    }
  }

  async function reorder(type: NodeType, aId: string, bId: string) {
    const r = await adminMutate("POST", "/api/admin/reorder", { entity: ENTITY[type], aId, bId });
    if (r.ok) refresh();
  }

  // Locate the selected node + ordered siblings + breadcrumb of parent names.
  function resolve(): { node: object; siblings: { id: string }[]; crumbs: string[] } | null {
    if (!selected) return null;
    if (selected.type === "sheet") {
      const node = tree.find((s) => s.id === selected.id);
      return node ? { node, siblings: tree, crumbs: [] } : null;
    }
    for (const sheet of tree) {
      if (selected.type === "topic") {
        const node = sheet.topics.find((t) => t.id === selected.id);
        if (node) return { node, siblings: sheet.topics, crumbs: [sheet.name] };
      }
      for (const topic of sheet.topics) {
        if (selected.type === "pattern") {
          const node = topic.patterns.find((p) => p.id === selected.id);
          if (node) return { node, siblings: topic.patterns, crumbs: [sheet.name, topic.name] };
        }
        for (const pattern of topic.patterns) {
          if (selected.type === "problem") {
            const node = pattern.problems.find((p) => p.id === selected.id);
            if (node) return { node, siblings: pattern.problems, crumbs: [sheet.name, topic.name, pattern.name] };
          }
        }
      }
    }
    return null;
  }

  const resolved = resolve();
  const move = (type: NodeType, id: string, siblings: { id: string }[]) => {
    const i = siblings.findIndex((s) => s.id === id);
    return {
      onMoveUp: i > 0 ? () => void reorder(type, id, siblings[i - 1]!.id) : undefined,
      onMoveDown: i >= 0 && i < siblings.length - 1 ? () => void reorder(type, id, siblings[i + 1]!.id) : undefined,
    };
  };
  const onDone = (sel?: null) => {
    if (sel === null) setSelected(null);
    refresh();
  };

  const sidebar = (
    <>
      {tree.map((sheet) => (
        <div key={sheet.id}>
          <TreeRow
            label={sheet.name}
            icon={Layers}
            depth={0}
            active={selected?.type === "sheet" && selected.id === sheet.id}
            muted={!sheet.isPublished}
            expandable={sheet.topics.length > 0}
            expanded={expanded.has(sheet.id)}
            onToggle={() => toggle(sheet.id)}
            onSelect={() => setSelected({ type: "sheet", id: sheet.id })}
            badge={<CountBadge>{sheet.topics.length}</CountBadge>}
          />
          {expanded.has(sheet.id) &&
            sheet.topics.map((topic) => (
              <div key={topic.id}>
                <TreeRow
                  label={topic.name}
                  icon={Folder}
                  depth={1}
                  active={selected?.type === "topic" && selected.id === topic.id}
                  expandable={topic.patterns.length > 0}
                  expanded={expanded.has(topic.id)}
                  onToggle={() => toggle(topic.id)}
                  onSelect={() => setSelected({ type: "topic", id: topic.id })}
                  badge={<CountBadge>{topic.patterns.length}</CountBadge>}
                />
                {expanded.has(topic.id) &&
                  topic.patterns.map((pattern) => (
                    <div key={pattern.id}>
                      <TreeRow
                        label={pattern.name}
                        icon={GitBranch}
                        depth={2}
                        active={selected?.type === "pattern" && selected.id === pattern.id}
                        expandable={pattern.problems.length > 0}
                        expanded={expanded.has(pattern.id)}
                        onToggle={() => toggle(pattern.id)}
                        onSelect={() => setSelected({ type: "pattern", id: pattern.id })}
                        badge={<CountBadge>{pattern.problems.length}</CountBadge>}
                      />
                      {expanded.has(pattern.id) &&
                        pattern.problems.map((problem) => (
                          <TreeRow
                            key={problem.id}
                            label={problem.title}
                            icon={Code2}
                            depth={3}
                            active={selected?.type === "problem" && selected.id === problem.id}
                            onSelect={() => setSelected({ type: "problem", id: problem.id })}
                          />
                        ))}
                      <AddButton
                        label="Add problem"
                        depth={2}
                        onClick={() => void createChild("problem", "patternId", pattern.id, { title: "New problem" })}
                      />
                    </div>
                  ))}
                <AddButton
                  label="Add pattern"
                  depth={1}
                  onClick={() => void createChild("pattern", "topicId", topic.id, { name: "New pattern" })}
                />
              </div>
            ))}
          <AddButton
            label="Add topic"
            depth={0}
            onClick={() => void createChild("topic", "sheetId", sheet.id, { name: "New topic" })}
          />
        </div>
      ))}
    </>
  );

  return (
    <ManagerShell
      sidebarTitle="Sheets"
      sidebarAction={
        <button
          type="button"
          onClick={() => void createSheet()}
          className="btn-glow inline-flex items-center gap-1 rounded-full bg-rb-green-500 px-3 py-1.5 text-xs font-semibold text-black"
        >
          <Plus className="h-3.5 w-3.5" /> Sheet
        </button>
      }
      sidebar={sidebar}
      hasSelection={!!selected}
      onBack={() => setSelected(null)}
      detail={
        !resolved || !selected ? (
          <EditorEmpty
            icon={Layers}
            title="Nothing selected"
            message="Pick a sheet, topic, pattern or problem from the list — or add a new one."
          />
        ) : selected.type === "sheet" ? (
          <SheetEditor
            key={selected.id}
            node={resolved.node as AdminDsaTree[number]}
            onDone={onDone}
            {...move("sheet", selected.id, resolved.siblings)}
          />
        ) : selected.type === "topic" ? (
          <TopicEditor
            key={selected.id}
            node={resolved.node as AdminDsaTree[number]["topics"][number]}
            crumbs={resolved.crumbs}
            onDone={onDone}
            {...move("topic", selected.id, resolved.siblings)}
          />
        ) : selected.type === "pattern" ? (
          <PatternEditor
            key={selected.id}
            node={resolved.node as AdminDsaTree[number]["topics"][number]["patterns"][number]}
            crumbs={resolved.crumbs}
            onDone={onDone}
            {...move("pattern", selected.id, resolved.siblings)}
          />
        ) : (
          <ProblemEditor
            key={selected.id}
            node={resolved.node as AdminDsaTree[number]["topics"][number]["patterns"][number]["problems"][number]}
            crumbs={resolved.crumbs}
            companies={companies}
            onCompanyCreated={refresh}
            onDone={onDone}
            {...move("problem", selected.id, resolved.siblings)}
          />
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Editors — remounted via `key={id}` so drafts reset on selection change.
// ---------------------------------------------------------------------------

type Move = { onMoveUp?: () => void; onMoveDown?: () => void };
type Done = { onDone: (sel?: null) => void };
type Crumbs = { crumbs?: string[] };

function useEditor(endpoint: string, id: string) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function save(payload: object, onOk: () => void) {
    setSaving(true);
    setError(null);
    const r = await adminMutate("PATCH", endpoint, { id, ...payload });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaved(true);
    onOk();
  }

  async function remove(onOk: () => void) {
    setDeleting(true);
    const r = await adminMutate("DELETE", endpoint, { id });
    setDeleting(false);
    setConfirming(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onOk();
  }

  return { saving, saved, setSaved, error, confirming, setConfirming, deleting, save, remove };
}

function SheetEditor({ node, onDone, onMoveUp, onMoveDown }: { node: AdminDsaTree[number] } & Move & Done) {
  const ed = useEditor(ENDPOINT.sheet, node.id);
  const initial = { name: node.name, description: node.description ?? "", order: node.order, isPublished: node.isPublished };
  const [form, setForm] = useState(initial);
  const dirty = !eq(form, initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    ed.setSaved(false);
  };

  return (
    <>
      <EditorFrame
        eyebrow="Sheet"
        icon={Layers}
        title={node.name || "Untitled sheet"}
        dirty={dirty}
        saving={ed.saving}
        saved={ed.saved}
        error={ed.error}
        onSave={() => ed.save(form, () => onDone())}
        onReset={() => setForm(initial)}
        onDelete={() => ed.setConfirming(true)}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      >
        <Section title="Details">
          <Field label="Name" required>
            <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Description">
            <TextArea value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-[80px] font-sans" />
          </Field>
        </Section>
        <Section title="Visibility & order">
          <Toggle checked={form.isPublished} onChange={(v) => set("isPublished", v)} label="Published" />
          <Field label="Order" hint="lower shows first">
            <NumberInput value={form.order} onChange={(e) => set("order", Number(e.target.value) || 0)} />
          </Field>
          <SlugNote slug={node.slug} />
        </Section>
      </EditorFrame>
      <ConfirmDialog
        open={ed.confirming}
        title="Delete this sheet?"
        message={`This permanently deletes “${node.name}” and all ${node.topics.length} topic(s), their patterns and problems.`}
        busy={ed.deleting}
        onConfirm={() => ed.remove(() => onDone(null))}
        onCancel={() => ed.setConfirming(false)}
      />
    </>
  );
}

function TopicEditor({
  node,
  crumbs,
  onDone,
  onMoveUp,
  onMoveDown,
}: { node: AdminDsaTree[number]["topics"][number] } & Move & Done & Crumbs) {
  const ed = useEditor(ENDPOINT.topic, node.id);
  const initial = { name: node.name, description: node.description ?? "", order: node.order };
  const [form, setForm] = useState(initial);
  const dirty = !eq(form, initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    ed.setSaved(false);
  };

  return (
    <>
      <EditorFrame
        eyebrow="Topic"
        breadcrumb={crumbs}
        icon={Folder}
        title={node.name || "Untitled topic"}
        dirty={dirty}
        saving={ed.saving}
        saved={ed.saved}
        error={ed.error}
        onSave={() => ed.save(form, () => onDone())}
        onReset={() => setForm(initial)}
        onDelete={() => ed.setConfirming(true)}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      >
        <Section title="Details">
          <Field label="Name" required>
            <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Description">
            <TextArea value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-[80px] font-sans" />
          </Field>
          <Field label="Order" hint="lower shows first">
            <NumberInput value={form.order} onChange={(e) => set("order", Number(e.target.value) || 0)} />
          </Field>
          <SlugNote slug={node.slug} />
        </Section>
      </EditorFrame>
      <ConfirmDialog
        open={ed.confirming}
        title="Delete this topic?"
        message={`This permanently deletes “${node.name}” and all ${node.patterns.length} pattern(s) and their problems.`}
        busy={ed.deleting}
        onConfirm={() => ed.remove(() => onDone(null))}
        onCancel={() => ed.setConfirming(false)}
      />
    </>
  );
}

function PatternEditor({
  node,
  crumbs,
  onDone,
  onMoveUp,
  onMoveDown,
}: { node: AdminDsaTree[number]["topics"][number]["patterns"][number] } & Move & Done & Crumbs) {
  const ed = useEditor(ENDPOINT.pattern, node.id);
  const initial = { name: node.name, strategy: node.strategy ?? "", identification: node.identification ?? "", order: node.order };
  const [form, setForm] = useState(initial);
  const dirty = !eq(form, initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    ed.setSaved(false);
  };

  return (
    <>
      <EditorFrame
        eyebrow="Pattern"
        breadcrumb={crumbs}
        icon={GitBranch}
        title={node.name || "Untitled pattern"}
        dirty={dirty}
        saving={ed.saving}
        saved={ed.saved}
        error={ed.error}
        onSave={() => ed.save(form, () => onDone())}
        onReset={() => setForm(initial)}
        onDelete={() => ed.setConfirming(true)}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      >
        <Section title="Details">
          <Field label="Name" required>
            <TextInput value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Order" hint="lower shows first">
            <NumberInput value={form.order} onChange={(e) => set("order", Number(e.target.value) || 0)} />
          </Field>
        </Section>
        <Section title="Teaching notes">
          <Field label="Strategy" hint="the teaching approach">
            <TextArea value={form.strategy} onChange={(e) => set("strategy", e.target.value)} className="font-sans" />
          </Field>
          <Field label="Identification" hint="cue for when to apply it">
            <TextArea value={form.identification} onChange={(e) => set("identification", e.target.value)} className="font-sans" />
          </Field>
          <SlugNote slug={node.slug} />
        </Section>
      </EditorFrame>
      <ConfirmDialog
        open={ed.confirming}
        title="Delete this pattern?"
        message={`This permanently deletes “${node.name}” and all ${node.problems.length} problem(s).`}
        busy={ed.deleting}
        onConfirm={() => ed.remove(() => onDone(null))}
        onCancel={() => ed.setConfirming(false)}
      />
    </>
  );
}

const DIFFICULTIES = [
  { value: Difficulty.EASY, label: "Easy" },
  { value: Difficulty.MEDIUM, label: "Medium" },
  { value: Difficulty.HARD, label: "Hard" },
];

function ProblemEditor({
  node,
  crumbs,
  companies,
  onCompanyCreated,
  onDone,
  onMoveUp,
  onMoveDown,
}: {
  node: AdminDsaTree[number]["topics"][number]["patterns"][number]["problems"][number];
  companies: AdminCompany[];
  onCompanyCreated: () => void;
} & Move & Done & Crumbs) {
  const ed = useEditor(ENDPOINT.problem, node.id);
  const initial = {
    title: node.title,
    reference: node.reference ?? "",
    difficulty: node.difficulty,
    leetcodeUrl: node.leetcodeUrl ?? "",
    gfgUrl: node.gfgUrl ?? "",
    youtubeUrl: node.youtubeUrl ?? "",
    hint: node.hint ?? "",
    order: node.order,
    companyIds: [...node.companies.map((c) => c.companyId)].sort(),
  };
  const [form, setForm] = useState(initial);
  const dirty = !eq(form, initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    ed.setSaved(false);
  };

  return (
    <>
      <EditorFrame
        eyebrow="Problem"
        breadcrumb={crumbs}
        icon={Code2}
        title={node.title || "Untitled problem"}
        dirty={dirty}
        saving={ed.saving}
        saved={ed.saved}
        error={ed.error}
        onSave={() => ed.save(form, () => onDone())}
        onReset={() => setForm(initial)}
        onDelete={() => ed.setConfirming(true)}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      >
        <Section title="Problem">
          <Field label="Title" required>
            <TextInput value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference" hint="e.g. LC 167">
              <TextInput value={form.reference} onChange={(e) => set("reference", e.target.value)} />
            </Field>
            <Field label="Difficulty">
              <Select value={form.difficulty} onChange={(v) => set("difficulty", v as Difficulty)} options={DIFFICULTIES} />
            </Field>
          </div>
          <Field label="Order" hint="lower shows first">
            <NumberInput value={form.order} onChange={(e) => set("order", Number(e.target.value) || 0)} />
          </Field>
        </Section>

        <Section title="Links" cols={2}>
          <Field label="LeetCode URL">
            <TextInput value={form.leetcodeUrl} onChange={(e) => set("leetcodeUrl", e.target.value)} className="font-sans" />
          </Field>
          <Field label="GfG URL">
            <TextInput value={form.gfgUrl} onChange={(e) => set("gfgUrl", e.target.value)} className="font-sans" />
          </Field>
          <Field label="YouTube URL">
            <TextInput value={form.youtubeUrl} onChange={(e) => set("youtubeUrl", e.target.value)} className="font-sans" />
          </Field>
        </Section>

        <Section title="Hint" description="A nudge toward the approach, shown when a learner opens it. Never the full solution. Leave empty to hide.">
          <Field label="Hint">
            <TextArea
              value={form.hint}
              onChange={(e) => set("hint", e.target.value)}
              placeholder="e.g. The array is sorted — can two pointers from both ends replace the inner loop?"
              className="font-sans"
            />
          </Field>
        </Section>

        <Section title="Companies" description="Tag the firms that ask this problem.">
          <CompanyPicker
            value={form.companyIds}
            companies={companies}
            onChange={(ids) => set("companyIds", ids)}
            onCompanyCreated={onCompanyCreated}
          />
        </Section>
        <SlugNote slug={node.slug} />
      </EditorFrame>
      <ConfirmDialog
        open={ed.confirming}
        title="Delete this problem?"
        message={`This permanently deletes “${node.title}”.`}
        busy={ed.deleting}
        onConfirm={() => ed.remove(() => onDone(null))}
        onCancel={() => ed.setConfirming(false)}
      />
    </>
  );
}

function CompanyPicker({
  value,
  companies,
  onChange,
  onCompanyCreated,
}: {
  value: string[];
  companies: AdminCompany[];
  onChange: (ids: string[]) => void;
  onCompanyCreated: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const byId = new Map(companies.map((c) => [c.id, c]));
  const remaining = companies.filter((c) => !value.includes(c.id));

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    const r = await adminMutate<{ company: AdminCompany }>("POST", "/api/admin/dsa/company", { name });
    setAdding(false);
    if (r.ok) {
      onChange([...value, r.data.company.id].sort());
      setNewName("");
      onCompanyCreated();
    }
  }

  return (
    <div className="space-y-3">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 py-1 pl-3 pr-1.5 text-xs font-medium text-foreground"
            >
              {byId.get(id)?.name ?? "Unknown"}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onChange(value.filter((v) => v !== id))}
                className="grid h-4 w-4 place-items-center rounded-full text-muted hover:bg-rose-500/10 hover:text-rose-500"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted">No companies tagged yet.</p>
      )}
      {remaining.length > 0 && (
        <Select
          value=""
          onChange={(id) => id && onChange([...value, id].sort())}
          options={[{ value: "", label: "Add a company…" }, ...remaining.map((c) => ({ value: c.id, label: c.name }))]}
        />
      )}
      <div className="flex gap-2">
        <TextInput
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="…or create a new company"
          className="font-sans"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void createAndAdd();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void createAndAdd()}
          disabled={adding || !newName.trim()}
          className="shrink-0 rounded-xl border border-border bg-surface/60 px-3.5 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
