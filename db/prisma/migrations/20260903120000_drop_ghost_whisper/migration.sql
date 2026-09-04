-- The ghost 🌬️ whisper is gone. A ghost's presence is reported by the rotted
-- body instead (bot/src/lib/deathSmell.js), which nags the Location a corpse
-- is lying in on its own timer — so there is no per-ghost cooldown left to
-- persist and nothing reads this table.
DROP TABLE IF EXISTS "GhostWhisper";
