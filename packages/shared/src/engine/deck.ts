import { Card, Suit } from '../types/card';

const SUITS: Suit[] = ['HEARTS', 'DIAMONDS', 'CLUBS', 'SPADES'];

export function createStandardDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      const suitPrefix = suit[0];
      deck.push({
        id: `${suitPrefix}-${rank}`,
        suit,
        rank,
      });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface DealResult {
  playerHands: Record<string, Card[]>;
  wildIndicatorCard: Card;
  activeWildRank: number;
  drawDeck: Card[];
  firstPlayerId: string;
}

export function dealGame(playerIds: string[]): DealResult {
  const deck = shuffleDeck(createStandardDeck());
  const playerHands: Record<string, Card[]> = {};

  playerIds.forEach(id => {
    playerHands[id] = [];
  });

  // Deal 7 kartu per pemain
  for (let round = 0; round < 7; round++) {
    for (const id of playerIds) {
      const card = deck.pop();
      if (card) playerHands[id].push(card);
    }
  }

  // Buka 1 kartu penentu Kartu Sakti (Wild Card)
  const wildIndicatorCard = deck.pop() || { id: 'H-2', suit: 'HEARTS' as Suit, rank: 2 };
  const activeWildRank = wildIndicatorCard.rank;

  return {
    playerHands,
    wildIndicatorCard,
    activeWildRank,
    drawDeck: deck,
    firstPlayerId: playerIds[0],
  };
}
