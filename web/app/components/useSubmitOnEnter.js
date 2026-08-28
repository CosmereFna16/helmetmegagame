"use client";

import { useCallback } from "react";
import { useIsCoarsePointer } from "./useIsCoarsePointer";

// Enter sends, Shift+Enter makes a newline — the shape everyone already
// expects from a message box. Returns an onKeyDown for a <textarea> inside a
// <form>; it requests the form's own submit, so validation, the disabled state
// and the submit handler all still apply.
//
// Two guards that are not optional:
//
//   isComposing — an IME (Japanese, Chinese, Korean) uses Enter to accept the
//   candidate currently being composed. Sending there would swallow the
//   keystroke and post half a word.
//
//   coarse pointer — on a phone the Return key is how you make a paragraph,
//   and there is no Shift to hold. Touch keeps the plain-newline behaviour and
//   sends with the button.
export default function useSubmitOnEnter(onSubmit) {
  const coarse = useIsCoarsePointer();

  return useCallback(
    (e) => {
      if (coarse) return;
      if (e.key !== "Enter" || e.shiftKey) return;
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      if (onSubmit) {
        onSubmit();
        return;
      }
      // requestSubmit rather than submit(): it runs validation and fires the
      // form's onSubmit, which is where every caller's logic lives.
      e.currentTarget.form?.requestSubmit();
    },
    [coarse, onSubmit],
  );
}
