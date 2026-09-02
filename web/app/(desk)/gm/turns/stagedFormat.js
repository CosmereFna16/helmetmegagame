// Human forms of staged rows, shared by the desk, the tray and the preview.
// Pure functions over DTOs — no server imports, safe in client components.

import { chunkMessage } from "@lifeweb/db/lib/chunkText";

// How many Discord messages a staged body will arrive as. chunkText.js is the
// dependency-free half of the REST layer, so importing it here keeps this
// module client-safe — never import from discordRest.js, which reads
// DISCORD_TOKEN and calls fetch.
export function chunkCount(content) {
  return chunkMessage((content ?? "").trim()).length;
}

export function tagNameLookup(tagCatalog) {
  return new Map(tagCatalog.map((t) => [t.id, t.name]));
}

function partyLabel(party) {
  if (!party) return "?";
  return party.kind === "faction" ? `${party.name} Silo` : party.name;
}

// "+3 ⬢ · +Explosion Burns · −Fine Meal ×2"
export function effectSummary(effect, tagNames) {
  const parts = [];
  if (effect.transfer) {
    const { from, to, amount, hidden } = effect.transfer;
    // A quiet transfer hides its Silo row from the faction's own officers, and
    // that is exactly the kind of thing a GM must not push by accident — so it
    // is called out on the staged row, before the push.
    parts.push(`${partyLabel(from)} → ${partyLabel(to)} · ${amount} ⬢${hidden ? " · quiet ‡" : ""}`);
  }
  if (effect.resources) parts.push(`${effect.resources > 0 ? "+" : ""}${effect.resources} ⬢`);
  if (effect.tagPoints) parts.push(`${effect.tagPoints > 0 ? "+" : "−"}${Math.abs(effect.tagPoints)} tp`);
  for (const op of effect.tagOps ?? []) {
    const name = tagNames.get(op.tagId) ?? "a tag";
    const qty = op.quantity != null && op.quantity > 1 ? ` ×${op.quantity}` : "";
    parts.push(`${op.op === "add" ? "+" : "−"}${name}${qty}`);
  }
  if (effect.locationId) parts.push(`→ ${effect.locationName ?? "?"}`);
  return parts.join(" · ") || "nothing";
}

// The one-word state of a staged row, for a status pill.
export function effectState(effect) {
  if (effect.appliedError) return { label: "Errored", tone: "bad" };
  if (effect.applied) return { label: "Applied", tone: "good" };
  if (effect.missed) return { label: "Missed push", tone: "bad" };
  return { label: "Staged", tone: "warn" };
}

export function messageState(message) {
  if (message.sent && message.deliveryFailures) return { label: "Sent, some failed", tone: "bad" };
  if (message.sent) return { label: "Sent", tone: "good" };
  if (message.missed) return { label: "Missed push", tone: "bad" };
  return { label: "Staged", tone: "warn" };
}

export function truncate(text, limit = 120) {
  const clean = (text ?? "").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}
