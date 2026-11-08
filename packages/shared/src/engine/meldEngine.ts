import { Card, MeldResult } from '../types/card';

/**
 * Validasi Kelompok (Set): 3-4 kartu berangka sama dengan daun berbeda.
 * Kartu Sakti otomatis menyamar menjadi angka kelompok.
 */
export function validateSet(cards: Card[], activeWildRank: number): MeldResult {
  if (cards.length < 3 || cards.length > 4) return { isValid: false, calculatedPoints: 0 };

  const naturals = cards.filter(c => c.rank !== activeWildRank);
  const wildCount = cards.length - naturals.length;

  if (naturals.length === 0) {
    const point = activeWildRank === 1 ? 15 : (activeWildRank >= 10 ? 10 : activeWildRank);
    return { isValid: true, type: 'SET', calculatedPoints: point * cards.length };
  }

  const targetRank = naturals[0].rank;
  const sameRank = naturals.every(c => c.rank === targetRank);
  
  const uniqueSuits = new Set(naturals.map(c => c.suit));
  const noDuplicateSuit = uniqueSuits.size === naturals.length;

  if (sameRank && noDuplicateSuit) {
    const singleCardValue = targetRank === 1 ? 15 : (targetRank >= 10 ? 10 : targetRank);
    return {
      isValid: true,
      type: 'SET',
      calculatedPoints: singleCardValue * cards.length
    };
  }

  return { isValid: false, calculatedPoints: 0 };
}

/**
 * Validasi Seri (Run): Minimal 3 kartu berurutan pada daun yang sama.
 * Smart Fit: Kartu Sakti diposisikan ke rank yang menghasilkan poin tertinggi.
 */
export function validateRun(cards: Card[], activeWildRank: number): MeldResult {
  if (cards.length < 3) return { isValid: false, calculatedPoints: 0 };

  const naturals = cards.filter(c => c.rank !== activeWildRank);
  const wildCount = cards.length - naturals.length;

  if (naturals.length === 0) {
    return { isValid: false, calculatedPoints: 0 };
  }

  const targetSuit = naturals[0].suit;
  if (!naturals.every(c => c.suit === targetSuit)) {
    return { isValid: false, calculatedPoints: 0 };
  }

  const sorted = [...naturals].sort((a, b) => a.rank - b.rank);

  let neededWilds = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const diff = sorted[i + 1].rank - sorted[i].rank;
    if (diff === 0) return { isValid: false, calculatedPoints: 0 };
    neededWilds += (diff - 1);
  }

  if (neededWilds > wildCount) return { isValid: false, calculatedPoints: 0 };

  const unusedWilds = wildCount - neededWilds;
  let simulatedMin = sorted[0].rank;
  let simulatedMax = sorted[sorted.length - 1].rank;
  let remaining = unusedWilds;

  // Smart Fit: Pasang sisa Wild Card ke arah angka tinggi (J, Q, K) terlebih dahulu untuk memaksimalkan skor
  while (remaining > 0) {
    if (simulatedMax < 13) {
      simulatedMax++;
    } else if (simulatedMin > 1) {
      simulatedMin--;
    } else {
      break;
    }
    remaining--;
  }

  let totalScore = 0;
  for (let r = simulatedMin; r <= simulatedMax; r++) {
    if (r === 1) totalScore += 15;
    else if (r >= 10) totalScore += 10;
    else totalScore += r;
  }

  return {
    isValid: true,
    type: 'RUN',
    calculatedPoints: totalScore
  };
}

/**
 * Validasi umum kombinasi kartu sakti (Set atau Run)
 */
export function validateMeldWithWildCard(cards: Card[], activeWildRank: number): MeldResult {
  const setResult = validateSet(cards, activeWildRank);
  if (setResult.isValid) return setResult;

  const runResult = validateRun(cards, activeWildRank);
  if (runResult.isValid) return runResult;

  return { isValid: false, calculatedPoints: 0 };
}
