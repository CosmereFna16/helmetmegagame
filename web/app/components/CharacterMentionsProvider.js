"use client";

import { createContext, useContext, useMemo } from "react";

// Deliberately NOT mounted in the root layout, unlike TagsProvider and its
// two siblings (ProductionRatesProvider,
// DocumentsProvider). There is no app-wide character roster to ship — the
// only page that renders a {char:…} token is /notes, and it hands down
// exactly the characters its own reader is allowed to mention (see
// notes/page.js). The default is an empty Map, so a {char:…} token anywhere
// else in the app simply fails to resolve and falls back to literal text —
// the same "an unresolved reference should be visible" contract richTokens.js
// states for every other kind, and it means mounting this provider can never
// regress a page that doesn't use it.
const CharacterMentionsContext = createContext(new Map());

export function useCharacterMentions() {
  return useContext(CharacterMentionsContext);
}

// `characters` is `{ id, name, updatedAt }[]` — the same roster shape used
// for @ autocomplete, reused as-is for resolution. There is deliberately no
// second, narrower lookup: an entry can only ever mention a character its
// author was allowed to see in the autocomplete list in the first place, so
// there is nothing a resolver could leak that the roster itself didn't
// already carry.
export default function CharacterMentionsProvider({ characters = [], children }) {
  const mentionsById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  return <CharacterMentionsContext.Provider value={mentionsById}>{children}</CharacterMentionsContext.Provider>;
}
