import { Card } from './card';

export interface DiscardEvent {
  card: Card;
  discardedBy: string; // playerId
  turnIndex: number;
  timestamp: number;
}

export interface PlayerState {
  seatIndex: number;
  name: string;
  isGuest: boolean;
  handCount: number;
  isReady: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface RoundLog {
  round: number;
  winnerId: string;
  penalizedPlayerId: string | null;
  closingCard: Card;
  pointsDelta: Record<string, number>;
  timestamp: number;
}

export interface RoomState {
  meta: {
    hostId: string;
    createdAt: number;
    status: 'WAITING' | 'PLAYING' | 'ROUND_END' | 'CLOSED';
    roundNumber: number;
    turnTimeoutMs: number;
    isPrivate: boolean;
  };
  game: {
    activeWildRank: number;
    wildIndicatorCard: Card;
    currentTurnPlayerId: string;
    turnDeadline: number;
    drawDeckCount: number;
    discardHistory: {
      lastDiscard: DiscardEvent | null;
      recentDiscards: DiscardEvent[];
    };
  };
  players: Record<string, PlayerState>;
  tableLeaderboard: {
    scores: Record<string, number>;
    roundLogs: RoundLog[];
  };
}
