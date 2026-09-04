"use client";

// The Bio form, pulled out of CharacterSheet so it can be a client component
// and read what the action returns.
//
// It used to be a bare `<form action={updateCharacterProfile}>` inside a
// server component, which meant the action had nowhere to report a problem to.
// The avatar size check therefore threw a plain Error — and Next redacts
// anything thrown out of a Server Action into React error #441, so a player
// picking a 6MB photo got a digest instead of "that image is too big". Same
// for a corrupt image sharp can't decode.
//
// useActionState is the channel: the action returns { error } and it renders
// here. See web/lib/actionResult.js for why validation is returned, never
// thrown.

import { useActionState } from "react";
import BioNameFields from "./BioNameFields";
import AvatarField from "./AvatarField";
import AppearanceField from "./AppearanceField";
import FormError from "./FormError";
import { updateCharacterProfile } from "../(app)/character/actions";

export default function BioForm({
  character,
  lastNameLocked,
  avatarUploadsEnabled,
  portraitMakerEnabled,
  portraitFantasyPartsEnabled,
  portraitSelection,
  hasCustomAvatar,
  forcedIdentity,
  concealGear,
}) {
  const [state, formAction, pending] = useActionState(updateCharacterProfile, null);

  return (
    <form action={formAction} encType="multipart/form-data" className="flex flex-col gap-3">
      <BioNameFields character={character} lastNameLocked={lastNameLocked} />
      <AvatarField
        defaultTurnPingOptIn={character.turnPingOptIn}
        defaultConcealed={character.concealed}
        uploadsEnabled={avatarUploadsEnabled}
        portraitMakerEnabled={portraitMakerEnabled}
        portraitFantasyPartsEnabled={portraitFantasyPartsEnabled}
        portraitSelection={portraitSelection}
        hasCustomAvatar={hasCustomAvatar}
        forcedIdentity={forcedIdentity}
        concealGear={concealGear}
      />
      <AppearanceField defaultValue={character.appearance ?? ""} />
      <FormError>{state?.error}</FormError>
      <button type="submit" className="btn self-start" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
