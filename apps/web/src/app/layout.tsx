import type { Metadata } from "next";
import type { ReactNode } from "react";
import { en } from "../i18n/en";
import "./globals.css";
export const metadata: Metadata = {
  title: en.title,
  description: en.description,
};
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
