// One-off: drop the per-zone walls so anyone in the guild can read and write in
// every roleplay channel.
//
// The game's database was lost and the mechanics are down, so zone-role gating
// only stops people from talking to each other. This lifts it at the Discord
// layer and touches nothing else: no roles created or deleted, no channels, no
// messages, no members, no database.
//
// Per target: @everyone is opened, Cursed's send-deny is cleared so ghosts get
// their voice back, and Spectator is left alone so it stays a watching seat (an
// explicit role deny still beats the @everyone allow).
//
//   node db/scripts/open-rp-channels.js            # snapshot + report, no writes
//   node db/scripts/open-rp-channels.js --apply    # snapshot, then apply
//
// The snapshot it writes first is the undo: every current overwrite for every
// target, keyed by channel id.

const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// The four zone categories. Everything inside them is a scene; everything
// outside (Gameplay, GM, Radio, Text Channels) is deliberately untouched.
const RP_CATEGORIES = ["Town", "Fortress", "Windlands", "Caves"];

const P = {
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
};

// A forum needs both: SEND_MESSAGES starts a post, SEND_MESSAGES_IN_THREADS
// replies inside one. Granting only the first leaves every existing scene
// read-only, which is the opposite of the point.
const OPEN = Object.values(P).reduce((acc, bit) => acc | bit, 0n);

function bitNames(mask) {
  const m = BigInt(mask);
  const hit = Object.entries(P).filter(([, bit]) => (m & bit) === bit).map(([name]) => name);
  return hit.length ? hit.join(",") : "-";
}

async function api(route, init = {}) {
  const res = await fetch(`https://discord.com/api/v10${route}`, {
    ...init,
    headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${route} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!TOKEN || !GUILD_ID) throw new Error("DISCORD_TOKEN and DISCORD_GUILD_ID must be set");

  const roles = await api(`/guilds/${GUILD_ID}/roles`);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const roleId = (name) => roles.find((r) => r.name === name)?.id ?? null;

  const cursedId = roleId("Cursed");
  // @everyone's role id is the guild id. Always present, so no null check.
  const everyoneId = GUILD_ID;

  const channels = await api(`/guilds/${GUILD_ID}/channels`);
  const catIdByName = new Map(channels.filter((c) => c.type === 4).map((c) => [c.name, c.id]));
  const catNameById = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c.name]));

  const targets = [];
  for (const name of RP_CATEGORIES) {
    const id = catIdByName.get(name);
    if (!id) throw new Error(`No category named "${name}" — refusing to guess`);
    targets.push(channels.find((c) => c.id === id));
  }
  for (const c of channels) {
    if (c.type === 4) continue;
    if (c.parent_id && RP_CATEGORIES.includes(catNameById.get(c.parent_id))) targets.push(c);
  }

  // Snapshot before anything else. This file is the undo.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(__dirname, "..", "..", "docs", "recovery");
  fs.mkdirSync(outDir, { recursive: true });
  const snapPath = path.join(outDir, `overwrites-before-${stamp}.json`);
  fs.writeFileSync(
    snapPath,
    JSON.stringify(
      targets.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parent: catNameById.get(c.parent_id) ?? null,
        permission_overwrites: c.permission_overwrites ?? [],
      })),
      null,
      2,
    ),
  );
  console.log(`Snapshot: ${snapPath}`);
  console.log(`Targets: ${targets.length} (${RP_CATEGORIES.length} categories + ${targets.length - RP_CATEGORIES.length} channels)\n`);

  for (const c of targets) {
    const where = `${catNameById.get(c.parent_id) ?? "CATEGORY"}/${c.name}`;
    const overwrites = (c.permission_overwrites ?? []).map((o) => ({ ...o }));

    const upsert = (id, mutate) => {
      let row = overwrites.find((o) => o.id === id);
      if (!row) {
        row = { id, type: 0, allow: "0", deny: "0" };
        overwrites.push(row);
      }
      mutate(row);
    };

    upsert(everyoneId, (row) => {
      row.allow = String((BigInt(row.allow) | OPEN));
      row.deny = String(BigInt(row.deny) & ~OPEN);
    });

    // Ghosts get their voice back: clear the deny and let them inherit the open
    // @everyone allow. Their existing allow (view + react) is left as it is.
    if (cursedId) {
      upsert(cursedId, (row) => {
        row.deny = String(BigInt(row.deny) & ~OPEN);
      });
    }

    console.log(`${apply ? "PATCH" : "would patch"}  ${where}`);
    for (const o of overwrites) {
      const before = (c.permission_overwrites ?? []).find((x) => x.id === o.id);
      const changed = !before || before.allow !== o.allow || before.deny !== o.deny;
      if (!changed) continue;
      console.log(`    ${(roleName.get(o.id) ?? o.id).padEnd(22)} allow ${bitNames(o.allow)}`);
      console.log(`    ${"".padEnd(22)} deny  ${bitNames(o.deny)}`);
    }

    if (apply) {
      await api(`/channels/${c.id}`, { method: "PATCH", body: JSON.stringify({ permission_overwrites: overwrites }) });
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  console.log(apply ? "\nDone." : "\nDRY RUN — nothing was changed. Re-run with --apply.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
