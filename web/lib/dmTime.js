// Time labels for the DM thread, in the shape a chat app uses: "Today at
// 14:02", "Yesterday at 09:15", otherwise the date — and a short "14:02" for
// a message inside a run. `now` is passed in (useNowTick) so "Today" flips at
// midnight without a reload.

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 86_400_000;

export function dayKey(ms) {
  return startOfDay(ms);
}

export function dayLabel(ms, now) {
  const day = startOfDay(ms);
  const today = startOfDay(now);
  if (day === today) return "Today";
  if (day === today - DAY_MS) return "Yesterday";
  const d = new Date(ms);
  const opts = { day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

export function clockLabel(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDmTime(ms, now) {
  const day = startOfDay(ms);
  const today = startOfDay(now);
  const time = clockLabel(ms);
  if (day === today) return `Today at ${time}`;
  if (day === today - DAY_MS) return `Yesterday at ${time}`;
  return `${new Date(ms).toLocaleDateString()} ${time}`;
}

export function fullTimestamp(ms) {
  return new Date(ms).toLocaleString();
}
