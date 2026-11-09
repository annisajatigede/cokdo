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

  // Chat States
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // 1. Auth Listener & Inisialisasi Meja & Host
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

      // Cek apakah meja sudah ada metadatanya. Jika belum, jadikan pemain pertama sebagai Host.
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

      // Daftarkan pemain ke meja
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
  const isHost = currentUser && (roomData?.meta?.hostId === currentUser.uid || playerIds[0] === currentUser.uid);
  const currentTurnPlayerId = roomData?.game?.currentTurnPlayerId;
  const isMyTurn = currentUser && currentTurnPlayerId === currentUser.uid;
  const currentTurnPlayer = playersList.find(([id]) => id === currentTurnPlayerId)?.[1];
  const activeWildRank = roomData?.game?.activeWildRank || 2;
  const wildCard = roomData?.game?.wildIndicatorCard;
  const lastDiscard = roomData?.game?.discardHistory?.lastDiscard;
  const isGamePlaying = roomData?.meta?.status === 'PLAYING';

  // ATURAN GILIRAN PERTAMA (RONDE 1 = HOST, RONDE SELANJUTNYA = SKOR TERTINGGI)
  const determineFirstPlayerId = () => {
    const roundNumber = roomData?.meta?.roundNumber || 1;
    if (roundNumber === 1 || !roomData?.tableLeaderboard?.scores) {
      // Ronde 1: Pembuat meja (Host) mulai pertama
      return roomData?.meta?.hostId || playerIds[0];
    } else {
      // Ronde > 1: Pemain dengan skor tertinggi yang mulai pertama!
      const scores = roomData.tableLeaderboard.scores;
      let highestScore = -Infinity;
      let highestPlayerId = playerIds[0];

      playerIds.forEach((id) => {
        const sc = scores[id] ?? 0;
        if (sc > highestScore) {
          highestScore = sc;
          highestPlayerId = id;
        }
      });
      return highestPlayerId;
    }
  };

  // Aksi: Mulai Permainan (Ronde Baru)
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
      'game/currentTurnPlayerId': starterId,
      'game/turnDeadline': Date.now() + 30000,
      'game/discardHistory/lastDiscard': null,
      'game/discardHistory/recentDiscards': []
    };

    playerIds.forEach(id => {
      updates[`players/${id}/handCount`] = 7;
    });

    await update(ref(rtdb, `rooms/${roomId}`), updates);
    setHasDrawnThisTurn(false);
    setSelectedCardIds([]);

    handleSendChat(undefined, `🎮 Ronde Dimulai! Kartu Sakti: Rank ${getRankLabel(deal.activeWildRank)}. Giliran pertama: ${starterName}!`);
  };

  // Aksi: Ambil Kartu Dek
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

  // Aksi: Ambil Kartu Buangan
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

  // Aksi: Buang Kartu
  const handleDiscard = async () => {
    if (!isMyTurn || !hasDrawnThisTurn || selectedCardIds.length !== 1) return;
    const discardCardId = selectedCardIds[0];
    const discardCard = myHand.find(c => c.id === discardCardId);
    if (!discardCard) return;

    const updatedHand = myHand.filter(c => c.id !== discardCardId);

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

  // AKSI: TUTUP / RUMMY & LOGIKA SANKSI UMPAN + KAPEUNCIT
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
    const scores = { ...(roomData.tableLeaderboard?.scores || {}) };

    playerIds.forEach(id => {
      if (scores[id] === undefined) scores[id] = 0;
    });

    // 1. Catat siapa pemegang skor tertinggi sebelum ronde ini selesai
    let previousLeaderId: string | null = null;
    let previousLeaderScore = -Infinity;
    playerIds.forEach(id => {
      const s = scores[id] || 0;
      if (s > previousLeaderScore) {
        previousLeaderScore = s;
        previousLeaderId = id;
      }
    });

    // 2. Tambah skor pemenang
    scores[winnerId] = (scores[winnerId] || 0) + bonus;

    // 3. Sanksi Umpan / Tembak
    let penalizedPlayerId: string | null = null;
    if (lastDrawnSource === 'discard' && lastDiscard) {
      const feederId = lastDiscard.discardedBy;
      if (feederId && feederId !== winnerId) {
        penalizedPlayerId = feederId;
        scores[feederId] = (scores[feederId] || 0) - bonus;
      }
    }

    // Pemain pasif
    playerIds.forEach(pid => {
      if (pid !== winnerId && pid !== penalizedPlayerId) {
        scores[pid] = (scores[pid] || 0) - 25;
      }
    });

    // 4. LOGIKA KAPEUNCIT:
    // Cek apakah ada pemain baru yang melampaui rekor skor tertinggi sebelumnya!
    let kapeuncitPlayerId: string | null = null;
    let newLeaderId = winnerId;
    let newLeaderScore = -Infinity;

    playerIds.forEach(id => {
      const s = scores[id];
      if (s > newLeaderScore) {
        newLeaderScore = s;
        newLeaderId = id;
      }
    });

    // Jika pemegang rekor sebelumnya disusul/dilampaui oleh pemain lain:
    if (previousLeaderId && previousLeaderId !== newLeaderId && newLeaderScore > previousLeaderScore) {
      kapeuncitPlayerId = previousLeaderId;
      scores[previousLeaderId] = 0; // HANGUS / RESET KE 0!
    }

    const currentRound = roomData?.meta?.roundNumber || 1;
    const previousLeaderName = roomData?.players?.[kapeuncitPlayerId || '']?.name || 'Pemain';
    const newLeaderName = roomData?.players?.[newLeaderId]?.name || 'Pemain';

    await update(ref(rtdb, `rooms/${roomId}`), {
      'meta/status': 'ROUND_END',
      'meta/roundNumber': currentRound + 1,
      'tableLeaderboard/scores': scores,
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

    // Siarkan kabar ke obrolan
    if (kapeuncitPlayerId) {
      handleSendChat(
        undefined, 
        `🚨 KAPEUNCIT! Skor ${previousLeaderName} tersusul oleh ${newLeaderName} (${newLeaderScore}) sehingga di-reset kembali ke 0! Giliran ronde depan diambil oleh ${newLeaderName}.`
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

        {/* Profil Nama & Aksi */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowNameModal(true)}
            className="flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
          >
            <span>👤</span>
            <span className="max-w-[120px] truncate">{playerName || 'Ganti Nama'}</span>
            <span className="text-zinc-500 text-[10px]">✏️</span>
          </button>

          <button
            onClick={copyInvite}
            className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 active:scale-95 transition"
          >
            {copied ? '✓ Disalin!' : '📋 Link Meja'}
          </button>

          {/* Tombol Buka Chat Meja */}
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
        <main className="flex-1 relative flex flex-col items-center justify-between p-4 bg-radial from-emerald-950/60 via-zinc-950 to-zinc-950">
          
          {/* BANNER GILIRAN JELAS */}
          {isGamePlaying ? (
            <div className={`px-5 py-2 rounded-full border text-sm font-black tracking-wide flex items-center gap-2 shadow-xl backdrop-blur ${
              isMyTurn 
                ? 'bg-amber-400 text-zinc-950 border-amber-300 ring-4 ring-amber-400/30 animate-pulse' 
                : 'bg-zinc-900/90 text-zinc-200 border-zinc-700'
            }`}>
              <span>🔔</span>
              <span>
                {isMyTurn 
                  ? 'GILIRAN ANDA! (Ambil lalu Buang 1 Kartu)' 
                  : `Sedang Giliran: ${currentTurnPlayer?.name || 'Pemain Lawan'}`}
              </span>
            </div>
          ) : (
            <div className="px-5 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/70 text-xs text-zinc-400">
              Meja Siap ({playersList.length} Pemain Bergabung)
            </div>
          )}

          {/* Kursi Lawan (Top Row) */}
          <div className="w-full max-w-4xl flex items-center justify-around px-4 pt-1">
            {playersList.filter(([id]) => id !== currentUser?.uid).map(([id, p]) => {
              const isHisTurn = currentTurnPlayerId === id;
              const sc = roomData?.tableLeaderboard?.scores?.[id] || 0;
              return (
                <div 
                  key={id} 
                  className={`flex flex-col items-center p-3 rounded-2xl border transition-all duration-200 ${
                    isHisTurn && isGamePlaying
                      ? 'bg-amber-500/25 border-amber-400 ring-4 ring-amber-400/40 scale-105 shadow-xl' 
                      : 'bg-zinc-900/60 border-zinc-800'
                  }`}
                >
                  <div className="w-11 h-11 rounded-full bg-emerald-600/30 border border-emerald-500/50 flex items-center justify-center font-bold text-base text-emerald-300 shadow">
                    {p.name?.substring(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs font-bold mt-1 max-w-[100px] truncate text-white">
                    {p.name}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {isGamePlaying ? `🂠 ${p.handCount || 7} Kartu` : 'Siap'}
                  </span>
                  <span className={`text-[10px] font-black font-mono ${
                    sc < 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}>
                    Skor: {sc}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Tengah Meja: Kartu Sakti & Tumpukan Kartu */}
          <div className="relative flex items-center justify-center gap-8 p-6 rounded-3xl bg-emerald-950/40 border-2 border-emerald-600/30 shadow-2xl backdrop-blur-md">
            
            {/* Kartu Sakti Terbuka */}
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1">
                ⭐ KARTU SAKTI ⭐
              </span>
              {wildCard ? (
                <div className="relative w-18 h-26 rounded-xl bg-white text-zinc-950 font-bold flex flex-col items-center justify-between p-2 border-3 border-amber-400 shadow-xl shadow-amber-500/20">
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

            {/* Dek Ambil */}
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-semibold text-zinc-400 mb-1">
                Dek ({roomData?.game?.drawDeckCount || 52})
              </span>
              <button
                onClick={handleDrawCard}
                disabled={!isMyTurn || hasDrawnThisTurn || !isGamePlaying}
                className={`w-18 h-26 rounded-xl border-2 flex flex-col items-center justify-center font-bold text-xs transition ${
                  isMyTurn && !hasDrawnThisTurn && isGamePlaying
                    ? 'bg-emerald-600 hover:bg-emerald-500 border-white text-white shadow-lg shadow-emerald-500/40 cursor-pointer active:scale-95'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed opacity-60'
                }`}
              >
                <span>AMBIL</span>
                <span className="text-lg">🂠</span>
              </button>
            </div>

            {/* Buangan Terakhir */}
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
                    dari {roomData?.players?.[lastDiscard.discardedBy]?.name?.substring(0, 8) || 'Lawan'}
                  </span>
                </div>
              ) : (
                <div className="w-18 h-26 rounded-xl bg-zinc-900 border border-dashed border-zinc-700 flex items-center justify-center text-[10px] text-zinc-500">
                  Kosong
                </div>
              )}
            </div>
          </div>

          {/* KOTAK STATUS & TOMBOL MULAI PERMAINAN (SELALU MUNCUL SAAT PERMAINAN BELUM BERJALAN) */}
          {!isGamePlaying && roomData?.meta?.status !== 'ROUND_END' && (
            <div className="bg-zinc-900/95 border-2 border-emerald-500/40 rounded-2xl p-6 text-center max-w-md shadow-2xl backdrop-blur">
              <h3 className="text-lg font-black text-white mb-1">Ruang Tunggu Meja</h3>
              <p className="text-xs text-zinc-400 mb-4">
                {playersList.length < 2 
                  ? 'Ajak teman masuk meja (minimal 2 pemain, maksimal 4).' 
                  : `${playersList.length} pemain sudah kumpul di meja!`}
              </p>

              {/* Siapapun atau Host bisa klik mulai jika pemain >= 2 */}
              <button
                onClick={handleStartGame}
                disabled={playersList.length < 2}
                className="w-full rounded-xl bg-emerald-500 py-3.5 font-black text-zinc-950 hover:bg-emerald-400 active:scale-95 transition shadow-lg shadow-emerald-500/30 disabled:opacity-50"
              >
                🎮 Mulai Permainan Sekarang!
              </button>
            </div>
          )}

          {/* Modal Ronde Selesai & Pengumuman Kapeuncit */}
          {roomData?.meta?.status === 'ROUND_END' && (
            <div className="bg-zinc-900/95 border-2 border-amber-400 rounded-2xl p-6 text-center max-w-lg shadow-2xl backdrop-blur z-30">
              <h2 className="text-2xl font-black text-amber-400 mb-1">🎉 RONDE SELESAI! 🎉</h2>
              <p className="text-sm text-zinc-200 font-semibold mb-2">
                Pemenang: <span className="text-emerald-400">{roomData?.meta?.lastRoundResult?.winnerName}</span> 
                {' '}(+{roomData?.meta?.lastRoundResult?.bonus} Poin)
              </p>
              
              {/* Notifikasi Kena Umpan */}
              {roomData?.meta?.lastRoundResult?.wasFromDiscard && (
                <div className="bg-red-950/60 border border-red-500/40 rounded-xl p-2.5 mb-3 text-xs text-red-200">
                  ⚠️ <strong className="text-red-400">SANKSI KENA UMPAN AKTIF!</strong><br />
                  {roomData?.players?.[roomData?.meta?.lastRoundResult?.penalizedPlayerId]?.name || 'Pengumpan'}{' '}
                  dipotong -{roomData?.meta?.lastRoundResult?.bonus} Poin karena memberi umpan kartu penutup!
                </div>
              )}

              {/* NOTIFIKASI KAPEUNCIT */}
              {roomData?.meta?.lastRoundResult?.kapeuncitPlayerId && (
                <div className="bg-amber-950/70 border-2 border-amber-500/60 rounded-xl p-3 mb-3 text-xs text-amber-200">
                  🚨 <strong className="text-amber-400 font-black">KAPEUNCIT!</strong><br />
                  Skor <strong>{roomData?.meta?.lastRoundResult?.previousLeaderName}</strong> tersusul oleh <strong>{roomData?.meta?.lastRoundResult?.newLeaderName}</strong> sehingga skornya <strong>DI-RESET KEMBALI KE 0!</strong><br />
                  <span className="text-[11px] text-emerald-300 mt-1 inline-block">
                    Giliran pertama ronde berikutnya diserahkan kepada {roomData?.meta?.lastRoundResult?.newLeaderName}!
                  </span>
                </div>
              )}

              <button
                onClick={handleStartGame}
                className="w-full rounded-xl bg-emerald-500 py-3 font-black text-zinc-950 hover:bg-emerald-400 transition shadow-lg"
              >
                Mulai Ronde Berikutnya ➔
              </button>
            </div>
          )}

          {/* Area Kartu Pemain Sendiri */}
          <div className="w-full max-w-5xl flex flex-col items-center pb-2 z-10">
            {isGamePlaying && (
              <div className="flex items-center gap-3 mb-3 bg-zinc-900/80 px-4 py-2 rounded-2xl border border-white/10 backdrop-blur">
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

            <div className="text-[11px] text-zinc-400 mt-2 font-mono flex items-center gap-2">
              <span className="font-bold text-white">{playerName}</span> | 
              <span>Skor Meja: </span>
              <strong className={
                (roomData?.tableLeaderboard?.scores?.[currentUser?.uid || ''] || 0) < 0 
                  ? 'text-rose-400' 
                  : 'text-emerald-400'
              }>
                {roomData?.tableLeaderboard?.scores?.[currentUser?.uid || ''] || 0}
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
              {['Halo!', 'Awas Umpan! 😂', 'Sakti nih! ⭐', 'GG!'].map((q) => (
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
