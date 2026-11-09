'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  updateProfile,
  User 
} from 'firebase/auth';
import { ref, update, onValue } from 'firebase/database';
import { auth, rtdb } from '@/lib/firebase';
import { 
  Card, 
  Suit, 
  dealGame, 
  validateMeldWithWildCard, 
  calculateClosingBonus 
} from '@cokdo/shared';

// Helper visual render daun kartu
function getSuitSymbol(suit: Suit): { symbol: string; color: string } {
  switch (suit) {
    case 'HEARTS': return { symbol: '♥', color: 'text-rose-500' };
    case 'DIAMONDS': return { symbol: '♦', color: 'text-orange-500' };
    case 'CLUBS': return { symbol: '♣', color: 'text-emerald-400' };
    case 'SPADES': return { symbol: '♠', color: 'text-sky-400' };
    default: return { symbol: '?', color: 'text-white' };
  }
}

function getRankLabel(rank: number): string {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return rank.toString();
}

function RoomContent() {
  const searchParams = useSearchParams();
  const roomId = (searchParams.get('id') || searchParams.get('room') || 'COKDO1').toUpperCase();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [roomData, setRoomData] = useState<any>(null);
  const [myHand, setMyHand] = useState<Card[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [meldMessage, setMeldMessage] = useState<string | null>(null);
  const [hasDrawnThisTurn, setHasDrawnThisTurn] = useState<boolean>(false);
  const [lastDrawnSource, setLastDrawnSource] = useState<'deck' | 'discard' | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // 1. Auth Listener & Auto Guest Login
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      let activeUser = user;
      if (!activeUser) {
        const credential = await signInAnonymously(auth);
        activeUser = credential.user;
        const guestTag = `Pemain #${activeUser.uid.substring(0, 4).toUpperCase()}`;
        await updateProfile(activeUser, { displayName: guestTag });
      }
      setCurrentUser(activeUser);

      // Daftarkan pemain ke meja
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${activeUser.uid}`);
      await update(playerRef, {
        name: activeUser.displayName || `Pemain #${activeUser.uid.substring(0, 4)}`,
        isGuest: activeUser.isAnonymous,
        connected: true,
        lastSeen: Date.now()
      });
    });

    return () => unsubscribe();
  }, [roomId]);

  // 2. Realtime Listener ke Room State di Firebase RTDB
  useEffect(() => {
    if (!roomId) return;
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setRoomData(data);
        if (currentUser && data.game?.hands && data.game.hands[currentUser.uid]) {
          setMyHand(data.game.hands[currentUser.uid]);
        }
      }
    });

    return () => unsubscribe();
  }, [roomId, currentUser]);

  const playersList = roomData?.players ? Object.entries<any>(roomData.players) : [];
  const isHost = currentUser && roomData?.meta?.hostId === currentUser.uid;
  const isMyTurn = currentUser && roomData?.game?.currentTurnPlayerId === currentUser.uid;
  const activeWildRank = roomData?.game?.activeWildRank || 2;
  const wildCard = roomData?.game?.wildIndicatorCard;
  const lastDiscard = roomData?.game?.discardHistory?.lastDiscard;

  // 3. Aksi: Mulai Permainan (Bagi 52 Kartu & Tentukan Kartu Sakti)
  const handleStartGame = async () => {
    if (!playersList.length || !isHost) return;
    const playerIds = playersList.map(([id]) => id);
    const deal = dealGame(playerIds);

    const updates: Record<string, any> = {
      'meta/status': 'PLAYING',
      'game/activeWildRank': deal.activeWildRank,
      'game/wildIndicatorCard': deal.wildIndicatorCard,
      'game/drawDeck': deal.drawDeck,
      'game/drawDeckCount': deal.drawDeck.length,
      'game/hands': deal.playerHands,
      'game/currentTurnPlayerId': deal.firstPlayerId,
      'game/turnDeadline': Date.now() + 30000,
      'game/discardHistory/lastDiscard': null,
      'game/discardHistory/recentDiscards': []
    };

    // Update hand count visual tiap pemain
    playerIds.forEach(id => {
      updates[`players/${id}/handCount`] = 7;
    });

    await update(ref(rtdb, `rooms/${roomId}`), updates);
    setHasDrawnThisTurn(false);
    setSelectedCardIds([]);
  };

  // 4. Aksi: Ambil Kartu dari Dek
  const handleDrawCard = async () => {
    if (!isMyTurn || hasDrawnThisTurn || !roomData?.game?.drawDeck) return;
    const deck = [...roomData.game.drawDeck];
    if (deck.length === 0) return;

    const drawnCard = deck.pop();
    const updatedMyHand = [...myHand, drawnCard];

    await update(ref(rtdb, `rooms/${roomId}`), {
      'game/drawDeck': deck,
      'game/drawDeckCount': deck.length,
      [`game/hands/${currentUser?.uid}`]: updatedMyHand,
      [`players/${currentUser?.uid}/handCount`]: updatedMyHand.length,
    });

    setHasDrawnThisTurn(true);
    setLastDrawnSource('deck');
  };

  // 5. Aksi: Ambil Kartu dari Buangan Terakhir (Discard Pile)
  const handleDrawFromDiscard = async () => {
    if (!isMyTurn || hasDrawnThisTurn || !lastDiscard) return;
    const takenCard = lastDiscard.card;
    const updatedMyHand = [...myHand, takenCard];

    await update(ref(rtdb, `rooms/${roomId}`), {
      'game/discardHistory/lastDiscard': null,
      [`game/hands/${currentUser?.uid}`]: updatedMyHand,
      [`players/${currentUser?.uid}/handCount`]: updatedMyHand.length,
    });

    setHasDrawnThisTurn(true);
    setLastDrawnSource('discard');
  };

  // 6. Aksi: Buang Kartu (Discard) & Pindah Giliran
  const handleDiscard = async () => {
    if (!isMyTurn || !hasDrawnThisTurn || selectedCardIds.length !== 1) return;
    const discardCardId = selectedCardIds[0];
    const discardCard = myHand.find(c => c.id === discardCardId);
    if (!discardCard) return;

    const updatedHand = myHand.filter(c => c.id !== discardCardId);

    // Cari pemain berikutnya
    const playerIds = playersList.map(([id]) => id);
    const currentIndex = playerIds.indexOf(currentUser?.uid || '');
    const nextPlayerId = playerIds[(currentIndex + 1) % playerIds.length];

    const discardEvent = {
      card: discardCard,
      discardedBy: currentUser?.uid,
      turnIndex: (roomData.game.discardHistory?.recentDiscards?.length || 0) + 1,
      timestamp: Date.now()
    };

    const recent = roomData.game.discardHistory?.recentDiscards || [];

    await update(ref(rtdb, `rooms/${roomId}`), {
      'game/discardHistory/lastDiscard': discardEvent,
      'game/discardHistory/recentDiscards': [...recent, discardEvent],
      [`game/hands/${currentUser?.uid}`]: updatedHand,
      [`players/${currentUser?.uid}/handCount`]: updatedHand.length,
      'game/currentTurnPlayerId': nextPlayerId,
      'game/turnDeadline': Date.now() + 30000,
    });

    setHasDrawnThisTurn(false);
    setSelectedCardIds([]);
    setLastDrawnSource(null);
  };

  // 7. Aksi: TUTUP / RUMMY (Validasi Menang & Logika Sanksi Umpan)
  const handleDeclareWin = async () => {
    if (!isMyTurn || selectedCardIds.length !== 1) {
      alert('Pilih 1 kartu penutup untuk dibuang ke tombol TUTUP!');
      return;
    }

    const closingCardId = selectedCardIds[0];
    const closingCard = myHand.find(c => c.id === closingCardId);
    if (!closingCard) return;

    const remainingMeldCards = myHand.filter(c => c.id !== closingCardId);
    const checkMeld = validateMeldWithWildCard(remainingMeldCards, activeWildRank);

    if (!checkMeld.isValid && remainingMeldCards.length > 0) {
      const confirmForce = confirm(
        'Kombinasi sisa kartu Anda belum valid sepenuhnya. Apakah Anda yakin ingin menutup kartu sekarang?'
      );
      if (!confirmForce) return;
    }

    const winnerId = currentUser?.uid || '';
    const bonus = calculateClosingBonus(closingCard, activeWildRank);
    const scores = { ...(roomData.tableLeaderboard?.scores || {}) };
    let penalizedPlayerId: string | null = null;

    // Logika Sanksi Umpan / Tembak
    if (lastDrawnSource === 'discard' && lastDiscard) {
      const feederId = lastDiscard.discardedBy;
      if (feederId && feederId !== winnerId) {
        penalizedPlayerId = feederId;
        scores[feederId] = (scores[feederId] || 0) - bonus;
      }
    }

    scores[winnerId] = (scores[winnerId] || 0) + bonus;

    // Pemain pasif
    playersList.forEach(([pid]) => {
      if (pid !== winnerId && pid !== penalizedPlayerId) {
        scores[pid] = (scores[pid] || 0) - 25;
      }
    });

    await update(ref(rtdb, `rooms/${roomId}`), {
      'meta/status': 'ROUND_END',
      'tableLeaderboard/scores': scores,
      'meta/lastRoundResult': {
        winnerId,
        winnerName: currentUser?.displayName,
        penalizedPlayerId,
        closingCard,
        bonus,
        wasFromDiscard: lastDrawnSource === 'discard'
      }
    });
  };

  // 8. Cek Validitas Kombinasi Kartu yang Dipilih
  const handleCheckMeld = () => {
    const selected = myHand.filter(c => selectedCardIds.includes(c.id));
    if (selected.length < 3) {
      setMeldMessage('Pilih minimal 3 kartu untuk membentuk Seri atau Kelompok.');
      return;
    }
    const result = validateMeldWithWildCard(selected, activeWildRank);
    if (result.isValid) {
      setMeldMessage(`✅ VALID ${result.type}! Total Poin: ${result.calculatedPoints}`);
    } else {
      setMeldMessage('❌ Kombinasi belum valid sebagai Kelompok (Set) atau Seri (Run).');
    }
  };

  const toggleSelectCard = (cardId: string) => {
    setSelectedCardIds(prev => 
      prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId]
    );
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(`${window.location.origin}/room?id=${roomId}&invite=auto`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 text-white font-sans">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-6 py-2.5 bg-black/60 border-b border-white/10 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <span className="font-black text-xl text-emerald-400 tracking-wider">COKDO</span>
          <span className="font-mono text-xs bg-zinc-800 text-zinc-300 px-2 py-1 rounded border border-zinc-700">
            Meja: {roomId}
          </span>
          <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
            {playersList.length}/4 Pemain
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={copyInvite}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 active:scale-95 transition"
          >
            {copied ? '✓ Tautan Disalin!' : '📋 Salin Undangan'}
          </button>
        </div>
      </header>

      {/* Main Game Table Arena */}
      <main className="flex-1 relative flex flex-col items-center justify-between p-4 bg-radial from-emerald-900/40 via-zinc-950 to-zinc-950">
        
        {/* Kursi Pemain Atas & Samping */}
        <div className="w-full max-w-4xl flex items-center justify-between px-8 pt-2">
          {playersList.filter(([id]) => id !== currentUser?.uid).map(([id, p]) => (
            <div 
              key={id} 
              className={`flex flex-col items-center p-3 rounded-2xl border transition-all ${
                roomData?.game?.currentTurnPlayerId === id 
                  ? 'bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/50 scale-105' 
                  : 'bg-zinc-900/60 border-zinc-800'
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-emerald-600/30 border border-emerald-500/50 flex items-center justify-center font-bold text-sm text-emerald-300">
                {p.name?.substring(0, 2).toUpperCase()}
              </div>
              <span className="text-xs font-semibold mt-1 max-w-[90px] truncate">{p.name}</span>
              <span className="text-[10px] text-zinc-400 font-mono">
                {roomData?.meta?.status === 'PLAYING' ? `🂠 ${p.handCount || 7} Kartu` : 'Siap'}
              </span>
              <span className="text-[10px] text-emerald-400 font-bold font-mono">
                Skor: {roomData?.tableLeaderboard?.scores?.[id] || 0}
              </span>
            </div>
          ))}
        </div>

        {/* Center Table: Kartu Sakti & Deck Area */}
        <div className="relative flex items-center justify-center gap-8 p-6 rounded-3xl bg-emerald-950/40 border-2 border-emerald-600/30 shadow-2xl backdrop-blur-md">
          
          {/* Kartu Sakti Terbuka */}
          <div className="flex flex-col items-center">
            <span className="text-[11px] font-black uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1">
              ⭐ KARTU SAKTI ⭐
            </span>
            {wildCard ? (
              <div className="relative w-18 h-26 rounded-xl bg-white text-zinc-950 font-bold flex flex-col items-center justify-between p-2 border-3 border-amber-400 shadow-xl shadow-amber-500/20 animate-pulse">
                <span className="text-sm font-black self-start">{getRankLabel(wildCard.rank)}</span>
                <span className={`text-2xl ${getSuitSymbol(wildCard.suit).color}`}>
                  {getSuitSymbol(wildCard.suit).symbol}
                </span>
                <span className="text-[9px] bg-amber-400 text-zinc-950 px-1 rounded font-black">
                  SEMUA {getRankLabel(wildCard.rank)}
                </span>
              </div>
            ) : (
              <div className="w-18 h-26 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-xs text-zinc-600">
                Tertutup
              </div>
            )}
          </div>

          {/* Tumpukan Dek Ambil */}
          <div className="flex flex-col items-center">
            <span className="text-[11px] font-semibold text-zinc-400 mb-1">
              Dek ({roomData?.game?.drawDeckCount || 52})
            </span>
            <button
              onClick={handleDrawCard}
              disabled={!isMyTurn || hasDrawnThisTurn || roomData?.meta?.status !== 'PLAYING'}
              className={`w-18 h-26 rounded-xl border-2 flex flex-col items-center justify-center font-bold text-xs transition ${
                isMyTurn && !hasDrawnThisTurn && roomData?.meta?.status === 'PLAYING'
                  ? 'bg-emerald-600 hover:bg-emerald-500 border-white text-white shadow-lg shadow-emerald-500/40 cursor-pointer active:scale-95'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed opacity-60'
              }`}
            >
              <span>AMBIL</span>
              <span className="text-lg">🂠</span>
            </button>
          </div>

          {/* Tumpukan Buang Terakhir (Discard Pile) */}
          <div className="flex flex-col items-center">
            <span className="text-[11px] font-semibold text-zinc-400 mb-1">
              Buangan Terakhir
            </span>
            {lastDiscard ? (
              <div 
                onClick={handleDrawFromDiscard}
                className={`w-18 h-26 rounded-xl bg-white text-zinc-950 font-bold flex flex-col items-center justify-between p-2 border-2 transition ${
                  isMyTurn && !hasDrawnThisTurn
                    ? 'border-emerald-400 cursor-pointer ring-2 ring-emerald-400 shadow-lg hover:scale-105'
                    : 'border-zinc-300 opacity-90'
                }`}
              >
                <span className="text-sm font-black self-start">{getRankLabel(lastDiscard.card.rank)}</span>
                <span className={`text-2xl ${getSuitSymbol(lastDiscard.card.suit).color}`}>
                  {getSuitSymbol(lastDiscard.card.suit).symbol}
                </span>
                <span className="text-[9px] text-zinc-500 truncate w-full text-center">
                  dari {roomData?.players?.[lastDiscard.discardedBy]?.name?.substring(0, 6) || 'Lawan'}
                </span>
              </div>
            ) : (
              <div className="w-18 h-26 rounded-xl bg-zinc-900 border border-dashed border-zinc-700 flex items-center justify-center text-[10px] text-zinc-500">
                Kosong
              </div>
            )}
          </div>
        </div>

        {/* Status Ronde & Tombol Mulai (Untuk Host) */}
        {roomData?.meta?.status === 'WAITING' && (
          <div className="bg-zinc-900/90 border border-zinc-700 rounded-2xl p-6 text-center max-w-md shadow-2xl backdrop-blur">
            <h3 className="text-lg font-bold text-white mb-2">Ruang Tunggu Meja</h3>
            <p className="text-xs text-zinc-400 mb-4">
              {playersList.length < 2 
                ? 'Minimal 2 pemain (maksimal 4) untuk dapat memulai permainan.' 
                : `${playersList.length} pemain sudah siap di meja!`}
            </p>
            {isHost ? (
              <button
                onClick={handleStartGame}
                className="w-full rounded-xl bg-emerald-500 py-3 font-bold text-zinc-950 hover:bg-emerald-400 active:scale-95 transition shadow-lg shadow-emerald-500/30"
              >
                🎮 Mulai Permainan Sekarang!
              </button>
            ) : (
              <div className="text-xs text-emerald-400 animate-pulse font-medium">
                Menunggu Host ({roomData?.players?.[roomData?.meta?.hostId]?.name || 'Tuan Rumah'}) memulai...
              </div>
            )}
          </div>
        )}

        {/* Modal Ronde Selesai (Pemenang & Sanksi Kena Umpan) */}
        {roomData?.meta?.status === 'ROUND_END' && (
          <div className="bg-zinc-900/95 border-2 border-amber-400 rounded-2xl p-6 text-center max-w-lg shadow-2xl backdrop-blur z-30">
            <h2 className="text-2xl font-black text-amber-400 mb-1">🎉 RONDE SELESAI! 🎉</h2>
            <p className="text-sm text-zinc-200 font-semibold mb-3">
              Pemenang: <span className="text-emerald-400">{roomData?.meta?.lastRoundResult?.winnerName}</span> 
              {' '}(+{roomData?.meta?.lastRoundResult?.bonus} Poin)
            </p>
            
            {roomData?.meta?.lastRoundResult?.wasFromDiscard && (
              <div className="bg-red-950/60 border border-red-500/40 rounded-xl p-3 mb-4 text-xs text-red-200">
                ⚠️ <strong className="text-red-400">SANKSI KENA UMPAN AKTIF!</strong><br />
                {roomData?.players?.[roomData?.meta?.lastRoundResult?.penalizedPlayerId]?.name || 'Pengumpan'}{' '}
                terkena sanksi pemotongan instan -{roomData?.meta?.lastRoundResult?.bonus} Poin karena memberi kartu penutup!
              </div>
            )}

            {isHost && (
              <button
                onClick={handleStartGame}
                className="w-full rounded-xl bg-emerald-500 py-3 font-bold text-zinc-950 hover:bg-emerald-400 transition"
              >
                Mulai Ronde Berikutnya ➔
              </button>
            )}
          </div>
        )}

        {/* Area Tangan Pemain Lokal (Bagian Bawah) */}
        <div className="w-full max-w-5xl flex flex-col items-center pb-2 z-10">
          
          {/* Action Bar Pemain */}
          {roomData?.meta?.status === 'PLAYING' && (
            <div className="flex items-center gap-3 mb-3 bg-zinc-900/80 px-4 py-2 rounded-2xl border border-white/10 backdrop-blur">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                isMyTurn ? 'bg-emerald-500 text-zinc-950 animate-pulse' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {isMyTurn ? (hasDrawnThisTurn ? 'Pilih 1 Kartu untuk Buang/Tutup' : 'Giliran Anda: Ambil Kartu!') : 'Menunggu Giliran Lawan...'}
              </span>

              <button
                onClick={handleCheckMeld}
                disabled={selectedCardIds.length < 3}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs px-3 py-1.5 font-semibold text-zinc-200 border border-zinc-700"
              >
                🔍 Cek Seri / Kelompok
              </button>

              <button
                onClick={handleDiscard}
                disabled={!isMyTurn || !hasDrawnThisTurn || selectedCardIds.length !== 1}
                className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-xs px-4 py-1.5 font-bold text-white shadow"
              >
                🗑️ Buang Kartu
              </button>

              <button
                onClick={handleDeclareWin}
                disabled={!isMyTurn || selectedCardIds.length !== 1}
                className="rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-xs px-4 py-1.5 font-black text-zinc-950 shadow-lg shadow-amber-500/20"
              >
                🏆 TUTUP / RUMMY!
              </button>
            </div>
          )}

          {meldMessage && (
            <div className="text-xs bg-zinc-900 text-emerald-300 px-3 py-1 rounded-full mb-2 border border-emerald-500/30">
              {meldMessage}
            </div>
          )}

          {/* Kartu di Tangan */}
          <div className="flex items-center justify-center gap-2 flex-wrap px-4 min-h-[120px]">
            {myHand.map((card) => {
              const isSelected = selectedCardIds.includes(card.id);
              const isWild = card.rank === activeWildRank;
              const { symbol, color } = getSuitSymbol(card.suit);

              return (
                <div
                  key={card.id}
                  onClick={() => toggleSelectCard(card.id)}
                  className={`relative w-16 h-24 rounded-xl bg-white text-zinc-950 font-bold flex flex-col justify-between p-2 cursor-pointer transition-all duration-150 select-none ${
                    isSelected 
                      ? '-translate-y-4 ring-4 ring-amber-400 shadow-2xl scale-105' 
                      : 'hover:-translate-y-2 shadow-md'
                  } ${isWild ? 'border-2 border-amber-400 ring-1 ring-amber-300' : 'border border-zinc-300'}`}
                >
                  <span className="text-xs font-black self-start">{getRankLabel(card.rank)}</span>
                  <span className={`text-2xl self-center ${color}`}>{symbol}</span>
                  <span className="text-xs font-black self-end">{getRankLabel(card.rank)}</span>

                  {isWild && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-400 text-zinc-950 text-[8px] font-black px-1.5 py-0.2 rounded-full uppercase shadow">
                      SAKTI
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-[11px] text-zinc-500 mt-2 font-mono">
            {currentUser?.displayName} | Skor Meja: {roomData?.tableLeaderboard?.scores?.[currentUser?.uid || ''] || 0}
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
