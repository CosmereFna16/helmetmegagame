export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Messages</h1>
      <div className="panel animate-pulse p-4" style={{ color: "var(--muted)" }}>
        Loading…
      </div>
    </div>
  );
}
