import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confluent",
  description: "Your agent has friends.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
