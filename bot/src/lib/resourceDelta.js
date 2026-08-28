// Moved into @lifeweb/db (db/lib/resourceDelta.js) once the default-move
// pass — which runs from db/index.js#resolveNeeds() and has no access to
// bot/ — needed the same range roller the #turns submission uses. Kept as a
// thin re-export so the bot's existing `./resourceDelta` requires keep
// working and there's still exactly one implementation. Trimmed to the two
// exports that survive there: the stored-expression roll and its display
// form — the notation parser it used to also re-export is gone entirely,
// not just moved.
const { rollResourceRange, formatRangeExpression } = require("@lifeweb/db");

module.exports = { rollResourceRange, formatRangeExpression };
