"use server";

import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { guarded, UserError } from "@/lib/actionResult";
import { buildAuditWhere, loadAuditContext, parseAuditParams } from "@/lib/auditQuery";

// The current filter, as a file.
//
// A server action is a public endpoint, so the GM gate is re-applied here
// rather than trusted from the desk that called it — and the WHERE is rebuilt
// from the same parser the page uses, so an export can never disagree with the
// screen it was taken from.

// The log is unbounded and append-only. A GM asking for "everything" wants a
// file they can open, not a browser tab that dies building a 400MB string, so
// the export is capped and says so in its own last line.
const EXPORT_LIMIT = 10000;

async function exportAuditImpl({ params, format }) {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) throw new UserError("Not authorized.");

  const filters = parseAuditParams(params ?? {});
  const [guildMembers, gmProfiles] = await Promise.all([listGuildMembers(), getGmProfiles()]);
  const ctx = await loadAuditContext({ gmIds: gmProfiles.map((p) => p.discordUserId) });
  if (filters.q) {
    const lower = filters.q.toLowerCase();
    ctx.usernameMatchIds = guildMembers
      .filter((m) => m.username?.toLowerCase().includes(lower) || m.globalName?.toLowerCase().includes(lower))
      .map((m) => m.id);
  }

  const where = await buildAuditWhere(filters, ctx);
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: EXPORT_LIMIT,
    include: { targetCharacter: { select: { name: true } } },
  });

  const usernameById = new Map(guildMembers.map((m) => [m.id, m.globalName ?? m.username ?? m.id]));
  const shaped = rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    action: r.actionType,
    actorDiscordUserId: r.actorDiscordUserId,
    actor: usernameById.get(r.actorDiscordUserId) ?? r.actorDiscordUserId,
    target: r.targetCharacter?.name ?? "",
    reason: r.reason ?? "",
    details: r.details ?? null,
  }));

  const text =
    format === "json"
      ? JSON.stringify(shaped, null, 2)
      : toCsv(shaped.map((r) => ({ ...r, details: r.details ? JSON.stringify(r.details) : "" })));

  return { ok: true, text, count: rows.length, truncated: rows.length === EXPORT_LIMIT };
}

function toCsv(rows) {
  const columns = ["at", "action", "actor", "actorDiscordUserId", "target", "reason", "details", "id"];
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    // Quote everything rather than guessing: a reason is free text a player
    // typed, and it will contain commas, quotes and newlines.
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}

export async function exportAudit(input) {
  return guarded(() => exportAuditImpl(input));
}
