import type { Metadata } from "next";
import "./globals.css";
import { GlobalPicks } from "../components/GlobalPicks";

export const metadata: Metadata = {
  title: "DeepSide AI",
  description: "GO DEEPER INTO YOUR PICKS. Deep sports research, analytics and AI-powered insights.",
  openGraph: {
    title: "DeepSide AI — GO DEEPER INTO YOUR PICKS.",
    description: "Deep sports research, analytics and AI-powered insights.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]"><GlobalPicks>{children}</GlobalPicks></body>
    </html>
  );
}
