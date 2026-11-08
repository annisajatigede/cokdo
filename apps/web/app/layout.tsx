import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cokdo - Game Remi Multipemain',
  description: 'Game Kartu Remi Online Multiplayer dengan Kartu Sakti & Logika Sanksi Umpan',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-zinc-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
