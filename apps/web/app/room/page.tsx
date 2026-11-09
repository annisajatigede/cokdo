'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  updateProfile,
  User 
} from 'firebase/auth';
import { ref, update, onValue, push, get } from 'firebase/database';
import { auth, rtdb } from '@/lib/firebase';
import { 
  Card, 
  Suit, 
  dealGame, 
  validateMeldWithWildCard, 
  calculateClosingBonus 
} from '@cokdo/shared';

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

interface DiscardItem {
  card: Card;
  discardedBy: string;
  turnIndex: number;
  timestamp: number;
}

interface OpenMeld {
  type: string;
  cards: Card[];
  points: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

function RoomContent() {
  const searchParams = useSearchParams();
  const roomId = (searchParams.get('id') || searchParams.get('room') || 'COKDO1').toUpperCase();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [playerName, setPlayerName] = useState<string>('');
  const [showNameModal, setShowNameModal] = useState<boolean>(false);
  const [nameInput, setNameInput] = useState<string>('');

  const [roomData, setRoomData] = useState<any>(null);
  const [myHand, setMyHand] = useState<Card[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [meldMessage, setMeldMessage] = useState<string | null>(null);
  const [hasDrawnThisTurn, setHasDrawnThisTurn] = useState<boolean>(false);
  const [lastDrawnSource, setLastDrawnSource] = useState<'deck' | 'discard' | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Modal Klasemen Meja
  const [showLeaderboardModal, setShowLeaderboardModal] = useState<boolean>(false);

  // Modal Tarik Kartu Buangan
  const [pendingDiscardIndex, setPendingDiscardIndex] = useState<number | null>(null);

  // Chat States
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // 1. Auth Listener & Inisialisasi Meja
  useEffect(() => {
    const savedName = localStorage.getItem('cokdo_player_name');

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      let activeUser = user;
      if (!activeUser) {
        const credential = await signInAnonymously(auth);
        activeUser = credential.user;
      }

      const initialName = savedName || activeUser.displayName || `Pemain #${activeUser.uid.substring(0, 4).toUpperCase()}`;
      setPlayerName(initialName);
      setNameInput(initialName);
      
      if (!savedName) {
        setShowNameModal(true);
      }

      if (activeUser.displayName !== initialName) {
        await updateProfile(activeUser, { displayName: initialName });
      }

      setCurrentUser(activeUser);

      // Cek apakah metadata room sudah dibuat
      const roomMetaRef = ref(rtdb, `rooms/${roomId}/meta`);
      const roomMetaSnap = await get(roomMetaRef);
      if (!roomMetaSnap.exists()) {
        await update(roomMetaRef, {
          hostId: activeUser.uid,
          createdAt: Date.now(),
          status: 'WAITING',
          roundNumber: 1,
          turnTimeoutMs: 30000,
          isPrivate: true
        });
      }

      // Daftarkan pemain
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${activeUser.uid}`);
      await update(playerRef, {
        name: initialName,
        isGuest: activeUser.isAnonymous,
        connected: true,
        lastSeen: Date.now()
      });
    });

    return () => unsubscribe();
  }, [roomId]);

  // 2. Realtime Room State Listener
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

  // 3. Realtime Table Chat Listener
  useEffect(() => {
    if (!roomId) return;
    const chatRef = ref(rtdb, `rooms/${roomId}/chat`);
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: ChatMessage[] = Object.entries(data).map(([key, val]: [string, any]) => ({
          id: key,
          ...val
        })).sort((a, b) => a.timestamp - b.timestamp);

        setChatMessages(list);

        if (!chatOpen) {
          setUnreadChatCount(prev => prev + 1);
        }

        setTimeout(() => {
          chatScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    });

    return () => unsubscribe();
  }, [roomId, chatOpen]);

  const handleSaveName = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalName = nameInput.trim();
    if (!finalName || !currentUser) return;

    setPlayerName(finalName);
    localStorage.setItem('cokdo_player_name', finalName);
    await updateProfile(currentUser, { displayName: finalName });

    const playerRef = ref(rtdb, `rooms/${roomId}/players/${currentUser.uid}`);
    await update(playerRef, { name: finalName });

    setShowNameModal(false);
  };

  const handleSendChat = async (e?: React.FormEvent, quickText?: string) => {
    if (e) e.preventDefault();
    const textToSend = quickText || chatInput.trim();
    if (!textToSend || !currentUser) return;

    const chatRef = ref(rtdb, `rooms/${roomId}/chat`);
    await push(chatRef, {
      senderId: currentUser.uid,
      senderName: playerName || 'Pemain',
      text: textToSend,
      timestamp: Date.now()
    });

    if (!quickText) setChatInput('');
  };

  const playersList = roomData?.players ? Object.entries<any>(roomData.players) : [];
  const playerIds = playersList.map(([id]) => id);
  const currentTurnPlayerId = roomData?.game?.currentTurnPlayerId;
  const isMyTurn = currentUser && currentTurnPlayerId === currentUser.uid;
  const currentTurnPlayer = playersList.find(([id]) => id === currentTurnPlayerId)?.[1];
  const activeWildRank = roomData?.game?.activeWildRank || 2;
  const wildCard = roomData?.game?.wildIndicatorCard;
  const isGamePlaying = roomData?.meta?.status === 'PLAYING';

  // Jejeran buangan kartu lengkap (minimal 7 kartu terakhir tampak di meja)
  const discardPile: DiscardItem[] = roomData?.game?.discardHistory?.recentDiscards || [];
  const openMelds: Record<string, OpenMeld[]> = roomData?.game?.openMelds || {};

  // Pemegang skor tertinggi saat ini di meja (Pemenang sementara yang berisiko Kapeuncit)
  const scores = roomData?.tableLeaderboard?.scores || {};
  let currentTopPlayerId = playerIds[0];
  let currentTopScore = -Infinity;
  playerIds.forEach(id => {
    const sc = scores[id] ?? 0;
    if (sc > currentTopScore) {
      currentTopScore = sc;
      currentTopPlayerId = id;
    }
  });

  // Giliran Pertama: Ronde 1 = Host, Ronde > 1 = Skor Tertinggi
  const determineFirstPlayerId = () => {
    const roundNumber = roomData?.meta?.roundNumber || 1;
    if (roundNumber === 1 || !roomData?.tableLeaderboard?.scores) {
      return roomData?.meta?.hostId || playerIds[0];
    } else {
      return currentTopPlayerId || playerIds[0];
    }
  };

  // 4. Aksi: Mulai Permainan
  const handleStartGame = async () => {
    if (!playerIds.length) return;
    const deal = dealGame(playerIds);
    const starterId = determineFirstPlayerId();
    const starterName = roomData?.players?.[starterId]?.name || 'Pemain';

    const updates: Record<string, any> = {
      'meta/status': 'PLAYING',
      'game/activeWildRank': deal.activeWildRank,
      'game/wildIndicatorCard': deal.wildIndicatorCard,
      'game/drawDeck': deal.drawDeck,
      'game/drawDeckCount': deal.drawDeck.length,
      'game/hands': deal.playerHands,
      'game/openMelds': {},
      'game/currentTurnPlayerId': starterId,
      'game/turnDeadline': Date.now() + 30000,
      'game/discardHistory/recentDiscards': []
    };

    playerIds.forEach(id => {
      updates[`players/${id}/handCount`] = 7;
    });

    await update(ref(rtdb, `rooms/${roomId}`), updates);
    setHasDrawnThisTurn(false);
    setSelectedCardIds([]);
    setPendingDiscardIndex(null);

    handleSendChat(undefined, `🎮 Ronde Dimulai! Kartu Sakti: Rank ${getRankLabel(deal.activeWildRank)}. Giliran pertama: ${starterName}!`);
  };

  // 5. Aksi: Ambil Kartu dari Dek Tertutup
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

  // 6. Aksi: Tarik Kartu dari Jejeran Buangan (Deep Pick + Masuk Tangan)
  const handleExecutePickDiscard = async (discardIndex: number) => {
    if (!isMyTurn || hasDrawnThisTurn) return;
    const targetItem = discardPile[discardIndex];
    if (!targetItem) return;

    // Kartu-kartu di tangan yang dipilih untuk membentuk kombinasi bersama kartu buangan
    const selectedHandCards = myHand.filter(c => selectedCardIds.includes(c.id));
    const combinedCards = [...selectedHandCards, targetItem.card];

    // Validasi apakah kartu buangan + kartu di tangan membentuk SERI / KELOMPOK valid
    const meldValidation = validateMeldWithWildCard(combinedCards, activeWildRank);
    if (!meldValidation.isValid) {
      alert(
        `Kombinasi kartu [${getRankLabel(targetItem.card.rank)}] bersama kartu yang Anda pilih belum valid sebagai Seri/Kelompok! Pilih minimal 2 kartu lain di tangan Anda yang cocok.`
      );
      return;
    }

    // Kartu buangan setelah index ini (kartu sesudahnya) ikut masuk ke tangan!
    const subsequentCards = discardPile.slice(discardIndex + 1).map(item => item.card);

    // Kartu buangan yang tersisa di jejeran (sebelum index ini)
    const remainingDiscards = discardPile.slice(0, discardIndex);

    // Sisa kartu di tangan: kurangi kartu yang dipajang di kombinasi, lalu tambahkan kartu-kartu sesudahnya
    const remainingHandCards = myHand.filter(c => !selectedCardIds.includes(c.id));
    const finalHand = [...remainingHandCards, ...subsequentCards];

    // Simpan kombinasi terbuka di depan pemain
    const currentMelds: OpenMeld[] = openMelds[currentUser?.uid || ''] || [];
    const newMeld: OpenMeld = {
      type: meldValidation.type || 'SERI',
      cards: combinedCards,
      points: meldValidation.calculatedPoints
    };

    const updates: Record<string, any> = {
      'game/discardHistory/recentDiscards': remainingDiscards,
      [`game/hands/${currentUser?.uid}`]: finalHand,
      [`players/${currentUser?.uid}/handCount`]: finalHand.length,
      [`game/openMelds/${currentUser?.uid}`]: [...currentMelds, newMeld]
    };

    await update(ref(rtdb, `rooms/${roomId}`), updates);

    setHasDrawnThisTurn(true);
    setLastDrawnSource('discard');
    setSelectedCardIds([]);
    setPendingDiscardIndex(null);

    const extraCount = subsequentCards.length;
    handleSendChat(
      undefined, 
      `🂠 ${playerName} menarik kartu [${getRankLabel(targetItem.card.rank)}] untuk kombinasi ${meldValidation.type} di meja! ${extraCount > 0 ? `(${extraCount} kartu buangan sesudahnya ikut masuk ke tangan)` : ''}`
    );
  };

  // 7. Aksi: Buang 1 Kartu ke Jejeran Buangan
  const handleDiscard = async () => {
    if (!isMyTurn || !hasDrawnThisTurn || selectedCardIds.length !== 1) return;
    const discardCardId = selectedCardIds[0];
    const discardCard = myHand.find(c => c.id === discardCardId);
    if (!discardCard) return;

    const updatedHand = myHand.filter(c => c.id !== discardCardId);

    const currentIndex = playerIds.indexOf(currentUser?.uid || '');
    const nextPlayerId = playerIds[(currentIndex + 1) % playerIds.length];

    const discardEvent: DiscardItem = {
      card: discardCard,
      discardedBy: currentUser?.uid || '',
      turnIndex: discardPile.length + 1,
      timestamp: Date.now()
    };

    await update(ref(rtdb, `rooms/${roomId}`), {
      'game/discardHistory/recentDiscards': [...discardPile, discardEvent],
      [`game/hands/${currentUser?.uid}`]: updatedHand,
      [`players/${currentUser?.uid}/handCount`]: updatedHand.length,
      'game/currentTurnPlayerId': nextPlayerId,
      'game/turnDeadline': Date.now() + 30000,
    });

    setHasDrawnThisTurn(false);
    setSelectedCardIds([]);
    setLastDrawnSource(null);
  };

  // 8. AKSI: TUTUP / RUMMY DENGAN LOGIKA KAPEUNCIT PERSIS
  const handleDeclareWin = async () => {
    if (!isMyTurn || selectedCardIds.length !== 1) {
      alert('Pilih 1 kartu penutup untuk dibuang ke tombol TUTUP!');
      return;
    }

    const closingCardId = selectedCardIds[0];
    const closingCard = myHand.find(c => c.id === closingCardId);
    if (!closingCard) return;

    const winnerId = currentUser?.uid || '';
    const bonus = calculateClosingBonus(closingCard, activeWildRank);
    const updatedScores = { ...(roomData.tableLeaderboard?.scores || {}) };

    playerIds.forEach(id => {
      if (updatedScores[id] === undefined) updatedScores[id] = 0;
    });

    // Catat skor tertinggi sebelumnya & siapa pemegangnya
    let previousLeaderId: string | null = null;
    let previousLeaderScore = -Infinity;
    playerIds.forEach(id => {
      const s = updatedScores[id] || 0;
      if (s > previousLeaderScore) {
        previousLeaderScore = s;
        previousLeaderId = id;
      }
    });

    // Pemenang dapat bonus:
    updatedScores[winnerId] = (updatedScores[winnerId] || 0) + bonus;

    // Sanksi Kena Umpan: jika kartu penutup diambil dari jejeran buangan
    let penalizedPlayerId: string | null = null;
    if (lastDrawnSource === 'discard' && discardPile.length > 0) {
      const lastItem = discardPile[discardPile.length - 1];
      if (lastItem && lastItem.discardedBy !== winnerId) {
        penalizedPlayerId = lastItem.discardedBy;
        updatedScores[penalizedPlayerId] = (updatedScores[penalizedPlayerId] || 0) - bonus;
      }
    }

    // Pemain pasif
    playerIds.forEach(pid => {
      if (pid !== winnerId && pid !== penalizedPlayerId) {
        updatedScores[pid] = (updatedScores[pid] || 0) - 25;
      }
    });

    // LOGIKA KAPEUNCIT:
    // Cek apakah ada pemain baru yang melampaui previousLeaderScore!
    let kapeuncitPlayerId: string | null = null;
    let newLeaderId = winnerId;
    let newLeaderScore = -Infinity;

    playerIds.forEach(id => {
      const s = updatedScores[id];
      if (s > newLeaderScore) {
        newLeaderScore = s;
        newLeaderId = id;
      }
    });

    // Jika pemegang angka besar sebelumnya dilampaui pemain lain:
    // Nilainya langsung jadi 0 dan pendapatan saat putaran itu tidak dihitung (karena 0)!
    if (previousLeaderId && previousLeaderId !== newLeaderId && newLeaderScore > previousLeaderScore) {
      kapeuncitPlayerId = previousLeaderId;
      updatedScores[previousLeaderId] = 0; // HANGUS JADI 0!
    }

    const currentRound = roomData?.meta?.roundNumber || 1;
    const previousLeaderName = roomData?.players?.[kapeuncitPlayerId || '']?.name || 'Pemain';
    const newLeaderName = roomData?.players?.[newLeaderId]?.name || 'Pemain';

    await update(ref(rtdb, `rooms/${roomId}`), {
      'meta/status': 'ROUND_END',
      'meta/roundNumber': currentRound + 1,
      'tableLeaderboard/scores': updatedScores,
      'meta/lastRoundResult': {
        winnerId,
        winnerName: playerName,
        penalizedPlayerId,
        kapeuncitPlayerId,
        previousLeaderName: kapeuncitPlayerId ? previousLeaderName : null,
        newLeaderName,
        closingCard,
        bonus,
        wasFromDiscard: lastDrawnSource === 'discard'
      }
    });

    if (kapeuncitPlayerId) {
      handleSendChat(
        undefined, 
        `🚨 KAPEUNCIT! Skor ${previousLeaderName} tersusul oleh ${newLeaderName} (${newLeaderScore}) sehingga skornya di-reset menjadi 0! Putaran depan dimulai oleh ${newLeaderName}.`
      );
    } else {
      handleSendChat(
        undefined, 
        `🏆 ${playerName} TUTUP RUMMY! (+${bonus} Poin)`
      );
    }
  };

  const handleCheckMeld = () => {
    const selected = myHand.filter(c => selectedCardIds.includes(c.id));
    if (selected.length < 3) {
      setMeldMessage('Pilih minimal 3 kartu untuk Seri atau Kelompok.');
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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 text-white font-sans select-none">
      
      {/* Top Bar Header */}
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

        {/* Profil Nama, Klasemen Meja, & Aksi */}
        <div className="flex items-center gap-2.5">
          {/* Tombol Menu Klasemen Meja */}
          <button
            onClick={() => setShowLeaderboardModal(true)}
            className="flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow"
          >
            <span>🏆</span>
            <span>Klasemen Meja</span>
          </button>

          <button
            onClick={() => setShowNameModal(true)}
            className="flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
          >
            <span>👤</span>
            <span className="max-w-[110px] truncate">{playerName || 'Ganti Nama'}</span>
            <span className="text-zinc-500 text-[10px]">✏️</span>
          </button>

          <button
            onClick={copyInvite}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 active:scale-95 transition"
          >
            {copied ? '✓ Disalin!' : '📋 Link Meja'}
          </button>

          {/* Tombol Obrolan */}
          <button
            onClick={() => {
              setChatOpen(!chatOpen);
              setUnreadChatCount(0);
            }}
            className="relative rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-1.5 shadow"
          >
            <span>💬</span>
            <span>Obrolan</span>
            {unreadChatCount > 0 && !chatOpen && (
              <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-black animate-bounce">
                {unreadChatCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Arena Utama Permainan */}
      <div className="flex-1 relative flex overflow-hidden">
        
        {/* Kolom Meja Kartu */}
        <main className="flex-1 relative flex flex-col items-center justify-between p-3 bg-radial from-emerald-950/60 via-zinc-950 to-zinc-950 overflow-y-auto">
          
          {/* BANNER GILIRAN */}
          {isGamePlaying ? (
            <div className={`px-5 py-1.5 rounded-full border text-xs font-black tracking-wide flex items-center gap-2 shadow-xl backdrop-blur ${
              isMyTurn 
                ? 'bg-amber-400 text-zinc-950 border-amber-300 ring-4 ring-amber-400/30 animate-pulse' 
                : 'bg-zinc-900/90 text-zinc-200 border-zinc-700'
            }`}>
              <span>🔔</span>
              <span>
                {isMyTurn 
                  ? 'GILIRAN ANDA! (Ambil Dek / Tarik Kartu Buangan lalu Buang 1 Kartu)' 
                  : `Sedang Giliran: ${currentTurnPlayer?.name || 'Pemain Lawan'}`}
              </span>
            </div>
          ) : (
            <div className="px-4 py-1 rounded-full border border-zinc-800 bg-zinc-900/70 text-xs text-zinc-400">
              Meja Siap ({playersList.length} Pemain Bergabung)
            </div>
          )}

          {/* Kursi 3 Lawan & Kombinasi Terbuka di Meja Mereka */}
          <div className="w-full max-w-5xl flex items-start justify-around px-4">
            {playersList.filter(([id]) => id !== currentUser?.uid).map(([id, p]) => {
              const isHisTurn = currentTurnPlayerId === id;
              const sc = roomData?.tableLeaderboard?.scores?.[id] || 0;
              const playerMelds = openMelds[id] || [];

              return (
                <div key={id} className="flex flex-col items-center gap-1">
                  <div className={`flex flex-col items-center p-2.5 rounded-2xl border transition-all duration-200 ${
                    isHisTurn && isGamePlaying
                      ? 'bg-amber-500/25 border-amber-400 ring-4 ring-amber-400/40 scale-105 shadow-xl' 
                      : 'bg-zinc-900/60 border-zinc-800'
                  }`}>
                    <div className="w-9 h-9 rounded-full bg-emerald-600/30 border border-emerald-500/50 flex items-center justify-center font-bold text-sm text-emerald-300 shadow">
                      {p.name?.substring(0, 2).toUpperCase()}
                    </div>
                    <span className="text-xs font-bold mt-1 max-w-[90px] truncate text-white">{p.name}</span>
                    <span className="text-[10px] text-zinc-400 font-mono">
                      {isGamePlaying ? `🂠 ${p.handCount || 7} Kartu` : 'Siap'}
                    </span>
                    <span className={`text-[10px] font-black font-mono ${sc < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      Skor: {sc}
                    </span>
                  </div>

                  {/* Kombinasi Terbuka Lawan di Meja */}
                  {playerMelds.length > 0 && (
                    <div className="flex gap-1 bg-black/40 p-1 rounded-lg border border-white/5 max-w-[130px] overflow-x-auto">
                      {playerMelds.map((m, mIdx) => (
                        <div key={mIdx} className="flex -space-x-2">
                          {m.cards.map(c => (
                            <div key={c.id} className="w-5 h-7 bg-white rounded text-[8px] font-bold text-zinc-950 flex flex-col items-center justify-center border border-zinc-400">
                              <span>{getRankLabel(c.rank)}</span>
                              <span className={getSuitSymbol(c.suit).color}>{getSuitSymbol(c.suit).symbol}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* TENGAH MEJA: KARTU SAKTI & DEK AMBILAN */}
          <div className="flex items-center justify-center gap-6 p-4 rounded-2xl bg-emerald-950/40 border border-emerald-600/30 shadow-xl backdrop-blur-md my-1">
            
            {/* Kartu Sakti Terbuka */}
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1">
                ⭐ KARTU SAKTI ⭐
              </span>
              {wildCard ? (
                <div className="relative w-14 h-20 rounded-lg bg-white text-zinc-950 font-bold flex flex-col items-center justify-between p-1.5 border-2 border-amber-400 shadow-md">
                  <span className="text-xs font-black self-start">{getRankLabel(wildCard.rank)}</span>
                  <span className={`text-xl ${getSuitSymbol(wildCard.suit).color}`}>
                    {getSuitSymbol(wildCard.suit).symbol}
                  </span>
                  <span className="text-[8px] bg-amber-400 text-zinc-950 px-1 rounded font-black">
                    SEMUA {getRankLabel(wildCard.rank)}
                  </span>
                </div>
              ) : (
                <div className="w-14 h-20 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[10px] text-zinc-600">
                  Tertutup
                </div>
              )}
            </div>

            {/* Dek Ambil */}
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold text-zinc-400 mb-1">
                Dek ({roomData?.game?.drawDeckCount || 52})
              </span>
              <button
                onClick={handleDrawCard}
                disabled={!isMyTurn || hasDrawnThisTurn || !isGamePlaying}
                className={`w-14 h-20 rounded-lg border-2 flex flex-col items-center justify-center font-bold text-xs transition ${
                  isMyTurn && !hasDrawnThisTurn && isGamePlaying
                    ? 'bg-emerald-600 hover:bg-emerald-500 border-white text-white shadow-lg cursor-pointer active:scale-95'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed opacity-60'
                }`}
              >
                <span className="text-[10px]">AMBIL</span>
                <span className="text-base">🂠</span>
              </button>
            </div>
          </div>

          {/* JEJERAN KARTU BUANGAN (MINIMAL 7 KARTU TERAKHIR BERJEJER) */}
          <div className="w-full max-w-4xl flex flex-col items-center bg-black/40 border border-white/10 rounded-2xl p-3 my-1">
            <div className="flex items-center justify-between w-full px-2 mb-1.5">
              <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <span>🂠</span>
                <span>Jejeran Kartu Buangan ({discardPile.length})</span>
                <span className="text-[10px] text-zinc-500 font-normal">
                  (Klik salah satu kartu untuk ditarik membentuk Seri/Kelompok)
                </span>
              </span>
              <span className="text-[10px] text-amber-400 font-mono">
                {isMyTurn && !hasDrawnThisTurn ? '👉 Klik kartu untuk menariknya!' : ''}
              </span>
            </div>

            {/* Strip Horisontal Kartu Buangan Berjejer */}
            <div className="flex items-center gap-2 overflow-x-auto w-full py-1 px-1 scrollbar-thin">
              {discardPile.length === 0 ? (
                <div className="w-full text-center py-4 text-xs text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
                  Belum ada kartu buangan di meja.
                </div>
              ) : (
                discardPile.slice(-12).map((item, relIndex, arr) => {
                  const actualIndex = discardPile.length - arr.length + relIndex;
                  const isWild = item.card.rank === activeWildRank;
                  const { symbol, color } = getSuitSymbol(item.card.suit);
                  const isPending = pendingDiscardIndex === actualIndex;

                  return (
                    <div
                      key={`${item.card.id}-${actualIndex}`}
                      onClick={() => {
                        if (isMyTurn && !hasDrawnThisTurn) {
                          setPendingDiscardIndex(actualIndex);
                        }
                      }}
                      className={`relative flex-shrink-0 w-13 h-19 rounded-lg bg-white text-zinc-950 font-bold flex flex-col justify-between p-1.5 select-none transition-all ${
                        isMyTurn && !hasDrawnThisTurn 
                          ? 'cursor-pointer hover:-translate-y-2 hover:ring-2 hover:ring-emerald-400 shadow-md' 
                          : 'opacity-90'
                      } ${isPending ? '-translate-y-3 ring-4 ring-amber-400 shadow-2xl' : 'border border-zinc-300'}`}
                    >
                      <span className="text-[10px] font-black self-start">{getRankLabel(item.card.rank)}</span>
                      <span className={`text-lg self-center ${color}`}>{symbol}</span>
                      <span className="text-[8px] text-zinc-500 truncate w-full text-center">
                        {roomData?.players?.[item.discardedBy]?.name?.substring(0, 5) || 'Lawan'}
                      </span>

                      {isWild && (
                        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 bg-amber-400 text-zinc-950 text-[7px] font-black px-1 rounded-full uppercase">
                          SAKTI
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Bar Aksi Tarik Kartu Buangan Jika Ada yang Dipilih */}
            {pendingDiscardIndex !== null && discardPile[pendingDiscardIndex] && (
              <div className="mt-2.5 w-full bg-emerald-950/80 border border-emerald-500/50 rounded-xl p-2.5 flex items-center justify-between text-xs animate-in fade-in">
                <div className="flex items-center gap-2">
                  <span>Tarik kartu</span>
                  <span className="font-bold text-amber-400 font-mono">
                    [{getRankLabel(discardPile[pendingDiscardIndex].card.rank)}{getSuitSymbol(discardPile[pendingDiscardIndex].card.suit).symbol}]
                  </span>
                  <span className="text-zinc-300">
                    bersama {selectedCardIds.length} kartu pilihan di tangan untuk digelar di meja:
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExecutePickDiscard(pendingDiscardIndex)}
                    className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-3 py-1 font-black shadow"
                  >
                    ✓ Buka Kombinasi & Tarik Kartu
                  </button>
                  <button
                    onClick={() => setPendingDiscardIndex(null)}
                    className="rounded-lg bg-zinc-800 text-zinc-400 hover:text-white px-2 py-1"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* KOTAK STATUS & TOMBOL MULAI PERMAINAN */}
          {!isGamePlaying && roomData?.meta?.status !== 'ROUND_END' && (
            <div className="bg-zinc-900/95 border-2 border-emerald-500/40 rounded-2xl p-5 text-center max-w-md shadow-2xl backdrop-blur my-2">
              <h3 className="text-base font-black text-white mb-1">Ruang Tunggu Meja</h3>
              <p className="text-xs text-zinc-400 mb-3">
                {playersList.length < 2 
                  ? 'Ajak teman masuk meja (minimal 2 pemain, maksimal 4).' 
                  : `${playersList.length} pemain sudah kumpul di meja!`}
              </p>
              <button
                onClick={handleStartGame}
                disabled={playersList.length < 2}
                className="w-full rounded-xl bg-emerald-500 py-3 font-black text-zinc-950 hover:bg-emerald-400 active:scale-95 transition shadow-lg shadow-emerald-500/30 disabled:opacity-50"
              >
                🎮 Mulai Permainan Sekarang!
              </button>
            </div>
          )}

          {/* Modal Ronde Selesai & Pengumuman Kapeuncit */}
          {roomData?.meta?.status === 'ROUND_END' && (
            <div className="bg-zinc-900/95 border-2 border-amber-400 rounded-2xl p-5 text-center max-w-lg shadow-2xl backdrop-blur z-30 my-2">
              <h2 className="text-xl font-black text-amber-400 mb-1">🎉 RONDE SELESAI! 🎉</h2>
              <p className="text-xs text-zinc-200 font-semibold mb-2">
                Pemenang: <span className="text-emerald-400">{roomData?.meta?.lastRoundResult?.winnerName}</span> 
                {' '}(+{roomData?.meta?.lastRoundResult?.bonus} Poin)
              </p>
              
              {roomData?.meta?.lastRoundResult?.wasFromDiscard && (
                <div className="bg-red-950/60 border border-red-500/40 rounded-xl p-2 mb-2 text-xs text-red-200">
                  ⚠️ <strong className="text-red-400">SANKSI KENA UMPAN AKTIF!</strong><br />
                  {roomData?.players?.[roomData?.meta?.lastRoundResult?.penalizedPlayerId]?.name || 'Pengumpan'}{' '}
                  dipotong -{roomData?.meta?.lastRoundResult?.bonus} Poin karena memberi umpan kartu penutup!
                </div>
              )}

              {roomData?.meta?.lastRoundResult?.kapeuncitPlayerId && (
                <div className="bg-amber-950/70 border-2 border-amber-500/60 rounded-xl p-2.5 mb-2.5 text-xs text-amber-200">
                  🚨 <strong className="text-amber-400 font-black">KAPEUNCIT!</strong><br />
                  Skor <strong>{roomData?.meta?.lastRoundResult?.previousLeaderName}</strong> tersusul oleh <strong>{roomData?.meta?.lastRoundResult?.newLeaderName}</strong> sehingga skornya <strong>DI-RESET JADI 0!</strong><br />
                  <span className="text-[10px] text-emerald-300 mt-1 inline-block">
                    Putaran berikutnya otomatis dimulai oleh {roomData?.meta?.lastRoundResult?.newLeaderName}!
                  </span>
                </div>
              )}

              <button
                onClick={handleStartGame}
                className="w-full rounded-xl bg-emerald-500 py-2.5 font-black text-zinc-950 hover:bg-emerald-400 transition shadow-lg"
              >
                Mulai Ronde Berikutnya ➔
              </button>
            </div>
          )}

          {/* AREA KOMBINASI TERBUKA & KARTU TANGAN PEMAIN SENDIRI */}
          <div className="w-full max-w-5xl flex flex-col items-center z-10 pt-1">
            
            {/* Kombinasi yang Sudah Terbuka di Depan Pemain Sendiri */}
            {openMelds[currentUser?.uid || ''] && openMelds[currentUser?.uid || ''].length > 0 && (
              <div className="flex items-center gap-2 mb-2 bg-emerald-950/50 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                <span className="text-[10px] uppercase font-bold text-emerald-400">Kombinasi Terbuka Anda:</span>
                <div className="flex gap-2">
                  {openMelds[currentUser?.uid || ''].map((m, mIdx) => (
                    <div key={mIdx} className="flex -space-x-2">
                      {m.cards.map(c => (
                        <div key={c.id} className="w-7 h-10 bg-white rounded text-[10px] font-bold text-zinc-950 flex flex-col items-center justify-center border border-zinc-400 shadow">
                          <span>{getRankLabel(c.rank)}</span>
                          <span className={getSuitSymbol(c.suit).color}>{getSuitSymbol(c.suit).symbol}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Bar Pemain */}
            {isGamePlaying && (
              <div className="flex items-center gap-3 mb-2 bg-zinc-900/80 px-4 py-1.5 rounded-2xl border border-white/10 backdrop-blur">
                <button
                  onClick={handleCheckMeld}
                  disabled={selectedCardIds.length < 3}
                  className="rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs px-3 py-1 font-semibold text-zinc-200 border border-zinc-700"
                >
                  🔍 Cek Seri / Kelompok
                </button>

                <button
                  onClick={handleDiscard}
                  disabled={!isMyTurn || !hasDrawnThisTurn || selectedCardIds.length !== 1}
                  className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-xs px-4 py-1 font-bold text-white shadow"
                >
                  🗑️ Buang 1 Kartu
                </button>

                <button
                  onClick={handleDeclareWin}
                  disabled={!isMyTurn || selectedCardIds.length !== 1}
                  className="rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-xs px-4 py-1 font-black text-zinc-950 shadow-lg shadow-amber-500/20"
                >
                  🏆 TUTUP / RUMMY!
                </button>
              </div>
            )}

            {meldMessage && (
              <div className="text-xs bg-zinc-900 text-emerald-300 px-3 py-0.5 rounded-full mb-1 border border-emerald-500/30">
                {meldMessage}
              </div>
            )}

            {/* Kartu di Tangan (Bisa lebih atau kurang dari 7 kartu) */}
            <div className="flex items-center justify-center gap-1.5 flex-wrap px-4 min-h-[110px]">
              {myHand.map((card) => {
                const isSelected = selectedCardIds.includes(card.id);
                const isWild = card.rank === activeWildRank;
                const { symbol, color } = getSuitSymbol(card.suit);

                return (
                  <div
                    key={card.id}
                    onClick={() => toggleSelectCard(card.id)}
                    className={`relative w-15 h-22 rounded-xl bg-white text-zinc-950 font-bold flex flex-col justify-between p-2 cursor-pointer transition-all duration-150 select-none ${
                      isSelected 
                        ? '-translate-y-4 ring-4 ring-amber-400 shadow-2xl scale-105' 
                        : 'hover:-translate-y-2 shadow-md'
                    } ${isWild ? 'border-2 border-amber-400 ring-1 ring-amber-300' : 'border border-zinc-300'}`}
                  >
                    <span className="text-xs font-black self-start">{getRankLabel(card.rank)}</span>
                    <span className={`text-xl self-center ${color}`}>{symbol}</span>
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

            <div className="text-[11px] text-zinc-400 mt-1 font-mono flex items-center gap-2">
              <span className="font-bold text-white">{playerName}</span> ({myHand.length} kartu di tangan) | 
              <span>Skor Meja: </span>
              <strong className={
                (scores[currentUser?.uid || ''] || 0) < 0 
                  ? 'text-rose-400' 
                  : 'text-emerald-400'
              }>
                {scores[currentUser?.uid || ''] || 0}
              </strong>
            </div>
          </div>
        </main>

        {/* PANEL OBROLAN MEJA */}
        {chatOpen && (
          <aside className="w-80 h-full bg-zinc-900 border-l border-white/10 flex flex-col shadow-2xl z-30 animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/50">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">💬 Obrolan Meja</span>
                <span className="text-[10px] text-zinc-500 font-mono">({chatMessages.length})</span>
              </div>
              <button 
                onClick={() => setChatOpen(false)}
                className="text-zinc-400 hover:text-white text-xs px-2 py-1 rounded bg-zinc-800"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {chatMessages.length === 0 ? (
                <div className="text-center text-xs text-zinc-600 mt-8">
                  Belum ada pesan. Sapa pemain lain di meja!
                </div>
              ) : (
                chatMessages.map((msg) => {
                  const isMe = msg.senderId === currentUser?.uid;
                  return (
                    <div 
                      key={msg.id} 
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <span className="text-[10px] text-zinc-400 mb-0.5 px-1 font-semibold">
                        {isMe ? 'Anda' : msg.senderName}
                      </span>
                      <div className={`rounded-xl px-3 py-1.5 text-xs max-w-[85%] break-words ${
                        isMe 
                          ? 'bg-emerald-600 text-white rounded-tr-none' 
                          : 'bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-tl-none'
                      }`}>
                        {msg.text}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatScrollRef} />
            </div>

            <div className="px-3 py-2 border-t border-zinc-800 flex gap-1.5 overflow-x-auto">
              {['Halo!', 'Awas Umpan! 😂', 'Sakti nih! ⭐', 'Kapeuncit lu! 🤣', 'GG!'].map((q) => (
                <button
                  key={q}
                  onClick={() => handleSendChat(undefined, q)}
                  className="whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
                >
                  {q}
                </button>
              ))}
            </div>

            <form onSubmit={handleSendChat} className="p-3 border-t border-zinc-800 flex gap-2">
              <input
                type="text"
                placeholder="Ketik pesan..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-emerald-400 transition"
              >
                Kirim
              </button>
            </form>
          </aside>
        )}

      </div>

      {/* MODAL KLASEMEN MEJA */}
      {showLeaderboardModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏆</span>
                <h3 className="text-base font-black text-white">Klasemen Meja Permainan</h3>
              </div>
              <button
                onClick={() => setShowLeaderboardModal(false)}
                className="text-zinc-400 hover:text-white text-xs px-2.5 py-1 rounded bg-zinc-800"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400 mb-4">
              Peringkat skor terkini 4 pemain di meja ini (Ronde {roomData?.meta?.roundNumber || 1}):
            </p>

            <div className="space-y-2 mb-6">
              {[...playersList]
                .sort((a, b) => (scores[b[0]] || 0) - (scores[a[0]] || 0))
                .map(([pid, p], index) => {
                  const sc = scores[pid] || 0;
                  const isTop = index === 0;
                  return (
                    <div 
                      key={pid} 
                      className={`flex items-center justify-between p-3 rounded-xl border ${
                        isTop 
                          ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30' 
                          : 'bg-zinc-950 border-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-6 text-center font-black font-mono text-sm ${
                          index === 0 ? 'text-amber-400' : index === 1 ? 'text-zinc-300' : 'text-zinc-500'
                        }`}>
                          {index === 0 ? '👑' : `#${index + 1}`}
                        </span>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>{p.name}</span>
                            {pid === currentUser?.uid && (
                              <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded">Anda</span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono">
                            {p.isGuest ? 'Akun Tamu' : 'Pemain Resmi'}
                          </div>
                        </div>
                      </div>

                      <div className={`font-mono font-black text-sm ${
                        sc < 0 ? 'text-rose-400' : sc === 0 ? 'text-zinc-400' : 'text-emerald-400'
                      }`}>
                        {sc > 0 ? `+${sc}` : sc} Poin
                      </div>
                    </div>
                  );
                })}
            </div>

            <button
              onClick={() => setShowLeaderboardModal(false)}
              className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-2.5 text-xs font-bold transition"
            >
              Tutup Klasemen
            </button>
          </div>
        </div>
      )}

      {/* MODAL GANTI NAMA PEMAIN */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1">Nama Pemain Anda</h3>
            <p className="text-xs text-zinc-400 mb-4">
              Nama ini akan terlihat oleh semua pemain di meja kartu.
            </p>

            <form onSubmit={handleSaveName} className="space-y-4">
              <input
                type="text"
                maxLength={15}
                placeholder="Contoh: Budi, Siti, Joni"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoFocus
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
              />

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400 transition"
                >
                  Simpan Nama
                </button>
                {playerName && (
                  <button
                    type="button"
                    onClick={() => setShowNameModal(false)}
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-xs font-semibold text-zinc-400 hover:text-white"
                  >
                    Batal
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

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
