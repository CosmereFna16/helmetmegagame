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
        {portraitMakerEnabled && (
          <button type="button" className="btn-secondary" onClick={() => setMakerOpen(true)}>
            Customize Appearance
          </button>
        )}
        {uploadsEnabled ? (
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
        {hasCustomAvatar && (
          // Clears a built portrait and an uploaded picture alike; the plaque
          // is derived at read time, so there is nothing to restore.
          <button type="button" className="btn-quiet" onClick={reset} disabled={resetting}>
            {resetting ? "Resetting…" : "Reset to Default"}
          </button>
        )}
        <Switch name="turnPingOptIn" defaultChecked={defaultTurnPingOptIn}>
          Ping me when the turn advances
        </Switch>
        {/* While this is on every message you send posts under your alias with
            the unknown avatar, and Who's here? lists the alias too. */}
        <Switch name="concealed" defaultChecked={defaultConcealed}>
          Speak under an anonymous alias ‡
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
