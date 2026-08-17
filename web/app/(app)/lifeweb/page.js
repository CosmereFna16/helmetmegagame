import { redirect } from "next/navigation";
import { prisma, MORTUS_SLUG, LIFEWEB_SPUTTER_THRESHOLD } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import LifewebFeedButton from "../../components/LifewebFeedButton";
import { feedLifewebCorpse } from "./actions";

function bloodBand(blood) {
  if (blood <= 0) {
    return { label: "Dry", color: "var(--accent)", body: "Nothing answers. The wards feel thinner than they should." };
  }
  if (blood <= LIFEWEB_SPUTTER_THRESHOLD) {
    return { label: "Sputtering", color: "var(--accent)", body: "It strains under the stones. Whatever's down there is starving." };
  }
  if (blood <= 60) {
    return { label: "Thinning", color: "var(--text)", body: "Steady, for now — but the pull is starting to show." };
  }
  return { label: "Sated", color: "var(--mood-happy)", body: "It hums beneath the stones, thick and slow." };
}

export default async function LifewebPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const { isGm: gm } = await getGmSession();

  const hasMortus = gm
    ? true
    : !!(await prisma.characterTag.findFirst({
        where: { character: { discordUserId: session.discordUserId, status: "ALIVE" }, tag: { slug: MORTUS_SLUG } },
      }));
  if (!hasMortus) redirect("/character");

  const [config, ownCharacter, deadCharacters] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.character.findFirst({ where: { discordUserId: session.discordUserId, status: "ALIVE" } }),
    gm ? prisma.character.findMany({ where: { status: "DEAD" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  const blood = config.lifewebBlood ?? 0;
  const band = bloodBand(blood);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="font-display text-3xl">The Lifeweb</h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Ravenheart isn&rsquo;t built on soil. Somewhere under the cellars and the old wells, something
          older than the Barony moves — goo the world before left behind, running the wards and the wells
          and the things nobody asks too many questions about. It needs blood to keep running. The Mortii
          feed it, because someone has to, and because burying the dead and feeding the dead to something
          older than the dead turn out to be the same sacred work.
        </p>
      </div>

      <section className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold" style={{ color: band.color }}>{band.label}</h2>
          <span className="text-sm" style={{ color: "var(--muted)" }}>{blood} / 100</span>
        </div>

        <div
          className="mt-3"
          style={{
            height: "10px",
            borderRadius: "999px",
            background: "var(--field-bg)",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div style={{ height: "100%", width: `${blood}%`, background: band.color }} />
        </div>

        <p className="mt-3 text-sm">{band.body}</p>

        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Bleeds {config.lifewebDecayPerTurn} a turn. Sputters at {LIFEWEB_SPUTTER_THRESHOLD} or under — and
          when it does, everyone feels it, even if only the Mortii know why.
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="mb-2 font-bold">Give it your blood</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Any living soul can volunteer — it takes what it needs and leaves you Drained for a few days.
          Nobody outside the Mortii knows this feeds anything but rumor.
        </p>
        {ownCharacter ? (
          <LifewebFeedButton characterId={ownCharacter.id} />
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No living character to offer.</p>
        )}
      </section>

      {gm && (
        <section className="panel p-5">
          <h2 className="mb-2 font-bold">Feed it a body</h2>
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            A whole corpse, given over instead of buried, fills it completely. GM call only.
          </p>
          {deadCharacters.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>No dead characters to offer it.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {deadCharacters.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{c.name}</span>
                  <form action={feedLifewebCorpse}>
                    <input type="hidden" name="characterId" value={c.id} />
                    <button type="submit" className="btn-quiet" style={{ color: "var(--accent)" }}>
                      Feed to the Lifeweb (+100)
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
