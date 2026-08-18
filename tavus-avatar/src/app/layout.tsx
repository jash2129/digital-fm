import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { isFinanceEvent } from "@/lib/event";

import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
});

const dealershipName = process.env.DEALERSHIP_NAME || "Digital Finance Manager";

export const metadata: Metadata = isFinanceEvent()
  ? {
      title: dealershipName,
      description: "F&I finance manager video consultation.",
    }
  : {
      title: "AWS Voice AI Demo",
      description: "Private AWS Voice AI booth demo with Daily React and tool-driven content overlays.",
    };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
