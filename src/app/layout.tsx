import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeScript } from "@/components/theme-script";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Flua — Your personal English tutor",
    template: "%s · Flua",
  },
  description:
    "Practise English through natural conversation, targeted grammar work, vocabulary review, writing feedback and speaking practice — with a tutor that remembers what you find hard.",
  applicationName: "Flua",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfb" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1d23" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col antialiased">
        {/* First stop for keyboard and screen-reader users on every page. */}
        <a
          href="#main-content"
          className="bg-primary text-primary-foreground sr-only rounded-md px-4 py-2 focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
