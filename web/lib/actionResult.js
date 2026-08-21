// Validation errors have to come back from a server action as *data*, never as
// a thrown Error.
//
// In a production build Next.js redacts anything thrown out of a Server
// Component render or a Server Action and replaces it with React error #441
// ("The specific message is omitted in production builds…"), logging the real
// message server-side only. So every `catch (e) { setError(e.message) }` in a
// client component is dead code against a throwing action: the player sees a
// React error code instead of "You don't have that many ⬢".
//
// The contract: an action resolves to `{ ok: true, ...payload }` or
// `{ ok: false, error }`. Callers branch on `ok` and never use try/catch for
// validation.

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

// Runs `fn` and converts a UserError into a failed result. Anything else is
// rethrown untouched, so genuine faults keep their stack and their server-side
// log entry — and so does `redirect()`/`notFound()`, which work *by* throwing
// and would silently stop working if this swallowed everything.
export async function guarded(fn) {
  try {
    const out = await fn();
    return { ok: true, ...(out ?? {}) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    throw e;
  }
}
