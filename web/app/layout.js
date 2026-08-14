import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { getOpenTurn, themeForPhase } from "@/lib/turn";

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata = {
  title: "Lifeweb",
  description: "Lifeweb — a barony amid the wasteland.",
};

export default async function RootLayout({ children }) {
  const turn = await getOpenTurn();
  const theme = themeForPhase(turn?.phase);

  return (
    <html lang="en" data-theme={theme} className={`${mono.variable} h-full`}>
      <body className="h-full">
        <div className="scanlines" />
        {children}
      </body>
    </html>
  );
}
