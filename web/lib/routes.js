// Route patterns for revalidatePath, where a literal URL is not enough.
//
// revalidatePath needs the ROUTE, not a path that happens to match it, once a
// route has a dynamic segment. The adjudication desk carries its selection in
// the URL (/gm/turns/move/<id>), so `revalidatePath("/gm/turns")` invalidates
// only the bare URL — a GM with a Move open would never receive it. Passing
// the pattern plus "page" covers every selection.

export const TURNS_PATH = "/gm/turns/[[...selection]]";
