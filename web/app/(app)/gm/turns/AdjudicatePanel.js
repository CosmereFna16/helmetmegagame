"use client";

import TurnsTable from "./TurnsTable";

export default function AdjudicatePanel({ actions, allCharacters }) {
  return <TurnsTable actions={actions} allCharacters={allCharacters} />;
}
