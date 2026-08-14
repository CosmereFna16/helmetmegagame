import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import HomeScreen from "./components/HomeScreen";

export default async function Home() {
  const session = await auth();

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
    />
  );
}
