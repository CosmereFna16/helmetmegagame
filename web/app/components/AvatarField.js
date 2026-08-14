"use client";

import { useState } from "react";

export default function AvatarField() {
  const [fileName, setFileName] = useState("");

  return (
    <div className="field">
      <span className="field-label">Profile picture</span>
      <div className="flex items-center gap-3">
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
        {fileName ? (
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            {fileName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
