import { Card } from '../types/card';

export function getBaseCardValue(card: Card, activeWildRank: number): number {
  if (card.rank === activeWildRank) return 20; // Nilai kartu sakti tersendiri
  if (card.rank === 1) return 15;              // As bernilai 15 poin
  if (card.rank >= 10) return 10;             // 10, J, Q, K bernilai 10 poin
  return card.rank;                           // 2 - 9 sesuai angka
}

export function calculateClosingBonus(closingCard: Card, activeWildRank: number): number {
  if (closingCard.rank === activeWildRank) {
    return 500; // Jackpot Tutup dengan Single Wild Card
  }
  if (closingCard.rank === 1) {
    return 150; // Tutup dengan As
  }
  if (closingCard.rank >= 11 && closingCard.rank <= 13) {
    return 100; // Tutup dengan J, Q, K
  }
  return closingCard.rank; // Tutup dengan kartu angka 2-10
}
