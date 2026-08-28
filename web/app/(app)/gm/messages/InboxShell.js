"use client";

import { usePathname } from "next/navigation";

// Sets which pane is visible below the 720px breakpoint (globals.css
// `.inbox-shell[data-mobile-view]`) — a thread route ("/gm/messages/<id>")
// shows the thread only, the bare index route shows the list only. Desktop
// ignores the attribute entirely (both panes render via the grid).
export default function InboxShell({ children }) {
  const pathname = usePathname();
  const onThread = pathname !== "/gm/messages";
  return (
    <div className="inbox-shell" data-mobile-view={onThread ? "thread" : "list"}>
      {children}
    </div>
  );
}
