export type Suit = 'HEARTS' | 'DIAMONDS' | 'CLUBS' | 'SPADES';

export interface Card {
  id: string;      // Contoh: "H-2", "C-11", "S-1"
  suit: Suit;
  rank: number;    // 1 (Ace) - 13 (King)
}

export interface MeldResult {
  isValid: boolean;
  type?: 'SET' | 'RUN';
  calculatedPoints: number;
  representedCards?: Card[];
}
