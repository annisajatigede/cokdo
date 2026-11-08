'use client';

import { useState } from 'react';
import Link from 'next/link';

interface LeaderboardEntry {
  rank: number;
  displayName: string;
  totalScore: number;
  matchesWon: number;
}

export default function LeaderboardPage() {
  const [filter, setFilter] = useState<'daily' | 'weekly' | 'allTime'>('weekly');

  // Dummy initial list sebelum dihubungkan dengan Firestore collection
  const mockLeaderboard: LeaderboardEntry[] = [
    { rank: 1, displayName: 'BudiSakti', totalScore: 3250, matchesWon: 18 },
    { rank: 2, displayName: 'CokdoMaster', totalScore: 2800, matchesWon: 14 },
    { rank: 3, displayName: 'KartuJoker', totalScore: 2150, matchesWon: 11 },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black text-white">Klasemen Global Cokdo</h1>
            <p className="text-sm text-zinc-400">Pemain resmi terdaftar di Firestore</p>
          </div>
          <Link
            href="/"
            className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:text-white transition"
          >
            ← Kembali ke Lobby
          </Link>
        </div>

        {/* Filter Tab */}
        <div className="flex rounded-xl bg-zinc-900/80 p-1 border border-zinc-800 mb-6">
          {(['daily', 'weekly', 'allTime'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold capitalize transition ${
                filter === tab
                  ? 'bg-emerald-500 text-zinc-950 shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {tab === 'daily' ? 'Harian' : tab === 'weekly' ? 'Mingguan' : 'Sepanjang Masa'}
            </button>
          ))}
        </div>

        {/* Tabel Klasemen */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden backdrop-blur">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/80 text-xs uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Peringkat</th>
                <th className="py-3 px-4">Nama Pemain</th>
                <th className="py-3 px-4 text-center">Menang</th>
                <th className="py-3 px-4 text-right">Total Skor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {mockLeaderboard.map((entry) => (
                <tr key={entry.rank} className="hover:bg-zinc-800/20 transition">
                  <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                    #{entry.rank}
                  </td>
                  <td className="py-3 px-4 font-medium text-white">{entry.displayName}</td>
                  <td className="py-3 px-4 text-center text-zinc-400">{entry.matchesWon}</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-amber-400">
                    {entry.totalScore.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
