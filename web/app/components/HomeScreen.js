import Link from "next/link";
import { signInWithDiscord, signOutOfDiscord } from "../actions";

export default function HomeScreen({ isSignedIn, hasCharacter, username, turnLabel }) {
  return (
    <main className="relative z-10 flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="heading-gradient text-5xl font-bold tracking-widest sm:text-6xl">LIFEWEB</h1>
        <p className="mt-2 text-sm tracking-[0.2em] uppercase" style={{ color: "var(--muted)" }}>
          {turnLabel}
        </p>
      </div>

      <ul className="flex flex-col items-center gap-2 text-base sm:text-lg">
        {!isSignedIn && (
          <li>
            <form action={signInWithDiscord}>
              <button type="submit" className="btn">
                Sign in with Discord
              </button>
            </form>
          </li>
        )}

        {isSignedIn && (
          <>
            <li>
              <Link href={hasCharacter ? "/character" : "/character/new"} className="menu-item">
                &gt; {hasCharacter ? "Character" : "Create Your Character"}
              </Link>
            </li>
            <li>
              <Link href="/gm/players" className="menu-item">
                &gt; GM Dashboard
              </Link>
            </li>
            <li>
              <form action={signOutOfDiscord}>
                <button type="submit" className="menu-item">
                  &gt; Sign Out
                </button>
              </form>
            </li>
          </>
        )}
      </ul>

      {username ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Signed in as {username}
        </p>
      ) : null}
    </main>
  );
}
