import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import DocumentMarkdown from "@/app/components/DocumentMarkdown";
import { getHandbookBody } from "@/lib/handbook";

export const metadata = {
  title: "Player Handbook",
  description: "The Bascinet player handbook — how to play, turn by turn.",
};

// Public, no sign-in: this is the one page in the app meant to be handed out
// as a bare link — a recruiting post, a Discord pin, a message to someone who
// hasn't joined the server yet. See (public)/layout.js.
//
// Renders the same docs/handbook.md that backs the pinned "Player Handbook"
// card on /documents (DocumentsPage) — one file, two surfaces, so the two can
// never say something different. That card is the richer place to read it
// once you're signed in (a sheet with search/sort/prev-next around it); this
// page's job is to work for the reader who has none of that yet.
export default async function HandbookPage() {
  const body = getHandbookBody();
  if (!body) notFound();

  const session = await auth();
  const signedIn = !!session?.discordUserId;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Player Handbook"
        subtitle="How to play Bascinet, turn by turn."
        actions={
          signedIn ? (
            <Link className="btn-quiet" href="/documents?doc=handbook">
              Open in Documents →
            </Link>
          ) : null
        }
      />
      {!signedIn && (
        <p className="text-sm text-muted">
          Playing already? <Link href="/">Sign in</Link> to reach your character, the map, and the
          rest of the site.
        </p>
      )}
      {/* .doc-sheet-body: the same serif reading typography the pinned card's
          sheet uses (globals.css), reused here as plain type rather than
          modal-specific styling, so the handbook reads the same on both
          surfaces. */}
      <div className="panel doc-sheet-body p-4 sm:p-6">
        <DocumentMarkdown text={body} />
      </div>
    </PageShell>
  );
}
