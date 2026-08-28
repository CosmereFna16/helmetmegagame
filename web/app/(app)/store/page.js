import { redirect } from "next/navigation";

// The old standalone /store page is gone — spending Tag Points now happens
// from a modal on the character sheet (CharacterSheet.js's Spend Tag Points
// button, mounting StorePanel.js). This stub only exists so a bookmark, an
// old Discord link, or a bot message pointing at /store still lands
// somewhere instead of 404ing.
export default function StoreRedirect() {
  redirect("/character");
}
