"use client";

import { useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";

export default function ConfirmTestPage() {
  const confirm = useConfirm();
  const [result, setResult] = useState("none");

  return (
    <main className="p-8">
      <button
        type="button"
        className="btn"
        onClick={async () => {
          const ok = await confirm({
            title: "Delete this thing?",
            message: "This can't be undone.",
            confirmLabel: "Delete",
            cancelLabel: "Nevermind",
          });
          setResult(ok ? "confirmed" : "cancelled");
        }}
      >
        Trigger confirm
      </button>
      <p className="mt-4">result: {result}</p>
    </main>
  );
}
