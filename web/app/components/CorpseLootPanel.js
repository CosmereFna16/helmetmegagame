"use client";

import { useState, useTransition } from "react";
import RequestDialog from "./RequestDialog";
import {
  transferTagRequest,
  transferResourcesRequest,
} from "../(app)/character/requestActions";

// The one place on the player-facing app where death is deliberately
// surfaced — every other list (faction roster, transfer picker) treats a
// dead character as a normal row. A corpse only enters this panel because
// someone actively went looking for a body to loot, which is the moment the
// fiction earns the reveal.
//
// One panel per zone; corpses arrive already scoped to the player's current
// zoneId. Empty list means an empty panel that doesn't render.
export default function CorpseLootPanel({ selfId, corpses }) {
  if (!corpses?.length) return null;

  return (
    <section className="panel p-4">
      <h2 className="panel-header">Bodies here</h2>
      <p className="mb-3 text-xs text-muted">
        Search a body — pull ⬢ or one of their Items or Assets. Every take goes
        past a GM the same way a hand-over does.
      </p>
      <div className="flex flex-col gap-4">
        {corpses.map((corpse) => (
          <CorpseCard key={corpse.id} selfId={selfId} corpse={corpse} />
        ))}
      </div>
    </section>
  );
}

function CorpseCard({ selfId, corpse }) {
  const hasTags = corpse.lootableTags.length > 0;
  const hasResources = corpse.resources > 0;
  const isEmpty = !hasTags && !hasResources;

  return (
    <div
      className="panel p-3"
      style={{ borderLeft: "3px solid var(--border)" }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-bold">{corpse.name}</div>
        <div className="text-xs text-muted mono">{corpse.resources} ⬢</div>
      </div>

      {isEmpty && (
        <p className="text-sm text-muted">Nothing to take.</p>
      )}

      {hasResources && (
        <div className="mb-2">
          <LootResourcesButton selfId={selfId} corpse={corpse} />
        </div>
      )}

      {hasTags && (
        <ul className="flex flex-col gap-2">
          {corpse.lootableTags.map((t) => (
            <li key={t.tagId} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {t.tagName}
                {t.quantity > 1 ? ` ×${t.quantity}` : ""}
              </span>
              <LootTagButton corpse={corpse} tag={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LootTagButton({ corpse, tag }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit(reason) {
    setError(null);
    startTransition(async () => {
      const res = await transferTagRequest({
        tagId: tag.tagId,
        quantity,
        toCharacterId: corpse.id, // in LOOT mode this names the counterparty
        direction: "LOOT",
        reason,
      });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn-quiet"
        onClick={() => {
          setQuantity("1");
          setError(null);
          setOpen(true);
        }}
      >
        Take
      </button>
      <RequestDialog
        open={open}
        title={`Take ${tag.tagName}`}
        submitLabel="Take"
        busy={pending}
        error={error}
        canSubmit={true}
        onCancel={() => !pending && setOpen(false)}
        onConfirm={submit}
      >
        {tag.stackable && tag.quantity > 1 && (
          <label className="field" style={{ width: "10rem" }}>
            <span className="field-label">
              How many? (they have {tag.quantity})
            </span>
            <input
              type="number"
              min="1"
              max={tag.quantity}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        )}
        <p className="text-xs text-muted">
          Taken from {corpse.name}. Say why in the reason — a GM reviews it.
        </p>
      </RequestDialog>
    </>
  );
}

function LootResourcesButton({ selfId, corpse }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("1");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit(reason) {
    setError(null);
    startTransition(async () => {
      const res = await transferResourcesRequest({
        fromKey: `character:${corpse.id}`,
        toKey: `character:${selfId}`,
        amount,
        direction: "LOOT",
        reason,
      });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn-quiet"
        onClick={() => {
          setAmount("1");
          setError(null);
          setOpen(true);
        }}
      >
        Take ⬢
      </button>
      <RequestDialog
        open={open}
        title={`Take ⬢ from ${corpse.name}`}
        submitLabel="Take"
        busy={pending}
        error={error}
        canSubmit={Boolean(amount)}
        onCancel={() => !pending && setOpen(false)}
        onConfirm={submit}
      >
        <label className="field" style={{ width: "10rem" }}>
          <span className="field-label">How much? (they have {corpse.resources})</span>
          <input
            type="number"
            min="1"
            max={corpse.resources}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <p className="text-xs text-muted">
          Taken from {corpse.name}. Say why in the reason — a GM reviews it.
        </p>
      </RequestDialog>
    </>
  );
}
