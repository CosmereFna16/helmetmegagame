import { prisma, DYNASTY_HEAD_SLUG, DYNASTY_MEMBER_SLUGS } from "@lifeweb/db";
import { formatCharacterName, formatBareName } from "@/lib/characterName";
import { ensureCharacterRole, syncCharacterNickname } from "@/lib/discordGuild";

// The prisma/Discord half of db/lib/dynasty.js — the Baroness, Heir and
// Successor wear the Baron's last name. Server-only: it touches prisma and the
// Discord REST helpers, so nothing that renders in the browser may import it
// (the pure predicates live in the barrel, and the pages hand the client a
// plain boolean instead).

// The living Baron's last name, or null when there is no living Baron or he
// hasn't chosen one. Both cases mean the same thing to a family member being
// created or saved: no last name.
export async function dynastyLastName() {
  const baron = await prisma.character.findFirst({
    where: { status: "ALIVE", role: { slug: DYNASTY_HEAD_SLUG } },
    select: { lastName: true },
  });
  return baron?.lastName ?? null;
}

// Push a newly chosen dynasty name onto every living family member. Called
// only after a Baron write has committed — never on his death, so the family
// keeps the name he gave them until a new Baron overwrites it.
//
// This is a FOURTH writer of the denormalized Character.name mirror (see the
// Character names section of CLAUDE.md), so it composes through
// formatCharacterName like the other three, keeping each member's own
// honorific and GM-granted title.
export async function propagateDynastyLastName(lastName) {
  const members = await prisma.character.findMany({
    where: { status: "ALIVE", role: { slug: { in: DYNASTY_MEMBER_SLUGS } } },
  });

  for (const member of members) {
    if (member.lastName === lastName) continue;

    const updated = await prisma.character.update({
      where: { id: member.id },
      data: {
        lastName,
        name: formatCharacterName({ ...member, lastName }),
      },
    });

    // The bare name seeds the personal Discord role's name and colour and is
    // the character half of the nickname, so both have to follow a rename —
    // best-effort, same as every other caller of these two.
    await ensureCharacterRole(updated).catch(() => {});
    await syncCharacterNickname(updated.discordUserId, formatBareName(updated)).catch(() => {});
  }
}
