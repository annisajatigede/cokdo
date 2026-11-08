import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Card, calculateClosingBonus } from '@cokdo/shared';

const rtdb = admin.database();
const firestore = admin.firestore();

interface DeclareWinPayload {
  roomId: string;
  winnerId: string;
  closingCard: Card;
  isFromDiscard: boolean;
}

export const calculateRoundScores = functions.https.onCall(
  async (data: DeclareWinPayload, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Akses ditolak. Pengguna harus login atau berstatus Guest valid.');
    }

    const { roomId, winnerId, closingCard, isFromDiscard } = data;
    const roomRef = rtdb.ref(`rooms/${roomId}`);

    return roomRef.transaction((room) => {
      if (!room || room.meta.status !== 'PLAYING') {
        return room;
      }

      const activeWildRank = room.game.activeWildRank;
      const discardHistory = room.game.discardHistory;

      // Hitung bonus kartu penutup
      const winnerBonus = calculateClosingBonus(closingCard, activeWildRank);

      const pointsDelta: Record<string, number> = {};
      const currentScores = room.tableLeaderboard.scores || {};
      let penalizedPlayerId: string | null = null;

      // Logika Sanksi Umpan / Tembak
      if (isFromDiscard && discardHistory?.lastDiscard) {
        const feederId = discardHistory.lastDiscard.discardedBy;
        if (feederId && feederId !== winnerId) {
          penalizedPlayerId = feederId;
          pointsDelta[feederId] = -winnerBonus;
        }
      }

      pointsDelta[winnerId] = winnerBonus;

      // Pemain pasif (tidak tutup & bukan pengumpan)
      Object.keys(room.players).forEach((playerId) => {
        if (playerId !== winnerId && playerId !== penalizedPlayerId) {
          pointsDelta[playerId] = -25;
        }
        currentScores[playerId] = (currentScores[playerId] || 0) + (pointsDelta[playerId] || 0);
      });

      room.tableLeaderboard.scores = currentScores;
      room.meta.status = 'ROUND_END';

      if (!room.tableLeaderboard.roundLogs) room.tableLeaderboard.roundLogs = [];
      room.tableLeaderboard.roundLogs.push({
        round: room.meta.roundNumber,
        winnerId,
        penalizedPlayerId,
        closingCard,
        pointsDelta,
        timestamp: Date.now()
      });

      return room;
    }).then(async (result) => {
      if (!result.committed) {
        throw new functions.https.HttpsError('aborted', 'Transaksi kalkulasi skor gagal dieksekusi.');
      }

      const roomSnapshot = result.snapshot.val();
      const players = roomSnapshot.players;

      // Sinkronisasi akumulasi ke Firestore hanya untuk registered users (bukan Guest)
      const batch = firestore.batch();
      for (const [uid, player] of Object.entries<any>(players)) {
        if (!player.isGuest) {
          const userRef = firestore.collection('users').doc(uid);
          const scoreInc = roomSnapshot.tableLeaderboard.scores[uid] || 0;
          batch.set(userRef, {
            lifetimeScore: admin.firestore.FieldValue.increment(scoreInc),
            lastActive: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
      await batch.commit();

      return { success: true, scores: roomSnapshot.tableLeaderboard.scores };
    });
  }
);
