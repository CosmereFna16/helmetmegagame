// Manual, terminal-invoked one-off provisioning for the radio category and
// its #watch/#intercom channels. Run
// with `npm run db:sync-narrowcast-channels`. Not called from wipeGameData —
// provisioning is one-time and the channel ids on GameConfig persist across
// a game restart, same as turnsAnnouncementChannelId.
require("dotenv").config();
const { prisma, syncNarrowcastChannels } = require("../index");

async function main() {
  const stats = await syncNarrowcastChannels(prisma);
  if (stats.provisioned.length) {
    console.log(`provisioned in Discord: ${stats.provisioned.join(", ")}`);
  } else {
    console.log("Nothing to provision — both channels already exist.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
