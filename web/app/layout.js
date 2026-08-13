import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata = {
  title: "Lifeweb",
  description: "Lifeweb — a barony amid the wasteland.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${mono.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
