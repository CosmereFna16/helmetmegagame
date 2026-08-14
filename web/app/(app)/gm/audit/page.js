import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGuildMember, isGm } from "@/lib/discordGuild";

const PAGE_SIZE = 50;

export default async function AuditLogPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const member = await getGuildMember(session.discordUserId);
  if (!isGm(member)) redirect("/character");

  const params = await searchParams;
  const actionType = params?.actionType?.toString().trim() || "";
  const actor = params?.actor?.toString().trim() || "";
  const target = params?.target?.toString().trim() || "";
  const from = params?.from?.toString().trim() || "";
  const to = params?.to?.toString().trim() || "";
  const page = Math.max(1, Number.parseInt(params?.page?.toString() ?? "1", 10) || 1);

  const where = {
    ...(actionType ? { actionType: { contains: actionType, mode: "insensitive" } } : {}),
    ...(actor ? { actorDiscordUserId: { contains: actor, mode: "insensitive" } } : {}),
    ...(target ? { targetCharacter: { name: { contains: target, mode: "insensitive" } } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { targetCharacter: { select: { name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(newPage) {
    const next = new URLSearchParams({ actionType, actor, target, from, to, page: String(newPage) });
    for (const key of [...next.keys()]) {
      if (!next.get(key)) next.delete(key);
    }
    return `/gm/audit?${next.toString()}`;
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Audit Log</h1>

      <form className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="field">
          <span className="field-label">Action type</span>
          <input name="actionType" defaultValue={actionType} placeholder="e.g. resource_transfer" />
        </label>
        <label className="field">
          <span className="field-label">Actor Discord ID</span>
          <input name="actor" defaultValue={actor} />
        </label>
        <label className="field">
          <span className="field-label">Target character</span>
          <input name="target" defaultValue={target} />
        </label>
        <label className="field">
          <span className="field-label">From</span>
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <input type="date" name="to" defaultValue={to} />
        </label>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap">{entry.createdAt.toISOString()}</td>
                <td>{entry.actionType}</td>
                <td className="whitespace-nowrap">{entry.actorDiscordUserId}</td>
                <td>{entry.targetCharacter?.name ?? "-"}</td>
                <td className="max-w-xs truncate">{entry.details ? JSON.stringify(entry.details) : ""}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center" style={{ color: "var(--muted)" }}>
                  No entries match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm" style={{ color: "var(--muted)" }}>
        <span>
          Page {page} of {totalPages} ({total} entries)
        </span>
        <div className="flex gap-3">
          {page > 1 && (
            <a href={pageHref(page - 1)} className="menu-item">
              Previous
            </a>
          )}
          {page < totalPages && (
            <a href={pageHref(page + 1)} className="menu-item">
              Next
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
