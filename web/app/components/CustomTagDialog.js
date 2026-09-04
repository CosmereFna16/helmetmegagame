"use client";

import { useMemo, useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import CheckField from "@/app/components/CheckField";
import Select from "@/app/components/Select";
import InfoIcon from "@/app/components/InfoIcon";
import TagFieldset, { BLANK_TAG, tagToFormValues } from "@/app/components/TagFieldset";
import { createCustomTagAndAssign } from "@/app/(app)/gm/dev/tags/actions";

// The one custom-tag dialog, reached from several doors across the GM
// toolkit (`/gm/dev/tags`, the Dev Panel's Tags tab, the adjudication desk's
// EffectComposer) — see docs/systemdocs/DEV-PANEL.md §8. Supports Clone
// from… (prefill from an existing catalog tag) and, where a door opts in via
// `allowStage`, Apply now / Stage for turn end. `characters` omitted (or
// empty) hides "Assign to"; `groups` omitted drops the Group field.
const TOOLTIP_TEXT =
  "Use this for things that would affect adjudications—not just little bracelets or something.";

// The tag's own fields are TagFieldset's, shared with /gm/dev/tags' edit
// dialog. What stays local is the chrome around them: Clone from…, Assign
// to, and the Apply/Stage toggle.
//
// Two defaults still differ from a bare BLANK_TAG, and deliberately: a
// homebrew tag for solving one situation is visible and droppable, not a
// catalog entry meant to reach the store.
const BLANK = { ...BLANK_TAG, inspectVisibility: "ALWAYS", removable: true };

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
    // Every field, including the ones behind Advanced — cloning Infected to
    // build a variant wound should carry its duration and expiry chain. A
    // clone only carries what the door's own tag rows hold; tagToFormValues
    // falls back to BLANK_TAG for anything absent, so a thin row can't write
    // a field as blank that it simply never carried.
    setValues(tagToFormValues({ ...t, groupId: t.groupId ?? t.group?.id ?? "" }));
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
      // `values` carries exactly the keys the server reads (TagFieldset's
      // BLANK_TAG), so it goes through whole rather than being re-listed here.
      const res = await createCustomTagAndAssign({ ...values, assignCharacterIds, stage });
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
          ...values,
          id: res.tagId,
          name: res.name,
          slug: res.slug,
          groupId: values.groupId || null,
          description: values.description?.trim() || null,
          custom: true,
        },
        { assignedIds: assignCharacterIds, staged: Boolean(res.staged) },
      );
    });
  }

  return (
    <Modal
      open={open}
      modeless
      title="Custom tag"
      onClose={() => !pending && onClose?.()}
      actions={<InfoIcon text={TOOLTIP_TEXT} />}
    >
      <div className="flex flex-col gap-3">
        <label className="field">
          <span className="field-label">Clone from…</span>
          <Select value={cloneFromId} onChange={(e) => applyClone(e.target.value)}>
            <option value="">(start blank)</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </label>

        <TagFieldset
          values={values}
          set={set}
          categories={categories}
          groups={groups}
          tags={tags}
        />

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
