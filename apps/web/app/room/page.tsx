'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  updateProfile,
  User 
} from 'firebase/auth';
import { ref, update, get } from 'firebase/database';
import { auth, rtdb } from '@/lib/firebase';

function RoomContent() {
  const searchParams = useSearchParams();
  const roomId = (searchParams.get('id') || searchParams.get('room') || 'COKDO1').toUpperCase();
  const inviteToken = searchParams.get('invite');

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isJoining, setIsJoining] = useState<boolean>(true);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        let activeUser = user;

        // Bypass registrasi menggunakan Anonymous Auth jika belum login
        if (!activeUser) {
          const credential = await signInAnonymously(auth);
          activeUser = credential.user;

          const guestTag = `Tamu #${activeUser.uid.substring(0, 4).toUpperCase()}`;
          await updateProfile(activeUser, { displayName: guestTag });
        }

        setCurrentUser(activeUser);

        // Auto-join ke Meja Realtime Database
        if (roomId && activeUser) {
          const roomMetaRef = ref(rtdb, `rooms/${roomId}/meta`);
          const roomSnap = await get(roomMetaRef);

          if (!roomSnap.exists()) {
            await update(ref(rtdb, `rooms/${roomId}`), {
              meta: {
                hostId: activeUser.uid,
                createdAt: Date.now(),
                status: 'WAITING',
                roundNumber: 1,
                turnTimeoutMs: 30000,
                isPrivate: true
              },
              game: {
                activeWildRank: 2,
                wildIndicatorCard: { suit: 'HEARTS', rank: 2 },
                currentTurnPlayerId: activeUser.uid,
                turnDeadline: Date.now() + 30000,
                drawDeckCount: 52,
                discardHistory: {
                  lastDiscard: null,
                  recentDiscards: []
                }
              },
              tableLeaderboard: {
                scores: {
                  [activeUser.uid]: 0
                },
                roundLogs: []
              }
            });
          }

          const playerRef = ref(rtdb, `rooms/${roomId}/players/${activeUser.uid}`);
          await update(playerRef, {
            name: activeUser.displayName || 'Pemain Tamu',
            isGuest: activeUser.isAnonymous,
            connected: true,
            joinedAt: Date.now()
          });

          setIsJoining(false);
        }
      } catch (err: any) {
        console.error('Auto-join failed:', err);
        setErrorStatus('Gagal terhubung ke meja. Periksa konfigurasi Realtime Database di Firebase.');
        setIsJoining(false);
      }
    });

    return () => unsubscribe();
  }, [roomId, inviteToken]);

  const copyInviteLink = () => {
    const url = `${window.location.origin}/room?id=${roomId}&invite=auto`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (errorStatus) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-white p-4">
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center max-w-sm">
          <h2 className="text-lg font-bold text-red-400">Peringatan Meja</h2>
          <p className="mt-2 text-sm text-zinc-400">{errorStatus}</p>
        </div>
      </div>
    );
  }

  if (isJoining) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <p className="text-sm text-zinc-400">Menghubungkan ke Meja {roomId}...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-emerald-950 text-white">
      {/* Header Meja */}
      <header className="flex items-center justify-between px-6 py-3 bg-black/40 border-b border-white/10 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="font-black text-lg text-emerald-400">COKDO</span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-sm font-bold text-zinc-200">
            Meja: {roomId}
          </span>
          <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
            {currentUser?.isAnonymous ? 'Akun Tamu (Guest)' : 'Pemain Resmi'}
          </span>
        </div>

        <button
          onClick={copyInviteLink}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 active:scale-95"
        >
          {copied ? 'Tautan Disalin!' : 'Salin Link Undangan'}
        </button>
      </header>

      {/* Arena Meja Kartu */}
      <main className="flex-1 flex flex-col items-center justify-center relative p-4">
        <div className="w-full max-w-4xl h-[520px] rounded-[48px] border-8 border-emerald-900 bg-emerald-800/80 shadow-2xl relative flex items-center justify-center">
          
          {/* Area Tengah: Kartu Sakti & Tumpukan Buang */}
          <div className="flex items-center gap-6 p-6 rounded-2xl bg-black/25 border border-white/10">
            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-300 block mb-1">
                Kartu Sakti
              </span>
              <div className="w-16 h-24 rounded-lg bg-white text-rose-600 font-bold flex flex-col items-center justify-center border-2 border-amber-400 shadow-lg">
                <span className="text-lg">2</span>
                <span className="text-xl">♥</span>
              </div>
            </div>

            <div className="text-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 block mb-1">
                Buangan Terakhir
              </span>
              <div className="w-16 h-24 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500 text-xs">
                Kosong
              </div>
            </div>
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-emerald-200/60 font-mono">
            {currentUser?.displayName} | Menunggu pemain lain bergabung...
          </div>
        </div>
      </main>
    </div>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    }>
      <RoomContent />
    </Suspense>
  );
}
