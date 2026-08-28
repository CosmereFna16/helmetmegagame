"use client";

import { useCallback, useRef } from "react";
import ConversationPane from "./ConversationPane";
import DossierColumn from "./DossierColumn";

// The person view: conversation on the left, dossier on the right.
//
// The only reason this is a client component rather than the page itself is
// the prefill wire — the dossier's "Insert into reply" buttons need to write
// into the composer's draft, and the two are siblings. A ref rather than
// lifted state on purpose: the draft already lives in localStorage (see
// ConversationPane), so holding a second copy here would just be a second
// source of truth to keep in step.
export default function PersonShell({ canon, currentTurnNumber, ...conversationProps }) {
  const prefillRef = useRef(null);
  const registerPrefill = useCallback((fn) => {
    prefillRef.current = fn;
  }, []);
  const onPrefill = useCallback((text) => prefillRef.current?.(text), []);

  return (
    <div className="desk-person">
      <ConversationPane
        {...conversationProps}
        moveId={canon?.move?.id ?? null}
        registerPrefill={registerPrefill}
      />
      <DossierColumn
        characterId={canon?.characterId ?? null}
        canon={canon}
        onPrefill={onPrefill}
        currentTurnNumber={currentTurnNumber}
      />
    </div>
  );
}
