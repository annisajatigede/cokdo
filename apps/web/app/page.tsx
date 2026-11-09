'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [roomIdInput, setRoomIdInput] = useState('');

  // Auto-detect jika ada parameter id/room di URL home page, langsung redirect ke room
  useEffect(() => {
    const inviteId = searchParams.get('id') || searchParams.get('room');
    if (inviteId) {
      router.replace(`/room?id=${inviteId.toUpperCase()}&invite=auto`);
    }
  }, [searchParams, router]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomIdInput.trim()) {
      router.push(`/room?id=${roomIdInput.trim().toUpperCase()}`);
    }
  };

  const handleCreateRoom = () => {
    const randomRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    router.push(`/room?id=${randomRoomId}`);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 bg-gradient-to-b from-zinc-950 via-zinc-900 to-emerald-950">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur-xl">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 font-extrabold text-2xl border border-emerald-500/30 mb-3">
            🂠
          </div>
          <h1 className="text-3xl font-black tracking-wider text-white">COKDO</h1>
          <p className="mt-1 text-sm text-zinc-400">Game Kartu Remi Sakti Multipemain</p>
        </div>

        <div className="mt-8 space-y-4">
          <button
            onClick={handleCreateRoom}
            className="w-full rounded-xl bg-emerald-500 py-3.5 font-bold text-zinc-950 transition hover:bg-emerald-400 active:scale-[0.98] shadow-lg shadow-emerald-500/20"
          >
            + Buat Meja Privat Baru
          </button>

          <div className="relative flex items-center justify-center">
            <span className="w-full border-t border-zinc-800" />
            <span className="absolute bg-zinc-900 px-3 text-xs uppercase tracking-wider text-zinc-500">
              atau masuk meja
            </span>
          </div>

          <form onSubmit={handleJoin} className="space-y-3">
            <input
              type="text"
              placeholder="Masukkan Kode Meja (mis: AB12CD)"
              value={roomIdInput}
              onChange={(e) => setRoomIdInput(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-center uppercase tracking-widest text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
            />
            <button
              type="submit"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/80 py-3 font-semibold text-zinc-200 transition hover:bg-zinc-700 active:scale-[0.98]"
            >
              Gabung Meja
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <a
            href="/leaderboard"
            className="text-xs text-emerald-400/80 hover:text-emerald-300 transition underline underline-offset-4"
          >
            Lihat Klasemen Global
          </a>
        </div>
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
