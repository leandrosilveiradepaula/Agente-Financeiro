import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agente SQL Financeiro DuckLake",
  description: "Interface executiva para geracao e revisao de SQL financeiro DuckLake."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
