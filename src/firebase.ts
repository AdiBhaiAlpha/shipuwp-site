import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, update } from 'firebase/database';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously
} from 'firebase/auth';

// Official Firebase Config for ShiPu AI
export const firebaseConfig = {
  apiKey: "AIzaSyBIuJFn74hJK1LT_Shcl-Y5DMgiOArB8Ps",
  authDomain: "shipu-ai.firebaseapp.com",
  databaseURL: "https://shipu-ai-default-rtdb.firebaseio.com",
  projectId: "shipu-ai",
  storageBucket: "shipu-ai.firebasestorage.app",
  messagingSenderId: "953122849300",
  appId: "1:953122849300:web:f821f1a161ce7879001d01",
  measurementId: "G-N2WMSS3MNG"
};

export const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const firestore = getFirestore(app);
export const auth = getAuth(app);

/**
 * Ensure active Firebase Auth session matching user credentials
 */
export async function authenticateFirebaseUser(email: string, passwordPlain?: string) {
  try {
    if (auth.currentUser && auth.currentUser.email?.toLowerCase() === email.toLowerCase()) {
      return auth.currentUser;
    }
    const cleanPassword = passwordPlain || 'ShipuPass2026!';
    try {
      const cred = await signInWithEmailAndPassword(auth, email, cleanPassword);
      return cred.user;
    } catch (err: any) {
      if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/wrong-password'
      ) {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, cleanPassword);
          return cred.user;
        } catch (createErr) {
          // Fallback to anonymous auth if password creation fails
          const cred = await signInAnonymously(auth);
          return cred.user;
        }
      }
      const cred = await signInAnonymously(auth);
      return cred.user;
    }
  } catch (err) {
    console.warn('[Firebase Auth Init]', err);
    return auth.currentUser;
  }
}

/**
 * Write the caller's profile fields to both user keys.
 *
 * SECURITY: `plan`, `subscription` and `role` are deliberately NOT written
 * here. They are write-locked in `firebase/database.rules.json` and are owned
 * exclusively by the server through the Admin SDK. Without this split, anyone
 * could open devtools and grant themselves Pro.
 *
 * Uses `update()` rather than `set()` so the entitlement fields the server
 * wrote are preserved instead of being wiped.
 */
export async function syncUserToFirebase(user: any, passwordPlain?: string) {
  if (!user || !user.email) return;
  try {
    const firebaseUser = await authenticateFirebaseUser(user.email, passwordPlain);
    const targetUid = firebaseUser?.uid || user.uid;

    // Profile fields only. Entitlement is server-owned.
    const profilePayload = {
      uid: user.uid,
      firebaseUid: targetUid,
      username: user.username,
      email: user.email,
      updatedAt: Date.now()
    };

    // 1. users/${firebaseUid}
    try {
      await update(ref(database, `users/${targetUid}`), profilePayload);
    } catch (e) {
      console.warn('RTDB profile write by UID:', e);
    }

    // 2. users/user-${usernameSlug} - the key the Termux tool looks up
    const usernameSlug = (user.username || user.uid).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    try {
      await update(ref(database, `users/user-${usernameSlug}`), profilePayload);
    } catch (e) {
      console.warn('RTDB profile write by username:', e);
    }

    // 3. Firestore mirror
    try {
      await setDoc(doc(firestore, 'users', targetUid), profilePayload, { merge: true });
    } catch (e) {
      // ignore
    }
  } catch (err) {
    console.error('[Firebase Sync User Error]', err);
  }
}

/**
 * Write a payment record for the Termux tool to display.
 *
 * SECURITY: `status` is write-locked and is owned by the server. Only the
 * admin *decision* moves a payment to verified/rejected, and that goes through
 * `/admin/payments/:id/verify` then Admin SDK. `update()` keeps the
 * server-written status intact.
 */
export async function syncPaymentToFirebase(payment: any) {
  if (!payment || (!payment.id && !payment.paymentId)) return;
  const payId = payment.id || payment.paymentId;
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth).catch(() => {});
    }

    const paymentPayload = {
      uid: payment.uid,
      username: payment.username,
      termuxUsername: payment.termuxUsername || '',
      senderNumber: payment.senderNumber || payment.remitterNumber || '',
      plan: payment.plan || '',
      amount: payment.amount || 0,
      currency: payment.currency || 'BDT',
      method: payment.method || 'bkash',
      transactionId: payment.transactionId || '',
      createdAt: payment.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    try {
      await update(ref(database, `payments/${payId}`), paymentPayload);
    } catch (e) {
      console.warn('RTDB payment write error:', e);
    }

    try {
      await setDoc(doc(firestore, 'payments', payId), paymentPayload, { merge: true });
    } catch (e) {
      // ignore
    }
  } catch (err) {
    console.error('[Firebase Sync Payment Error]', err);
  }
}
