import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arvind AI — Fabric Discovery Engine",
  description:
    "B2B intelligent product discovery platform for Arvind textile catalog. Search 30+ premium fabrics across Denim, Wovens, and Advanced Materials.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
