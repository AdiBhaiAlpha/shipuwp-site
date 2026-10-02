import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';
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

export async function syncUserToFirebase(user: any, passwordPlain?: string) {
  if (!user || !user.email) return;
  try {
    const firebaseUser = await authenticateFirebaseUser(user.email, passwordPlain);
    const targetUid = firebaseUser?.uid || user.uid;

    const userPayload = {
      uid: user.uid,
      firebaseUid: targetUid,
      username: user.username,
      email: user.email,
      plan: user.plan || 'free',
      role: user.role || 'user',
      subscription: user.subscription || { status: 'none', startedAt: null, expiresAt: null },
      updatedAt: Date.now()
    };

    // 1. Write to `users/${targetUid}`
    try {
      await set(ref(database, `users/${targetUid}`), userPayload);
    } catch (e) {
      console.warn('RTDB write by UID:', e);
    }

    // 2. Write to `users/user-${user.username}` matching screenshot format (e.g. user-chowdhury-onup-amir)
    const usernameSlug = (user.username || user.uid).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    try {
      await set(ref(database, `users/user-${usernameSlug}`), userPayload);
    } catch (e) {
      console.warn('RTDB write by username:', e);
    }

    // 3. Write to Firestore `users/${targetUid}`
    try {
      await setDoc(doc(firestore, 'users', targetUid), userPayload, { merge: true });
    } catch (e) {
      // ignore
    }
  } catch (err) {
    console.error('[Firebase Sync User Error]', err);
  }
}

export async function syncPaymentToFirebase(payment: any) {
  if (!payment || (!payment.id && !payment.paymentId)) return;
  const payId = payment.id || payment.paymentId;
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth).catch(() => {});
    }

    const paymentPayload = {
      id: payId,
      uid: payment.uid,
      username: payment.username,
      termuxUsername: payment.termuxUsername || '',
      senderNumber: payment.senderNumber || payment.remitterNumber || '',
      plan: payment.plan || '',
      amount: payment.amount || 0,
      currency: payment.currency || 'BDT',
      method: payment.method || 'bkash',
      transactionId: payment.transactionId || '',
      status: payment.status || 'pending',
      createdAt: payment.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    try {
      await set(ref(database, `payments/${payId}`), paymentPayload);
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
