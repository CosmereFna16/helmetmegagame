import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { updateCharacterProfile, submitAction } from "./actions";

export default async function CharacterPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      faction: true,
      zone: true,
      tags: { include: { tag: true } },
      desires: { where: { status: "ACTIVE" } },
    },
  });

  if (!character) redirect("/character/new");

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  const currentAction = openTurn
    ? await prisma.action.findFirst({
        where: { characterId: character.id, turnId: openTurn.id },
      })
    : null;

  const avatarSrc = character.avatarMimeType
    ? `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`
    : null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center gap-4">
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
            alt={character.name}
            className="h-16 w-16 rounded border border-white/30 object-cover"
          />
        ) : null}
        <div>
          <h1 className="text-3xl font-bold">{character.name}</h1>
          <p className="opacity-70">
            {character.roleTitle ?? "No role"} — {character.faction?.name ?? "No faction"}
          </p>
        </div>
      </div>

      <section className="crt-panel p-4">
        <h2 className="mb-2 font-bold">Bio</h2>
        <form
          action={updateCharacterProfile}
          encType="multipart/form-data"
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1">
            <span>Name</span>
            <input
              name="name"
              defaultValue={character.name}
              required
              className="rounded border border-white/30 bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Profile picture</span>
            <input
              type="file"
              name="avatar"
              accept="image/*"
              className="rounded border border-white/30 bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Appearance / description</span>
            <textarea
              name="appearance"
              defaultValue={character.appearance ?? ""}
              placeholder="What does your character look like?"
              rows={4}
              className="rounded border border-white/30 bg-transparent px-3 py-2"
            />
          </label>
          <button type="submit" className="menu-item self-start">
            &gt; Save
          </button>
        </form>
      </section>

      <section className="crt-panel p-4">
        <h2 className="mb-2 font-bold">Status</h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>Zone: {character.zone?.name ?? "Unassigned"}</li>
          <li>Resources: {character.resources}</li>
          <li>Mood: {character.moodState}</li>
          <li>Hungry: {character.isHungry ? "Yes" : "No"}</li>
          <li>Tag Points: {character.tagPoints}</li>
        </ul>
      </section>

      <section className="crt-panel p-4">
        <h2 className="mb-2 font-bold">Act</h2>
        {!openTurn ? (
          <p className="text-sm opacity-60">No turn is currently open.</p>
        ) : currentAction ? (
          <div className="text-sm">
            <p className="mb-1">
              {currentAction.type === "MOVE" ? "Move" : "Effort"}: {currentAction.description}
            </p>
            {currentAction.status === "PENDING" && (
              <p className="opacity-70">
                Pending confirmation — check your Discord DMs and react ✅ to lock it in.
              </p>
            )}
            {currentAction.status === "CONFIRMED" && (
              <p className="opacity-70">
                Confirmed{currentAction.diceRoll != null ? ` — rolled ${currentAction.diceRoll}` : ""}{" "}
                — awaiting GM adjudication.
              </p>
            )}
            {currentAction.status === "ADJUDICATED" && (
              <p className="opacity-70">
                Adjudicated: {currentAction.gmNotes || "(no notes)"}
              </p>
            )}
          </div>
        ) : (
          <form action={submitAction} className="flex flex-col gap-3">
            <label className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <input type="radio" name="type" value="EFFORT" defaultChecked /> Effort
              </span>
              <span className="flex items-center gap-1">
                <input type="radio" name="type" value="MOVE" /> Move
              </span>
            </label>
            <textarea
              name="description"
              placeholder="Describe your intent this turn..."
              required
              rows={3}
              className="rounded border border-white/30 bg-transparent px-3 py-2"
            />
            <button type="submit" className="menu-item self-start">
              &gt; Submit
            </button>
          </form>
        )}
      </section>

      <section className="crt-panel p-4">
        <h2 className="mb-2 font-bold">Tags</h2>
        {character.tags.length === 0 ? (
          <p className="text-sm opacity-60">No tags yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {character.tags.map((characterTag) => (
              <li
                key={characterTag.id}
                className="rounded border border-white/30 px-2 py-1 text-xs"
              >
                {characterTag.tag.name}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={character.tagPoints <= 0}
          className="menu-item mt-3 disabled:cursor-not-allowed disabled:opacity-30"
        >
          &gt; Point Buy
        </button>
      </section>

      <section className="crt-panel p-4">
        <h2 className="mb-2 font-bold">Desire</h2>
        {character.desires[0] ? (
          <p className="text-sm">{character.desires[0].description}</p>
        ) : (
          <p className="text-sm opacity-60">No active desire set.</p>
        )}
      </section>
    </main>
  );
}
