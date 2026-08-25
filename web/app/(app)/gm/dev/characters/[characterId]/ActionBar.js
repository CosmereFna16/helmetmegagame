"use client";

import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import IconButton from "@/app/components/IconButton";
import RequestDialog from "@/app/components/RequestDialog";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  SkullIcon,
  AnkhIcon,
  RestoreIcon,
  SkipIcon,
  MessageIcon,
  SyncIcon,
  EyeIcon,
  TrashIcon,
  WoundIcon,
  BandageIcon,
  MealIcon,
  PointsIcon,
} from "@/app/components/icons";
import { computeBudget } from "@/lib/characterCreation";
import {
  killCharacterNow,
  reviveCharacter,
  restoreTurn,
  spendTurn,
  messageCharacter,
  resyncDiscord,
  deleteCharacter,
} from "./actions";

// The microaction row. Verbs, not values.
//
// Two families, and the split matters:
//
//   IMMEDIATE — kill, revive, restore/spend turn, message, resync, delete.
//     Each fires its own server action, writes its own audit row, and takes
//     effect the moment it is confirmed. All of them touch fields the staged
//     form deliberately does NOT carry (status, the Action row, Discord), so
//     they can be used mid-edit without racing anything.
//
//   STAGING — inflict wound, heal all, feed, refund points. These make no
//     server call at all: they push ops into the same pending diff the Tags
//     tab uses, so they show in the pending count, go through the one tag
//     write path, and are undone by Cancel like any other edit.
export default function ActionBar({
  character,
  canDelete,
  hasActed,
  openTurn,
  tags,
  held,
  feed,
  cursed,
  pendingCount,
  startingTagPoints,
  onStageTags,
  onStageField,
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  // What the last staging button put in the pending diff. These four buttons
  // sit in a row of verbs that fire immediately, so without a line saying so
  // they read as having silently done nothing.
  const [staged, setStaged] = useState(null);
  const [dialog, setDialog] = useState(null); // "restore" | "message" | "delete" | "wound"
  const [draft, setDraft] = useState("");

  const alive = character.status === "ALIVE";
  const heldIds = new Set(held.map((h) => h.tagId));

  function run(fn) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      setDialog(null);
      setDraft("");
      router.refresh();
    });
  }

  // Confirm FIRST, transition SECOND. Never the other way round.
  //
  // useConfirm() resolves on a click, so the setState that mounts the dialog
  // has to render immediately. Awaited inside startTransition's async scope
  // that update is deferred behind a transition which is itself waiting on the
  // promise: the dialog never appears, `pending` never clears, and every
  // button in the bar sits disabled forever while the server action is never
  // called at all. Same warning as LifewebRequestButtons.js and
  // TagRequestButtons.js, which hit this before.
  async function confirmThenRun(opts, fn) {
    setError(null);
    if (!(await confirm(opts))) return;
    run(fn);
  }

  // ── staging helpers ──────────────────────────────────────────────────────

  // Every affliction they currently hold, dropped. `healable` is precomputed
  // on the server from the shared isHealable predicate, so the picker and the
  // server action can't disagree about what counts as one.
  function healAll() {
    const wounds = tags.filter((t) => t.healable && heldIds.has(t.id));
    if (!wounds.length) {
      setError(`${character.name} has nothing to heal.`);
      return;
    }
    onStageTags(wounds.map((t) => ({ tagId: t.id, op: "remove", quantity: null })));
    setError(null);
    setStaged(
      wounds.length === 1
        ? `removing ${wounds[0].name}`
        : `removing ${wounds.length} afflictions`,
    );
  }

  // Drop Hungry, grant Ate Meal — the same pair db/lib/hungerPass.js works in.
  function feedThem() {
    const hunger = tags.find((t) => t.slug === feed.dropSlug);
    const meal = tags.find((t) => t.slug === feed.grantSlug);
    const ops = [];
    if (hunger && heldIds.has(hunger.id)) ops.push({ tagId: hunger.id, op: "remove", quantity: null });
    if (meal && !heldIds.has(meal.id)) ops.push({ tagId: meal.id, op: "add", quantity: 1 });
    if (!ops.length) {
      setError(`${character.name} is already fed.`);
      return;
    }
    onStageTags(ops);
    setError(null);
    setStaged("a meal");
  }

  // Recompute what they should have left: the creation budget, minus what
  // their held tags cost. A repair for a sheet whose points drifted, not a
  // rule — which is why it stages into the editable field rather than writing.
  function refundPoints() {
    const budget = computeBudget({ startingTagPoints, role: null, cursed });
    const spent = tags
      .filter((t) => heldIds.has(t.id))
      .reduce((sum, t) => sum + (t.pointCost ?? 0), 0);
    onStageField("tagPoints", budget - spent);
    setError(null);
    setStaged(`tag points at ${budget - spent}`);
  }

  const wounds = tags.filter((t) => t.healable);

  return (
    <>
      <section className="panel flex flex-wrap items-center gap-4 p-3">
        <div className="flex items-center gap-2">
          {alive ? (
            <IconButton
              icon={SkullIcon}
              label={`Kill ${character.name}`}
              disabled={pending}
              onClick={() =>
                confirmThenRun(
                  {
                    title: `Kill ${character.name}?`,
                    message:
                      "Revokes every channel overwrite, deletes their personal Discord role, clears their nickname, grants Cursed, and writes a death into the archive.",
                    confirmLabel: "Kill them",
                  },
                  () => killCharacterNow({ characterId: character.id }),
                )
              }
            />
          ) : (
            <IconButton
              icon={AnkhIcon}
              label={`Revive ${character.name}`}
              disabled={pending}
              onClick={() =>
                confirmThenRun(
                  {
                    title: `Revive ${character.name}?`,
                    message:
                      "Restores their personal Discord role, nickname and channel access, and removes the Cursed role.",
                    confirmLabel: "Revive",
                  },
                  () => reviveCharacter({ characterId: character.id }),
                )
              }
            />
          )}

          <IconButton
            icon={RestoreIcon}
            label={hasActed ? "Give their turn back" : "They haven't acted this turn"}
            disabled={pending || !hasActed}
            onClick={() => setDialog("restore")}
          />
          <IconButton
            icon={SkipIcon}
            label={hasActed ? "They've already acted this turn" : "Spend their turn"}
            disabled={pending || hasActed || !openTurn}
            onClick={() =>
              confirmThenRun(
                {
                  title: "Spend their turn?",
                  message: `${character.name} won't be able to act again until the turn advances.`,
                  confirmLabel: "Spend it",
                },
                () => spendTurn({ characterId: character.id }),
              )
            }
          />
          <IconButton
            icon={MessageIcon}
            label={`Message ${character.name}`}
            disabled={pending}
            onClick={() => setDialog("message")}
          />
        </div>

        <span className="dev-bar-sep" aria-hidden="true" />

        {/* These four don't fire — they push into the pending diff so Cancel
            can undo them and every tag change goes through one write path.
            Captioned because they sit beside verbs that DO fire, and an
            unlabelled icon that silently stages reads as a dead button. */}
        <div className="dev-bar-group">
          <span className="dev-bar-caption">stages</span>
          <div className="flex items-center gap-2">
            <IconButton
              icon={WoundIcon}
              label="Inflict a wound — stages, press Apply"
              disabled={pending}
              onClick={() => setDialog("wound")}
            />
            <IconButton
              icon={BandageIcon}
              label="Heal every affliction — stages, press Apply"
              disabled={pending}
              onClick={healAll}
            />
            <IconButton
              icon={MealIcon}
              label="Feed them — stages, press Apply"
              disabled={pending}
              onClick={feedThem}
            />
            <IconButton
              icon={PointsIcon}
              label="Recompute their unspent tag points — stages, press Apply"
              disabled={pending}
              onClick={refundPoints}
            />
          </div>
        </div>

        <span className="dev-bar-sep" aria-hidden="true" />

        <div className="flex items-center gap-2">
          <IconButton
            icon={SyncIcon}
            label="Re-push their Discord role, nickname and channel access"
            disabled={pending || !alive}
            onClick={() => run(() => resyncDiscord({ characterId: character.id }))}
          />
          <Link href="/character" className="icon-btn" aria-label="View the player-facing sheet">
            <EyeIcon width="15" height="15" />
          </Link>
          {canDelete && (
            <IconButton
              icon={TrashIcon}
              label={`Delete ${character.name} permanently`}
              disabled={pending}
              onClick={() => setDialog("delete")}
            />
          )}
        </div>

        <FormError>{error}</FormError>
        {!error && staged && pendingCount > 0 && (
          <p className="w-full text-sm" style={{ color: "var(--accent-text)" }}>
            Staged {staged} — press <strong>Apply</strong> below to commit it.
          </p>
        )}
      </section>

      {/* Restoring a turn DMs the player, so it asks for a reason to send
          with it — a freed turn they don't know about is a wasted day. */}
      <RequestDialog
        open={dialog === "restore"}
        title="Give their turn back"
        submitLabel="Restore turn"
        busy={pending}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => run(() => restoreTurn({ characterId: character.id, reason }))}
      >
        <p className="text-sm text-muted">
          Deletes their Move and undoes any rewards. They&apos;ll be DM&apos;d with your reason.
        </p>
      </RequestDialog>

      {dialog === "message" && (
        <Modal title={`Message ${character.name}`} onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-3">
            <label className="field">
              <span className="field-label">Sent from Bascinet as a DM</span>
              <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <FormError>{error}</FormError>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={pending || !draft.trim()}
                onClick={() => run(() => messageCharacter({ characterId: character.id, message: draft }))}
              >
                Send
              </button>
            </div>
          </div>
        </Modal>
      )}

      {dialog === "wound" && (
        <Modal title="Inflict a wound" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Afflictions can be cured.
            </p>
            <ul className="flex flex-col gap-2">
              {wounds.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="btn-quiet w-full text-left"
                    disabled={heldIds.has(t.id)}
                    onClick={() => {
                      onStageTags([{ tagId: t.id, op: "add", quantity: 1 }]);
                      setError(null);
                      setStaged(t.name);
                      setDialog(null);
                    }}
                  >
                    {t.name}
                    {heldIds.has(t.id) ? " — already has it" : ""}
                  </button>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Deleting is the one thing here with no undo at all, so it takes a
          typed name rather than a yes/no — the same posture as Restart Game. */}
      {dialog === "delete" && (
        <Modal title={`Delete ${character.name}`} onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Removes the character and their Moves, Requests, Desires, and tags. This also cleans up their Discord permissions. Their notes and archive posts stay. This is permanent.
            </p>
            <label className="field">
              <span className="field-label">Type “{character.name}” to confirm</span>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <FormError>{error}</FormError>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={pending || draft.trim() !== character.name}
                onClick={() =>
                  run(async () => {
                    const res = await deleteCharacter({ characterId: character.id, confirmName: draft });
                    if (res?.ok) router.push("/gm/players");
                    return res;
                  })
                }
              >
                Delete permanently
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
