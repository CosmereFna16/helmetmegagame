import { redirect } from "next/navigation";
import { prisma, MORTUS_SLUG, LIFEWEB_SPUTTER_THRESHOLD } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import LifewebDonateBloodPanel from "../../components/LifewebDonateBloodPanel";
import LifewebFeedPersonButton from "../../components/LifewebFeedPersonButton";

function bloodBand(blood) {
  if (blood <= 0) return { label: "Dry", color: "var(--accent)" };
  if (blood <= LIFEWEB_SPUTTER_THRESHOLD) return { label: "Sputtering", color: "var(--accent)" };
  if (blood <= 60) return { label: "Thinning", color: "var(--text)" };
  return { label: "Full", color: "var(--positive)" };
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

  const [config, aliveCharacters] = await Promise.all([
    prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    gm ? prisma.character.findMany({ where: { status: "ALIVE" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  const blood = config.lifewebBlood ?? 0;
  const band = bloodBand(blood);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">The Lifeweb</h1>

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
      </section>

      {gm && (
        <section className="panel p-5">
          <h2 className="mb-4 font-bold">GM Panel</h2>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">Donate Blood</h3>
            {aliveCharacters.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>No living characters.</p>
            ) : (
              <LifewebDonateBloodPanel characters={aliveCharacters} />
            )}
          </div>

          <div className="mt-5 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="text-sm font-bold">Feed Person</h3>
            <LifewebFeedPersonButton />
          </div>
        </section>
      )}
    </div>
  );
}
