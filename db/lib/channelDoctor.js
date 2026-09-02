// The channel doctor — the reconciliation sweep that makes the role/channel
// system self-healing instead of drift-until-someone-notices. It compares
// what the database says the game looks like against what Discord actually
// shows, reports every mismatch, and (with apply) repairs it.
//
// Two scopes:
//   "cheap" — role membership only: zone roles vs Character.zoneId, turn-ping
//     vs turnPingOptIn, cursed vs the dead-not-yet-rerolled set, character
//     roles existing/orphaned, the structural checks (zone channels/roles
//     exist, the bot's role sits above the zone roles, cursed color 0, no
//     seat-zone stamp pointing at a cave level). One member-list read plus a
//     handful of requests, safe on every bot restart — which is where it runs
//     (bot/src/events/ready.js), and after every turn advance when
//     GameConfig.autoReconcileEnabled is on.
//   "full" — everything above plus the expensive halves: channel overwrites
//     vs the spec, leftover per-member overwrites from the pre-rework access
//     model, PlayerThread rows whose threads 404, threads with no row
//     (adopted), dead invites, and narrowcast member overwrites vs the rules.
//
// Everything is sequential, every check independently caught, and the whole
// run is persisted as a SystemReport (kind: DOCTOR) the Dev Panel renders.
// Dry-run by default: apply: false reports without touching anything.
//
// This is the structural answer to the wipe-time complaint ("no one loses
// their turn-ping role"): instead of hoping every removal in a hundred-call
// loop lands, the doctor makes any miss visible and repairable, and
// finishGameWipe runs it as its own final step.
const {
  getGuildRoles,
  listGuildMembers,
  addMemberRole,
  removeMemberRole,
  deleteGuildRole,
  getChannel,
  deleteChannelOverwrite,
  putChannelOverwrite,
} = require("./discordRest");
const { PLAYER_ROLE_ID, SPECTATOR_ROLE_ID, LEADER_WHITELIST_ROLE_ID } = require("./roleIds");
const { hashNameToColor } = require("./roleColor");
const { cursedRoleId, ensureCursedRoleAppearance } = require("./cursedAccess");
const { zoneChannelSpec } = require("./zoneChannelSpec");
const { reconcileChannelOverwrites, managedOverwriteIds } = require("./syncZones");
const { SPECIAL_CHANNELS, buildNarrowcastContext, computeNarrowcastAccess } = require("./specialChannels");
const {
  findTurnsChannelId,
  turnsChannelOverwrites,
  syncTurnsChannelAccess,
} = require("./turnsChannelAccess");

// See db/scripts/ops/prune-orphan-roles.js for the signature's provenance:
// mentionable and coloured by a hash of its own name is something nothing
// else in the guild reproduces by accident. A Catatonic character's role
// ("<name> • Catatonic", flat grey — db/lib/characterRoleAppearance.js)
// fails this on purpose; it's protected anyway, because a claimed role is
// skipped before the signature is ever tested.
function looksLikeCharacterRole(role) {
  return role.mentionable === true && role.color === hashNameToColor(role.name);
}

function standingRoleIds() {
  return new Set(
    [
      PLAYER_ROLE_ID,
      SPECTATOR_ROLE_ID,
      LEADER_WHITELIST_ROLE_ID,
      process.env.DISCORD_GM_ROLE_ID,
      process.env.DISCORD_CURSED_ROLE_ID,
      process.env.DISCORD_TURN_PING_ROLE_ID,
    ].filter(Boolean),
  );
}

// One finding: { check, target, problem, repaired }. `repaired` is false on a
// dry run, and false when the repair itself failed (then `error` says why).
function makeReporter(findings, apply) {
  return async function report(check, target, problem, repair) {
    const finding = { check, target, problem, repaired: false };
    findings.push(finding);
    if (apply && repair) {
      try {
        await repair();
        finding.repaired = true;
      } catch (err) {
        finding.error = err.message;
      }
    }
  };
}

