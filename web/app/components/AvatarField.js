"use client";

import Switch from "./Switch";
import { useState, useTransition } from "react";
import PortraitMaker from "./PortraitMaker";
import HoverCard from "./HoverCard";
import { useConfirm } from "./ConfirmProvider";
import { resetAvatarToDefault } from "../(app)/character/actions";

export default function AvatarField({
  defaultTurnPingOptIn,
  defaultConcealed,
  uploadsEnabled = false,
  portraitMakerEnabled = false,
  portraitFantasyPartsEnabled = false,
  portraitSelection,
  hasCustomAvatar = false,
  // While set, the face and the name are the tag's, not the player's: every
  // picture control gives way to one line, and the conceal switch is off and
  // locked. The server actions re-check it (character/actions.js).
  forcedIdentity = null,
}) {
  const [fileName, setFileName] = useState("");
  const [makerOpen, setMakerOpen] = useState(false);
  const [resetting, startReset] = useTransition();
  const confirm = useConfirm();

  const reset = async () => {
    const ok = await confirm({
      title: "Reset to default?",
      message: "Your picture goes back to the letter plaque for your first name.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    startReset(() => {
      resetAvatarToDefault();
    });
  };

  return (
    <div className="field">
      <span className="field-label">Profile picture</span>
      <div className="flex flex-wrap items-center gap-3">
        {forcedIdentity && (
          <span className="text-sm text-muted">
            Your face is fixed while you hold {forcedIdentity.tagName}. Everyone sees {forcedIdentity.name}. ‡
          </span>
        )}
        {!forcedIdentity && portraitMakerEnabled && (
          <button type="button" className="btn-secondary" onClick={() => setMakerOpen(true)}>
            Customize Appearance
          </button>
        )}
        {forcedIdentity ? null : uploadsEnabled ? (
          // The GM approval this promises is a conversation, not a queue: the
          // picture lands immediately and a GM can reset it. Saying so on the
          // button is the whole enforcement, deliberately.
          <HoverCard
            panel="Requires GM approval, run your art by the GM."
            // .tag-hover forces --font-mono, which is data-only per
            // DESIGN-SYSTEM.md §1 and wrong on a button label. Every other
            // HoverCard wraps a chip or a glyph, where mono is correct; this
            // is the one that wraps a control.
            style={{ fontFamily: "inherit" }}
          >
            <label className="btn" style={{ cursor: "pointer" }}>
              Browse
              <input
                type="file"
                name="avatar"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
            </label>
          </HoverCard>
        ) : (
          // Uploads are off (GameConfig.avatarUploadsEnabled) — no `avatar`
          // field is posted at all. With the portrait maker off too, everyone
          // shows their letter plaque.
          !portraitMakerEnabled && <span className="text-sm text-muted">Using your letter plaque</span>
        )}
        {!forcedIdentity && hasCustomAvatar && (
          // Clears a built portrait and an uploaded picture alike; the plaque
          // is derived at read time, so there is nothing to restore.
          <button type="button" className="btn-quiet" onClick={reset} disabled={resetting}>
            {resetting ? "Resetting…" : "Reset to Default"}
          </button>
        )}
        <Switch name="turnPingOptIn" defaultChecked={defaultTurnPingOptIn}>
          Ping me when the turn advances
        </Switch>
        {/* While this is on every message you send posts under your alias and
            the concealing item's own face, and Who's here? lists the alias too.
            Three ways it can be locked, and the label says which: a forced
            name, a bare face, or something you don't get to take off. The
            server re-checks all three — this is the hint, not the lock. */}
        <Switch
          name="concealed"
          defaultChecked={
            forcedIdentity ? false : concealGear?.forced ? true : Boolean(concealGear) && defaultConcealed
          }
          disabled={Boolean(forcedIdentity) || !concealGear || concealGear.forced}
        >
          {forcedIdentity
            ? `Speak under an anonymous alias — not while you are ${forcedIdentity.name}. ‡`
            : !concealGear
              ? "Speak under an anonymous alias — your face is bare. Equip something that covers it. ‡"
              : concealGear.forced
                ? `Speak under an anonymous alias — no choice while you are wearing ${concealGear.tagName}. ‡`
                : "Speak under an anonymous alias ‡"}
        </Switch>
        {fileName ? (
          <span className="text-sm text-muted">
            {fileName}
          </span>
        ) : null}
      </div>

      {/* Mounted only while open, so cancelling and reopening starts from what
          is stored rather than from the abandoned edits. */}
      {makerOpen && (
        <PortraitMaker
          onClose={() => setMakerOpen(false)}
          initialSelection={portraitSelection}
          allowFantasy={portraitFantasyPartsEnabled}
        />
      )}
    </div>
  );
}
