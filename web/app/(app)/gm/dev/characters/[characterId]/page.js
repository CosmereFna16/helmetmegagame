import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { updateCharacterRaw } from "../../actions";

export default async function DevCharacterEditPage({ params }) {
  const { characterId } = await params;
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [character, factions, zones] = await Promise.all([
    prisma.character.findUnique({ where: { id: characterId } }),
    prisma.faction.findMany({ orderBy: { name: "asc" } }),
    prisma.zone.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!character) notFound();

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
            <span className="field-label">Zone</span>
            <select name="zoneId" defaultValue={character.zoneId ?? ""}>
              <option value="">(none)</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </label>
        </div>

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

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Resources</span>
            <input type="number" name="resources" defaultValue={character.resources} />
          </label>
          <label className="field">
            <span className="field-label">Tag points</span>
            <input type="number" name="tagPoints" defaultValue={character.tagPoints} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Mood state</span>
            <select name="moodState" defaultValue={character.moodState}>
              <option value="NEUTRAL">NEUTRAL</option>
              <option value="HAPPY">HAPPY</option>
              <option value="UNHAPPY">UNHAPPY</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Mood expires turn #</span>
            <input type="number" name="moodExpiresTurn" defaultValue={character.moodExpiresTurn ?? ""} />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Mood note</span>
          <input name="moodNote" defaultValue={character.moodNote ?? ""} />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isHungry" defaultChecked={character.isHungry} />
          Hungry
        </label>

        <label className="field">
          <span className="field-label">Appearance / bio</span>
          <textarea name="appearance" rows={4} defaultValue={character.appearance ?? ""} />
        </label>

        <button type="submit" className="btn self-start">Save</button>
      </form>
    </div>
  );
}
