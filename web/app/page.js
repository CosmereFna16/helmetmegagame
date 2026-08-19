import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { describeTurn } from "@/lib/turnFormat";
import HomeScreen from "./components/HomeScreen";

export default async function Home() {
  const [session, turn] = await Promise.all([auth(), getOpenTurn()]);

  if (session?.discordUserId) redirect("/character");

  return <HomeScreen turnLabel={describeTurn(turn).label} />;
}
