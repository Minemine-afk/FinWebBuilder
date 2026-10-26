import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finexis calculators",
  description: "Compare what real choices cost over time, in Singapore dollars, with every price sourced.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* App Router has one root layout, so this loads on every page. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="bg-background text-foreground antialiased" style={{ fontFamily: "Geist, system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
