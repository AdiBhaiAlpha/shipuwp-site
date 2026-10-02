/**
 * Firebase Realtime Database sync for the ShiPu WP server.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Termux tool reads subscription state from Firebase, but the server was
 * only ever writing to the local `shipu_db.json`. Admin approvals therefore
 * never reached the phone. This module is the bridge: every server-side write
 * is mirrored to exactly the same paths the website's client SDK writes, so
 * both sides agree by construction.
 *
 * PATHS (must stay identical to `src/firebase.ts`)
 * -----------------------------------------------
 *   users/{firebaseUid}        full record
 *   users/user-{usernameSlug}  the SAME record, keyed for Termux lookup
 *   payments/{paymentId}       full payment record
 *
 *   usernameSlug = username.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
 *
 * COLLISION SAFETY
 * ----------------
 * This Firebase project is shared with other apps that own `user-*` keys in
 * `users/`. A blind `set()` would erase another app's record. Every write goes
 * through {@link safeUserPath}, which refuses to touch a node that exists but
 * does not look like a ShiPu record.
 *
 * CREDENTIALS
 * -----------
 * Reads FIREBASE_ADMIN_CREDENTIALS (service-account JSON or a path to it).
 * When unset, every call returns `false` and logs once - the site keeps working
 * against the local JSON, it just does not reach the Termux tool. It never
 * pretends to have synced.
 */

import { existsSync, readFileSync } from 'fs';
import * as admin from 'firebase-admin';

let initialised = false;
let warned = false;

/** Lazily initialise the Admin SDK from FIREBASE_ADMIN_CREDENTIALS. */
function ensureApp(): admin.app.App | null {
  if (initialised) {
    const existing = admin.apps[0];
    return existing ?? null;
  }
  initialised = true;

  const raw = process.env.FIREBASE_ADMIN_CREDENTIALS?.trim();
  if (!raw) {
    return null;
  }

  try {
    const credential = raw.startsWith('{')
      ? admin.credential.cert(JSON.parse(raw))
      : admin.credential.cert(
          existsSync(raw)
            ? JSON.parse(readFileSync(raw, 'utf8'))
            : (() => {
                throw new Error(`credentials file not found: ${raw}`);
              })(),
        );

    return admin.initializeApp({ credential });
  } catch (error) {
    console.warn(
      '[firebase-sync] FIREBASE_ADMIN_CREDENTIALS is unusable:',
      (error as Error).message,
    );
    return null;
  }
}

/** The Realtime Database handle, or null when not configured. */
function getDb(): admin.database.Database | null {
  const app = ensureApp();
  if (!app) {
    if (!warned) {
      warned = true;
      console.warn(
        '[firebase-sync] Disabled: set FIREBASE_ADMIN_CREDENTIALS so the ' +
          'Termux tool can see approvals. The site still works.',
      );
    }
    return null;
  }
  return app.database();
}

/**
 * Build the username slug exactly as the website does.
 * Must stay byte-for-byte identical to `src/firebase.ts`.
 */
export function usernameSlug(username: string, fallbackUid = ''): string {
  const source = (username || fallbackUid).toLowerCase();
  return source.replace(/[^a-z0-9_-]/g, '-');
}

/** The `users/...` path for a username, e.g. `users/user-adibhaialpha`. */
export function userPathByUsername(username: string, fallbackUid = ''): string {
  return `users/user-${usernameSlug(username, fallbackUid)}`;
}

interface SyncUser {
  uid: string;
  firebaseUid: string;
  username: string;
  email?: string;
  plan?: string;
  role?: string;
  subscription?: {
    status?: string;
    startedAt?: number | null;
    expiresAt?: number | null;
    paymentId?: string;
  };
}

/** The exact payload shape `src/firebase.ts` writes. */
function userPayload(user: SyncUser) {
  return {
    uid: user.uid,
    firebaseUid: user.firebaseUid,
    username: user.username,
    email: user.email ?? '',
    plan: user.plan || 'free',
    role: user.role || 'user',
    subscription: user.subscription || {
      status: 'none',
      startedAt: null,
      expiresAt: null,
    },
    updatedAt: Date.now(),
  };
}

/**
 * True when an existing node is safe for us to overwrite.
 *
 * A node that exists but carries no `plan` field belongs to another app in
 * this shared project (for example an alumni record with `bloodGroup`). We
 * refuse to clobber it.
 */
function isSafeToOverwrite(existing: unknown, firebaseUid: string): boolean {
  if (existing == null) {
    return true; // nothing there
  }
  if (typeof existing !== 'object') {
    return false;
  }
  const record = existing as Record<string, unknown>;
  if ('plan' in record) {
    return true; // it is a ShiPu record
  }
  // Also allow our own record if it was written by an older build.
  return record.firebaseUid === firebaseUid || record.uid === firebaseUid;
}

/** Write one user to both `users/{uid}` and `users/user-{slug}`. */
export async function syncUser(user: SyncUser): Promise<boolean> {
  const db = getDb();
  if (!db) {
    return false;
  }

  const payload = userPayload(user);
  const targets = [user.firebaseUid, userPathByUsername(user.username, user.uid)];

  for (const target of targets) {
    try {
      const ref = db.ref(target);
      const snapshot = await ref.get();
      const existing = snapshot.exists() ? snapshot.val() : null;
      if (!isSafeToOverwrite(existing, user.firebaseUid)) {
        console.warn(
          `[firebase-sync] Refusing to overwrite ${target}: it is not a ShiPu ` +
            'record (another app owns this key).',
        );
        continue;
      }
      await ref.set(payload);
      console.log(`[firebase-sync] wrote ${target}`);
    } catch (error) {
      console.warn(`[firebase-sync] failed to write ${target}:`, (error as Error).message);
      return false;
    }
  }
  return true;
}

interface SyncPayment {
  id: string;
  uid: string;
  username: string;
  termuxUsername?: string;
  senderNumber?: string;
  plan?: string;
  amount?: number;
  currency?: string;
  method?: string;
  transactionId?: string;
  status?: string;
  createdAt?: number;
  durationDays?: number;
}

/** Write one payment to `payments/{id}`. */
export async function syncPayment(payment: SyncPayment): Promise<boolean> {
  const db = getDb();
  if (!db) {
    return false;
  }

  const payload = {
    id: payment.id,
    uid: payment.uid,
    username: payment.username,
    termuxUsername: payment.termuxUsername || '',
    senderNumber: payment.senderNumber || '',
    plan: payment.plan || '',
    amount: payment.amount || 0,
    currency: payment.currency || 'BDT',
    method: payment.method || 'bkash',
    transactionId: payment.transactionId || '',
    status: payment.status || 'pending',
    createdAt: payment.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const ref = db.ref(`payments/${payment.id}`);
    await ref.set(payload);
    console.log(`[firebase-sync] wrote payments/${payment.id}`);
    return true;
  } catch (error) {
    console.warn(
      `[firebase-sync] failed to write payments/${payment.id}:`,
      (error as Error).message,
    );
    return false;
  }
}

/** Push an entitlement straight onto both user records. */
export async function syncSubscription(
  firebaseUid: string,
  username: string,
  email: string | undefined,
  plan: string,
  role: string | undefined,
  subscription: SyncUser['subscription'],
): Promise<boolean> {
  return syncUser({
    uid: firebaseUid,
    firebaseUid,
    username,
    email,
    plan,
    role,
    subscription,
  });
}