// Membership reconciliation for one role: everyone in `shouldHave` holds it,
// nobody else does. `holders` is the live member list filtered to this role.
async function reconcileRoleMembership({ roleId, label, shouldHave, members, report }) {
  if (!roleId) return;
  const want = new Set(shouldHave);
  for (const userId of want) {
    const member = members.get(userId);
    if (!member) continue; // left the guild — reported by the character checks
    if (!member.roles.includes(roleId)) {
      await report("role-membership", `${label}/${userId}`, `missing the ${label} role`, () =>
        addMemberRole(userId, roleId),
      );
    }
  }
  for (const [userId, member] of members) {
    if (!member.roles.includes(roleId)) continue;
    if (want.has(userId)) continue;
    await report("role-membership", `${label}/${userId}`, `holds the ${label} role and shouldn't`, () =>
      removeMemberRole(userId, roleId),
    );
  }
}

async function runChannelDoctor(prisma, { apply = false, scope = "cheap", actorDiscordUserId = null } = {}) {
  const startedAt = new Date();
  const findings = [];
  const errors = [];
  const report = makeReporter(findings, apply);

  const [zones, characters, liveRoles, memberList, config] = await Promise.all([
    prisma.zone.findMany({ include: { seatZone: { select: { kind: true } } } }),
    prisma.character.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        discordUserId: true,
        discordRoleId: true,
        zoneId: true,
        turnPingOptIn: true,
      },
    }),
    getGuildRoles(),
    listGuildMembers(),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);

  const members = new Map(memberList.map((m) => [m.user.id, m]));
  const rolesById = new Map(liveRoles.map((r) => [r.id, r]));
  const alive = characters.filter((c) => c.status === "ALIVE");
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  // --- cheap: structure ------------------------------------------------

  for (const zone of zones) {
    if (zone.kind !== "CAVE_GROUP" && zone.discordRoleId && !rolesById.has(zone.discordRoleId)) {
      await report("zone-structure", zone.name, "recorded zone role no longer exists (run db:sync-zones)");
    }
    if (zone.kind !== "CAVE_GROUP" && !zone.discordRoleId) {
      await report("zone-structure", zone.name, "zone has no role recorded (run db:sync-zones)");
    }
    for (const [label, id] of [
      ["category", zone.discordCategoryId],
      ["summary", zone.discordSummaryChannelId],
      ["public", zone.discordPublicChannelId],
      ["private", zone.discordPrivateChannelId],
    ]) {
      if (!id) continue;
      const live = await getChannel(id, { allow404: true }).catch(() => undefined);
      if (live === null) {
        await report("zone-structure", `${zone.name}/${label}`, "recorded channel no longer exists (run db:sync-zones)");
      }
    }
  }

  // The bot's own highest role must sit above every zone role, or the role
  // swaps 403. Report-only — moving roles is a human decision.
  const me = members.get(process.env.DISCORD_CLIENT_ID) ?? null;
  if (me) {
    const botTop = Math.max(...me.roles.map((id) => rolesById.get(id)?.position ?? 0), 0);
    for (const zone of zones) {
      const role = zone.discordRoleId ? rolesById.get(zone.discordRoleId) : null;
      if (role && role.position >= botTop) {
        await report("zone-structure", zone.name, "zone role sits above the bot's highest role — swaps will 403");
      }
    }
  }

  // Cursed appearance: color 0, so ghosts aren't visually outed.
  const cursed = cursedRoleId() ? rolesById.get(cursedRoleId()) : null;
  if (cursed && (cursed.color !== 0 || cursed.hoist)) {
    await report("cursed-appearance", cursed.name, "cursed role is colored/hoisted", () =>
      ensureCursedRoleAppearance(),
    );
  }

  // --- cheap: role membership -----------------------------------------

  // Zone roles: exactly the living characters standing in each zone.
  for (const zone of zones) {
    if (!zone.discordRoleId) continue;
    await reconcileRoleMembership({
      roleId: zone.discordRoleId,
      label: `Zone: ${zone.name}`,
      shouldHave: alive.filter((c) => c.zoneId === zone.id).map((c) => c.discordUserId),
      members,
      report,
    });
  }

  // Turn-ping: living characters' preferences, nobody else.
  await reconcileRoleMembership({
    roleId: process.env.DISCORD_TURN_PING_ROLE_ID,
    label: "turn-ping",
    shouldHave: alive.filter((c) => c.turnPingOptIn).map((c) => c.discordUserId),
    members,
    report,
  });

  // Cursed: exactly the players who have a dead character and no living one
  // (died and not yet rerolled — a reroll removes the role, a wipe removes
  // everyone's).
  const aliveUserIds = new Set(alive.map((c) => c.discordUserId));
  const cursedShould = [
    ...new Set(
      characters
        .filter((c) => c.status !== "ALIVE" && !aliveUserIds.has(c.discordUserId))
        .map((c) => c.discordUserId),
    ),
  ];
  await reconcileRoleMembership({
    roleId: cursedRoleId(),
    label: "cursed",
    shouldHave: cursedShould,
    members,
    report,
  });

  // Character roles: every ALIVE character's role exists; no orphan
  // character-signature roles. Creation isn't repaired here (it needs the
  // name/color pipeline in web/lib/discordGuild.js) — report only. Orphans
  // are deleted on apply, same conservatism as prune-orphan-roles.
  const claimedRoleIds = new Set(characters.map((c) => c.discordRoleId).filter(Boolean));
  const standing = standingRoleIds();
  const zoneRoleIds = new Set(zones.map((z) => z.discordRoleId).filter(Boolean));
  for (const c of alive) {
    if (!c.discordRoleId) {
      await report("character-role", c.name, "living character has no Discord role recorded");
    } else if (!rolesById.has(c.discordRoleId)) {
      await report("character-role", c.name, "recorded character role no longer exists");
    }
  }
  for (const role of liveRoles) {
    if (claimedRoleIds.has(role.id) || standing.has(role.id) || zoneRoleIds.has(role.id)) continue;
    if (!looksLikeCharacterRole(role)) continue;
    if (role.managed || role.permissions !== "0") continue;
    const held = memberList.some((m) => m.roles.includes(role.id));
    if (held) continue;
    await report("character-role", role.name, "orphan character role (no character claims it)", () =>
      deleteGuildRole(role.id),
    );
  }

  // Seat stamping: nothing seat-scoped may point at a cave level.
  const badSeatZones = zones.filter((z) => z.kind === "CAVE_LEVEL").map((z) => z.id);
  if (badSeatZones.length > 0) {
    const [actions, notes] = await Promise.all([
      prisma.action.count({ where: { zoneId: { in: badSeatZones } } }),
      prisma.note.count({ where: { zoneId: { in: badSeatZones } } }),
    ]);
    if (actions > 0 || notes > 0) {
      await report(
        "seat-stamp",
        "Action/Note",
        `${actions + notes} rows stamped with a cave-level zoneId instead of the Caves seat`,
      );
    }
  }

  // --- full: overwrites + threads --------------------------------------

  if (scope === "full") {
    const managed = managedOverwriteIds([...zoneRoleIds]);
    const characterUserIds = new Set(characters.map((c) => c.discordUserId));

    for (const zone of zones) {
      const spec = zoneChannelSpec(zone);
      const targets = [
        ["category", zone.discordCategoryId, spec.category],
        ["summary", zone.discordSummaryChannelId, spec.summary],
        ["public", zone.discordPublicChannelId, spec.public],
        ["private", zone.discordPrivateChannelId, spec.private],
      ];
      for (const [label, channelId, want] of targets) {
        if (!channelId || !want) continue;
        let live;
        try {
          live = await getChannel(channelId, { allow404: true });
        } catch (err) {
          errors.push({ check: "overwrites", target: `${zone.name}/${label}`, message: err.message });
          continue;
        }
        if (!live) continue;

        // Leftover per-member overwrites from the pre-rework model: a member
        // overwrite on a zone channel belongs to nobody now.
        for (const overwrite of live.permission_overwrites ?? []) {
          if (overwrite.type !== 1) continue;
          await report(
            "member-overwrite",
            `${zone.name}/${label}/${overwrite.id}`,
            "stray per-member overwrite on a zone channel",
            () => deleteChannelOverwrite(channelId, overwrite.id),
          );
        }

        // Spec drift, repaired with the same reconcile the sync uses.
        const wanted = new Map(want.permission_overwrites.map((o) => [o.id, o]));
        const liveById = new Map((live.permission_overwrites ?? []).map((o) => [o.id, o]));
        let drifted = false;
        for (const [id, o] of wanted) {
          const l = liveById.get(id);
          if (!l || (l.allow ?? "0") !== (o.allow ?? "0") || (l.deny ?? "0") !== (o.deny ?? "0")) {
            drifted = true;
            break;
          }
        }
        if (!drifted) {
          for (const [id, o] of liveById) {
            if (!wanted.has(id) && managed.has(id) && o.type === 0) drifted = true;
          }
        }
        if (drifted) {
          await report("overwrites", `${zone.name}/${label}`, "channel overwrites drifted from the spec", () =>
            reconcileChannelOverwrites(channelId, want, managed),
          );
        }
      }
    }

    // PlayerThread bookkeeping.
    const rows = await prisma.playerThread.findMany();
    for (const row of rows) {
      const live = await getChannel(row.threadId, { allow404: true }).catch(() => undefined);
      if (live === null) {
        await report("player-thread", row.name, "tracked thread no longer exists on Discord", async () => {
          await prisma.playerThread.deleteMany({ where: { threadId: row.threadId } });
          await prisma.playerThreadInvite.deleteMany({ where: { threadId: row.threadId } });
        });
      }
    }

    // Dead invites: character gone, or thread untracked.
    const invites = await prisma.playerThreadInvite.findMany();
    const trackedThreadIds = new Set(rows.map((r) => r.threadId));
    const characterIds = new Set(characters.filter((c) => c.status === "ALIVE").map((c) => c.id));
    for (const invite of invites) {
      if (trackedThreadIds.has(invite.threadId) && characterIds.has(invite.characterId)) continue;
      await report(
        "thread-invite",
        `${invite.threadId}/${invite.characterId}`,
        "invite for a dead character or untracked thread",
        () =>
          prisma.playerThreadInvite.delete({
            where: { threadId_characterId: { threadId: invite.threadId, characterId: invite.characterId } },
          }),
      );
    }

    // Narrowcast member overwrites vs the rules, channel-major.
    for (const entry of SPECIAL_CHANNELS) {
      const channelId = config?.[entry.configKey];
      if (!channelId) continue;
      let live;
      try {
        live = await getChannel(channelId, { allow404: true });
      } catch (err) {
        errors.push({ check: "narrowcast", target: entry.slug, message: err.message });
        continue;
      }
      if (!live) continue;

      const wantByUser = new Map();
      for (const c of alive) {
        const ctx = await buildNarrowcastContext(prisma, c.id);
        const grant = computeNarrowcastAccess(ctx)[entry.slug];
        if (grant) wantByUser.set(c.discordUserId, grant);
      }

      const PERM_VIEW = 1024n;
      const PERM_SEND = 2048n;
      for (const overwrite of live.permission_overwrites ?? []) {
        if (overwrite.type !== 1) continue;
        const grant = wantByUser.get(overwrite.id);
        if (!grant) {
          const label = characterUserIds.has(overwrite.id) ? "no longer earns it" : "unknown member";
          await report("narrowcast", `${entry.slug}/${overwrite.id}`, `member overwrite ${label}`, () =>
            deleteChannelOverwrite(channelId, overwrite.id),
          );
          continue;
        }
        let allow = 0n;
        if (grant.view || grant.send) allow |= PERM_VIEW;
        if (grant.send) allow |= PERM_SEND;
        if ((overwrite.allow ?? "0") !== allow.toString()) {
          await report("narrowcast", `${entry.slug}/${overwrite.id}`, "member overwrite has the wrong bits", () =>
            putChannelOverwrite(channelId, overwrite.id, { allow: allow.toString(), type: 1 }),
          );
        }
        wantByUser.delete(overwrite.id);
      }
      for (const [userId, grant] of wantByUser) {
        let allow = 0n;
        if (grant.view || grant.send) allow |= PERM_VIEW;
        if (grant.send) allow |= PERM_SEND;
        await report("narrowcast", `${entry.slug}/${userId}`, "member should have access and has no overwrite", () =>
          putChannelOverwrite(channelId, userId, { allow: allow.toString(), type: 1 }),
        );
      }
    }

    // #turns. Outside the zone spec and outside SPECIAL_CHANNELS — nothing in
    // the repo creates it — but its view grants ride the zone roles, so it
    // drifts the same way everything else does. One finding per problem,
    // repaired by re-running the sync (idempotent, and it also strips the
    // hand-made per-member overrides the role grant replaces).
    try {
      const turnsId = await findTurnsChannelId();
      if (!turnsId) {
        await report("turns-access", "#turns", "no text channel named turns in the guild");
      } else {
        const live = await getChannel(turnsId, { allow404: true });
        const overwrites = live?.permission_overwrites ?? [];
        const liveById = new Map(overwrites.map((o) => [o.id, o]));
        const wanted = turnsChannelOverwrites({
          guildId: process.env.DISCORD_GUILD_ID,
          gmRoleId: process.env.DISCORD_GM_ROLE_ID,
          zoneRoleIds: [...zoneRoleIds],
        });
        // One finding for the channel, not one per target: the repair is a
        // single idempotent sync, and reporting it per overwrite would re-run
        // that whole sync once for every drifted bit.
        const problems = [];
        for (const [id, want] of wanted) {
          const l = liveById.get(id);
          if (!l) problems.push(`${id} has no overwrite`);
          else if ((l.allow ?? "0") !== want.allow || (l.deny ?? "0") !== want.deny) {
            problems.push(`${id} has the wrong bits`);
          }
        }
        // The spec is the complete description of who may see #turns, so
        // anything it doesn't name is a leftover — bar a bot's own overwrite,
        // which the sync also leaves alone.
        const botRoleIds = new Set(liveRoles.filter((r) => r.tags?.bot_id).map((r) => r.id));
        const strays = overwrites.filter((o) => !wanted.has(o.id) && !botRoleIds.has(o.id));
        if (strays.length) {
          problems.push(
            `${strays.length} overwrite(s) outside the spec (${strays
              .map((o) => o.id)
              .join(", ")}) — access rides the zone role now`,
          );
        }
        if (problems.length) {
          await report("turns-access", "#turns", problems.join("; "), () =>
            syncTurnsChannelAccess(prisma, { channelId: turnsId }),
          );
        }
      }
    } catch (err) {
      errors.push({ check: "turns-access", target: "#turns", message: err.message });
    }
  }

  const failures = [
    ...errors,
    ...findings.filter((f) => f.error).map((f) => ({ check: f.check, target: f.target, message: f.error })),
  ];
  const summaryCounts = {};
  for (const f of findings) summaryCounts[f.check] = (summaryCounts[f.check] ?? 0) + 1;

  const result = {
    scope,
    apply,
    findings,
    failures,
    repaired: findings.filter((f) => f.repaired).length,
  };

  await prisma.systemReport
    .create({
      data: {
        kind: "DOCTOR",
        startedAt,
        finishedAt: new Date(),
        ok: failures.length === 0,
        actorDiscordUserId,
        summary: {
          scope,
          apply,
          findings: findings.length,
          repaired: result.repaired,
          byCheck: summaryCounts,
        },
        failures: [
          ...failures,
          ...findings
            .filter((f) => !f.repaired && !f.error)
            .map((f) => ({ check: f.check, target: f.target, message: f.problem })),
        ],
      },
    })
    .catch((err) => console.error("Channel doctor: report write failed:", err.message));

  return result;
}

module.exports = { runChannelDoctor };
