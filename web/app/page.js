import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn, describeTurn } from "@/lib/turn";
import HomeScreen from "./components/HomeScreen";

export default async function Home() {
  const [session, turn] = await Promise.all([auth(), getOpenTurn()]);

  const character = session?.discordUserId
    ? await prisma.character.findFirst({
        where: { discordUserId: session.discordUserId, status: "ALIVE" },
      })
    : null;

  return (
    <HomeScreen
      isSignedIn={!!session}
      hasCharacter={!!character}
      username={session?.user?.name ?? null}
      turnLabel={describeTurn(turn).label}
    />
  );
}
