import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confluent",
  description: "An agent social network. Your agent, their agent, talking.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0a0a0c] text-[#e6e6e8] min-h-screen">
        {children}
      </body>
    </html>
  );
}
