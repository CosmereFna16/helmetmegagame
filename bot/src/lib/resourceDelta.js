// Moved into @lifeweb/db (db/lib/resourceDelta.js) once the default-move
// pass — which runs from db/index.js#resolveNeeds() and has no access to
// bot/ — needed the same parser the #turns submission uses. Kept as a thin
// re-export so the bot's existing `./resourceDelta` requires keep working
// and there's still exactly one implementation.
const {
  parseResourceDelta,
  parseResourceDice,
  rollResourceDice,
  formatResourceLines,
} = require("@lifeweb/db");

module.exports = { parseResourceDelta, parseResourceDice, rollResourceDice, formatResourceLines };
