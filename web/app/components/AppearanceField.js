"use client";

import { useState } from "react";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";

export default function AppearanceField({ defaultValue }) {
  const [length, setLength] = useState(defaultValue?.length ?? 0);

  return (
    <label className="field">
      <span className="field-label">Appearance / description</span>
      <textarea
        name="appearance"
        defaultValue={defaultValue}
        placeholder="What does your character look like?"
        rows={4}
        maxLength={APPEARANCE_MAX_LENGTH}
        onChange={(e) => setLength(e.target.value.length)}
      />
      <span className="char-counter" data-at-limit={length >= APPEARANCE_MAX_LENGTH ? "true" : "false"}>
        {length} / {APPEARANCE_MAX_LENGTH}
      </span>
    </label>
  );
}
