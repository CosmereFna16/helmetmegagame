import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { updateCharacterRaw, grantTag, revokeTag } from "../../actions";

export default async function DevCharacterEditPage({ params }) {
  const { characterId } = await params;
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [character, factions, zones, ownedTags, allTags] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId } }),
    prisma.faction.findMany({ orderBy: { name: "asc" } }),
    prisma.zone.findMany({ orderBy: { name: "asc" }, include: { locations: { orderBy: { name: "asc" } } } }),
    prisma.characterTag.findMany({ where: { characterId }, include: { tag: true } }),
    prisma.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] }),
  ]);
  if (!character) notFound();

  const ownedTagIds = new Set(ownedTags.map((ct) => ct.tagId));
  const grantableTags = allTags.filter((t) => !ownedTagIds.has(t.id));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 sm:p-8">
      <Link href="/gm/dev/characters" className="btn-quiet">&larr; Back to Characters</Link>
      <h1 className="text-2xl font-bold">{character.name}</h1>

      <form action={updateCharacterRaw} className="panel flex flex-col gap-3 p-4">
        <input type="hidden" name="characterId" value={character.id} />

        <label className="field">
          <span className="field-label">Name</span>
          <input name="name" defaultValue={character.name} required />
        </label>

        <label className="field">
          <span className="field-label">Role title</span>
          <input name="roleTitle" defaultValue={character.roleTitle ?? ""} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Faction</span>
            <select name="factionId" defaultValue={character.factionId ?? ""}>
              <option value="">(none)</option>
              {factions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Zone (only used when no Location is set)</span>
            <select name="zoneId" defaultValue={character.zoneId ?? ""}>
              <option value="">(none)</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field-label">Location</span>
          <select name="locationId" defaultValue={character.locationId ?? ""}>
            <option value="">(none — grants no location channel access)</option>
            {zones.map((z) => (
              <optgroup key={z.id} label={z.name}>
                {z.locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Status</span>
            <select name="status" defaultValue={character.status}>
              <option value="ALIVE">ALIVE</option>
              <option value="DEAD">DEAD</option>
              <option value="CURSED">CURSED</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ marginTop: "1.6rem" }}>
            <input type="checkbox" name="isLeader" defaultChecked={character.isLeader} />
            Faction leader
          </label>
        </div>

        <label className="field">
          <span className="field-label">Resources ⬢</span>
          <input type="number" name="resources" defaultValue={character.resources} />
        </label>

        <label className="field">
          <span className="field-label">Appearance / bio</span>
          <textarea name="appearance" rows={4} defaultValue={character.appearance ?? ""} />
        </label>

        <button type="submit" className="btn self-start">Save</button>
      </form>

      <div className="panel flex flex-col gap-3 p-4">
        <h2 className="font-bold">Tags</h2>

        {ownedTags.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No tags owned.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ownedTags.map((ct) => (
              <li key={ct.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {ct.tag.name} <span style={{ color: "var(--muted)" }}>({ct.source})</span>
                </span>
                <form action={revokeTag}>
                  <input type="hidden" name="characterTagId" value={ct.id} />
                  <input type="hidden" name="characterId" value={character.id} />
                  <button type="submit" className="btn-quiet">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {grantableTags.length > 0 && (
          <form action={grantTag} className="flex items-end gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <input type="hidden" name="characterId" value={character.id} />
            <label className="field flex-1">
              <span className="field-label">Grant tag</span>
              <select name="tagId" required defaultValue="">
                <option value="" disabled>Choose a tag...</option>
                {grantableTags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.category ? `[${t.category}] ` : ""}{t.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">Grant</button>
          </form>
        )}
      </div>
    </div>
  );
}
