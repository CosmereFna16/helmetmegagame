"use client";

import { useMemo, useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import CheckField from "@/app/components/CheckField";
import Select from "@/app/components/Select";
import InfoIcon from "@/app/components/InfoIcon";
import { createCustomTagAndAssign } from "@/app/(app)/gm/dev/tags/actions";

// The one custom-tag dialog, reached from several doors across the GM
// toolkit (`/gm/dev/tags`, the Dev Panel's Tags tab, the adjudication desk's
// EffectComposer). Extracted from the standalone catalog page's TagDialog
// (gm/dev/tags/TagCatalog.js) so every door shares one interface instead of
// each growing its own copy — see docs/systemdocs/DEV-PANEL.md §8.
//
// Two features chosen (not asked) alongside the base spec: Clone from…
// (prefill every field from an existing catalog tag, then edit) and, where a
// door opts in via `allowStage`, an Apply now / Stage for turn end toggle —
// "stage" writes a `StagedEffect` (tagOps add) against the chosen targets
// instead of a live grant, so a GM chasing a Move can invent the tag and
// queue it in one gesture without leaving the composer.
//
// `characters` is the assignment picker's source list — omit it (or pass an
// empty array) to hide "Assign to" entirely, which is also what happens when
// a door has nowhere sensible to source a character list from (see
// TagEditor.js's note on the current character not yet reaching this dialog).
// `groups` is optional too: a caller whose tag rows don't carry a group id
// (several DTOs trim TagGroup down to name/color for display only) simply
// omits it, and the dialog drops the Group field rather than offering a
// picker it cannot resolve back to an id.
const TOOLTIP_TEXT =
  "Use this for things that would affect adjudications—not just little bracelets or something.";

const BLANK = {
  name: "",
  description: "",
  category: "",
  groupId: "",
  // A plain yes/no here, mapped to Tag.inspectVisibility's ALWAYS/HIDDEN on
  // submit. The third state, worn-only, needs `equippable`, which this quick
  // dialog has no field for at all — offering it would make a checkbox that
  // silently does nothing. Set it from /gm/dev/tags instead.
  visible: true,
  purchasable: false,
  purchasableAfterStart: false,
  removable: true,
};

export default function CustomTagDialog({
  open = true,
  onClose,
  categories,
  groups,
  tags = [],
  characters = null,
  defaultAssignIds = [],
  mode = "apply",
  allowStage = false,
  onCreated,
}) {
  const [refresh] = useRefresh();
  const [values, setValues] = useState(BLANK);
  const [cloneFromId, setCloneFromId] = useState("");
  const [assignIds, setAssignIds] = useState(() => new Set(defaultAssignIds));
  const [assignSearch, setAssignSearch] = useState("");
  const [submitMode, setSubmitMode] = useState(mode === "stage" && allowStage ? "stage" : "apply");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  function applyClone(tagId) {
    setCloneFromId(tagId);
    if (!tagId) return;
    const t = tagsById.get(tagId);
    if (!t) return;
    setValues((v) => ({
      ...v,
      name: t.name,
      description: t.description ?? "",
      category: t.category,
      groupId: t.groupId ?? t.group?.id ?? "",
      // A worn-only source clones as plainly visible — see BLANK above for why
      // this dialog can't carry the third state.
      visible: t.inspectVisibility !== "HIDDEN",
    }));
  }

  function toggleAssign(id) {
    setAssignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredCharacters = useMemo(() => {
    if (!characters) return [];
    const q = assignSearch.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter((c) => c.name.toLowerCase().includes(q));
  }, [characters, assignSearch]);

  const selectedCharacters = useMemo(
    () => (characters ?? []).filter((c) => assignIds.has(c.id)),
    [characters, assignIds],
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const stage = allowStage && submitMode === "stage";
      const assignCharacterIds = characters ? [...assignIds] : [];
      const res = await createCustomTagAndAssign({
        name: values.name,
        description: values.description,
        inspectVisibility: values.visible ? "ALWAYS" : "HIDDEN",
        category: values.category,
        groupId: values.groupId,
        purchasable: values.purchasable,
        purchasableAfterStart: values.purchasableAfterStart,
        removable: values.removable,
        assignCharacterIds,
        stage,
      });
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      // Through useRefresh: this dialog closes itself via onCreated below, so
      // a transition it owned would be orphaned and drop the desk underneath
      // to its loading skeleton.
      refresh();
      if (res.failed?.length) {
        // The tag exists (say so — a retry would clash on the name), but some
        // targets weren't tagged. Stay open so the GM actually reads it; the
        // catalog lists pick the tag up from the refresh.
        const who = res.failed
          .map((f) => `${characters?.find((c) => c.id === f.characterId)?.name ?? f.characterId}: ${f.error}`)
          .join("; ");
        setError(
          `Created "${res.name}", but ${res.failed.length} of ${assignCharacterIds.length} weren't tagged — ${who}. Assign it to them from their sheet.`,
        );
        return;
      }
      onCreated?.(
        {
          id: res.tagId,
          name: res.name,
          slug: res.slug,
          category: values.category,
          groupId: values.groupId || null,
          description: values.description?.trim() || null,
          inspectVisibility: values.visible ? "ALWAYS" : "HIDDEN",
          purchasable: values.purchasable,
          purchasableAfterStart: values.purchasableAfterStart,
          removable: values.removable,
          custom: true,
          pointCost: 0,
        },
        { assignedIds: assignCharacterIds, staged: Boolean(res.staged) },
      );
    });
  }

  return (
    <Modal
      open={open}
      title="Custom tag"
      onClose={() => !pending && onClose?.()}
      actions={<InfoIcon text={TOOLTIP_TEXT} />}
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            <span className="field-label">Name</span>
            <input value={values.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">
              Category <span className="text-accent">*</span>
            </span>
            <Select value={values.category} onChange={(e) => set("category", e.target.value)} required>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </label>
          {groups && groups.length > 0 && (
            <label className="field">
              <span className="field-label">Group (colour accent only)</span>
              <Select value={values.groupId ?? ""} onChange={(e) => set("groupId", e.target.value)}>
                <option value="">(none)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </label>
          )}
          <label className="field">
            <span className="field-label">Clone from…</span>
            <Select value={cloneFromId} onChange={(e) => applyClone(e.target.value)}>
              <option value="">(start blank)</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </label>
        </div>

        <label className="field">
          <span className="field-label">Description</span>
          <textarea rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} />
        </label>

        <CheckField checked={values.visible} onChange={(e) => set("visible", e.target.checked)}>
          Visible on inspect
        </CheckField>

        {characters && characters.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="field-label">Assign to</span>
            {selectedCharacters.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedCharacters.map((c) => (
                  <button key={c.id} type="button" className="chip" onClick={() => toggleAssign(c.id)}>
                    {c.name} ✕
                  </button>
                ))}
              </div>
            )}
            <input
              type="search"
              value={assignSearch}
              onChange={(e) => setAssignSearch(e.target.value)}
              placeholder="Search characters…"
            />
            <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "9rem" }}>
              {filteredCharacters.map((c) => (
                <CheckField key={c.id} checked={assignIds.has(c.id)} onChange={() => toggleAssign(c.id)}>
                  {c.name}
                </CheckField>
              ))}
              {filteredCharacters.length === 0 && (
                <p className="text-xs text-muted">Nobody matches &quot;{assignSearch}&quot;.</p>
              )}
            </div>
          </div>
        )}

        {allowStage && characters && characters.length > 0 && (
          <div className="segmented" role="group" aria-label="When to apply">
            <button type="button" aria-pressed={submitMode === "apply"} onClick={() => setSubmitMode("apply")}>
              Apply now
            </button>
            <button type="button" aria-pressed={submitMode === "stage"} onClick={() => setSubmitMode("stage")}>
              Stage for turn end
            </button>
          </div>
        )}

        <FormError>{error}</FormError>
        {!pending && (!values.name.trim() || !values.category) && (
          <p className="text-xs text-muted">
            {!values.name.trim() && !values.category
              ? "Name and category are required."
              : !values.name.trim()
                ? "Name is required."
                : "Category is required."}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || !values.name.trim() || !values.category}
            onClick={submit}
          >
            {pending ? "Saving…" : "Create tag"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
