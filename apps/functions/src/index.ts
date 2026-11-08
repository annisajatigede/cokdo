import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

export { calculateRoundScores } from './handlers/onDeclareWin';
