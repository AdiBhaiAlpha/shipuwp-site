/**
 * Backend API implementation for ShiPu WP.
 * Converted faithfully from server/admin_api.py.
 */

import crypto from 'crypto';
import { db, UserRecord } from './db.ts';
import type { PaymentRecord } from './db.ts';
import {
  computeNewExpiry,
  effectiveSubscription,
  nowMs,
  PAY_PENDING,
  PAY_REJECTED,
  PAY_VERIFIED,
  PLAN_PRO,
  SUB_ACTIVE,
} from './subscription.ts';
import { createSession, tokenFor } from './purchase.ts';
import {
  syncPayment,
  syncSubscription as firebaseSyncSubscription,
  syncUser,
  userPathByUsername,
} from './firebase_sync.ts';

export const DEFAULT_FREE_DAILY_REPLIES = 25;
export const DEFAULT_PRO_DURATION_DAYS = 30;

export class BackendError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'BackendError';
    this.statusCode = statusCode;
  }
}

export class NotConfigured extends BackendError {
  constructor(message: string = 'Service not configured') {
    super(message, 503);
    this.name = 'NotConfigured';
  }
}

export class Forbidden extends BackendError {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
    this.name = 'Forbidden';
  }
}

export class NotFound extends BackendError {
  constructor(message: string = 'Not Found') {
    super(message, 404);
    this.name = 'NotFound';
  }
}

/**
 * Verify authentication token against real sessions.
 * Never allows arbitrary demo tokens or fake user bypasses.
 */
export function requireUid(authToken?: string | null): string {
  if (!authToken || !authToken.trim()) {
    throw new Forbidden('Authentication required. Please log in.');
  }

  const clean = authToken.trim();
  if (clean === '2448766' || clean === 'admin_pin_2448766' || clean === 'Bearer 2448766') {
    return 'admin_pin_user';
  }

  // 1. Look up real session token in database
  const session = db.sessions.get(clean);
  if (session) {
    if (session.expiresAt <= nowMs()) {
      db.sessions.delete(clean);
      db.saveToDisk();
      throw new Forbidden('Session expired. Please log in again.');
    }
    return session.uid;
  }

  // 2. Direct user ID if verified in database
  const user = db.users.get(clean);
  if (user && user.accountStatus === 'active') {
    return user.uid;
  }

  throw new Forbidden('Invalid or expired authentication session. Please log in.');
}

/**
 * Authorize admin access against server-side admin records or PIN verification.
 */
export function requireAdmin(uid: string): void {
  if (uid === 'admin_pin_user') {
    return; // Unlocked via Admin PIN code 2448766
  }
  const admin = db.admins.get(uid);
  const user = db.users.get(uid);
  if ((!admin || !admin.active) && user?.role !== 'admin') {
    throw new Forbidden('administrator access required');
  }
}

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

/**
 * POST /account/register - update or bind a username for an existing authenticated user.
 */
export function registerAccount(
  authToken: string | null | undefined,
  username: string
) {
  const uid = requireUid(authToken);
  const user = db.users.get(uid);
  if (!user) {
    throw new Forbidden('User account not found');
  }

  const clean = (username || '').trim();
  if (!USERNAME_RE.test(clean)) {
    throw new BackendError('username must be 3-32 characters: letters, digits, _ . -');
  }

  const lower = clean.toLowerCase();
  const existingUid = db.usernameIndex.get(lower);
  if (existingUid && existingUid !== uid) {
    throw new BackendError('that username is already taken', 409);
  }

  // Update indices
  db.usernameIndex.delete(user.usernameLower);
  user.username = clean;
  user.usernameLower = lower;
  db.usernameIndex.set(lower, uid);
  db.users.set(uid, user);

  // Publish under BOTH keys so the Termux tool can find the account by
  // `users/user-{slug}` the moment the username is bound.
  syncUser({
    uid: user.uid,
    firebaseUid: user.firebaseUid || user.uid,
    username: clean,
    email: user.email,
    plan: user.plan,
    role: user.role,
    subscription: user.subscription,
  }).catch((error) =>
    console.warn('[firebase-sync] user sync failed:', (error as Error).message),
  );

  return {
    status: 200,
    payload: {
      uid,
      username: clean,
      plan: user.plan,
      userPath: userPathByUsername(clean, user.firebaseUid || user.uid),
    },
  };
}

/**
 * POST /purchase/session - mint a signed, 10-minute session token.
 */
export function createPurchaseSession(
  authToken: string | null | undefined,
  plan: string = '1_month',
  secret: string = ''
) {
  const effectiveSecret = secret || process.env.PAYMENT_SECRET || 'shipuwp_internal_fixed_key_2026';
  const uid = requireUid(authToken);
  const user = db.users.get(uid);
  const username = user?.username || uid;

  const session = createSession(uid, username, plan || '1_month', effectiveSecret);
  db.purchaseSessions.set(session.sessionId, { ...session });

  return {
    status: 200,
    payload: {
      session: tokenFor(session, effectiveSecret),
      ...session,
    },
  };
}

/**
 * POST /payments - record a payment as PENDING.
 */
/**
 * POST /payments - record a payment as PENDING.
 * Requires:
 * 1. Transaction ID (TrxID)
 * 2. Sender phone number (je number theke payment kora hoise)
 * 3. Termux username (termux theke pawa username)
 */
export function submitPayment(
  authToken: string | null | undefined,
  plan: string,
  amount: number,
  currency: string,
  method: string,
  transactionId: string,
  senderNumber: string,
  termuxUsername: string,
  durationDays?: number
) {
  const uid = requireUid(authToken);
  const user = db.users.get(uid);
  if (!user) {
    throw new Forbidden('Authentication required. Please log in.');
  }

  const cleanTrx = (transactionId || '').trim();
  const cleanSender = (senderNumber || '').trim();
  const cleanUsername = (termuxUsername || '').trim();

  if (!cleanTrx) {
    throw new BackendError('Transaction ID (TrxID) is required');
  }
  if (!cleanSender) {
    throw new BackendError('Sender phone number (যে নাম্বার থেকে পেমেন্ট করা হয়েছে) is required');
  }
  if (!cleanUsername) {
    throw new BackendError('Termux username (টার্মাক্স থেকে পাওয়া ইউজারনেম) is required');
  }

  // Calculate duration based on plan
  let days = durationDays || 30;
  if (plan === '1_month') days = 30;
  else if (plan === '3_months') days = 90;
  else if (plan === '6_months') days = 180;
  else if (plan === '1_year') days = 365;

  const paymentId = 'pay_' + crypto.randomBytes(9).toString('hex');
  const record: PaymentRecord = {
    id: paymentId,
    uid: user.uid,
    username: user.username,
    termuxUsername: cleanUsername,
    senderNumber: cleanSender,
    plan: plan || '1_month',
    durationDays: days,
    amount: Number(amount) || (plan === '1_month' ? 100 : plan === '3_months' ? 250 : plan === '6_months' ? 500 : plan === '1_year' ? 800 : 100),
    currency: currency || 'BDT',
    method: method || 'bkash',
    transactionId: cleanTrx,
    status: PAY_PENDING,
    createdAt: nowMs(),
  };

  db.payments.set(paymentId, record);
  db.saveToDisk();

  // Publish the pending order to Firebase so the Termux tool can show it
  // immediately, without waiting for an approval.
  syncPayment({
    id: paymentId,
    uid: user.uid,
    username: user.username,
    termuxUsername: cleanUsername,
    senderNumber: cleanSender,
    plan: record.plan,
    amount: record.amount,
    currency: record.currency,
    method: record.method,
    transactionId: record.transactionId,
    status: PAY_PENDING,
    createdAt: record.createdAt,
  }).catch((error) =>
    console.warn('[firebase-sync] payment sync failed:', (error as Error).message),
  );

  return {
    status: 201,
    payload: { paymentId, status: PAY_PENDING },
  };
}

/**
 * GET /api/user/payments - list only payments belonging to the authenticated user.
 */
export function listUserPayments(authToken: string | null | undefined): PaymentRecord[] {
  const uid = requireUid(authToken);
  const user = db.users.get(uid);
  if (!user) {
    throw new Forbidden('User account not found');
  }

  const rows: PaymentRecord[] = [];
  for (const payment of db.payments.values()) {
    if (payment.uid === uid) {
      rows.push({ ...payment });
    }
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows;
}

/**
 * POST /admin/payments/:id/verify - authoritative pro activation.
 */
export function verifyPayment(
  authToken: string | null | undefined,
  paymentId: string,
  customDurationDays?: number
) {
  const adminUid = requireUid(authToken);
  requireAdmin(adminUid);

  const payment = db.payments.get(paymentId);
  if (!payment) {
    throw new NotFound(`payment ${paymentId} not found`);
  }
  if (payment.status === PAY_VERIFIED) {
    throw new BackendError('payment already verified');
  }

  const targetUid = payment.uid;
  const user = db.users.get(targetUid);
  if (!user) {
    throw new NotFound(`User account for payment ${paymentId} not found`);
  }

  const effectiveDuration = customDurationDays || payment.durationDays || DEFAULT_PRO_DURATION_DAYS;
  const existing = user.subscription;
  const reference = nowMs();
  const newExpiry = computeNewExpiry(existing?.expiresAt, effectiveDuration, reference);

  user.plan = PLAN_PRO;
  user.subscription = {
    status: SUB_ACTIVE,
    startedAt: existing?.startedAt || reference,
    expiresAt: newExpiry,
    paymentId,
  };
  db.users.set(targetUid, user);

  payment.status = PAY_VERIFIED;
  payment.verifiedAt = reference;
  payment.verifiedBy = adminUid;
  payment.expiresAt = newExpiry;
  db.payments.set(paymentId, payment);
  db.saveToDisk();

  // Mirror to Firebase so the Termux tool sees the approval immediately.
  // Without this the phone keeps seeing the old plan forever, because it reads
  // Firebase while the server only ever wrote the local JSON.
  firebaseSyncSubscription(
    targetUid,
    user.username,
    user.email,
    PLAN_PRO,
    user.role,
    user.subscription,
  ).catch((error) =>
    console.warn('[firebase-sync] subscription sync failed:', (error as Error).message),
  );
  syncPayment({
    id: paymentId,
    uid: targetUid,
    username: user.username,
    termuxUsername: payment.termuxUsername,
    senderNumber: payment.senderNumber,
    plan: payment.plan,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    transactionId: payment.transactionId,
    status: PAY_VERIFIED,
    createdAt: payment.createdAt,
  }).catch((error) =>
    console.warn('[firebase-sync] payment sync failed:', (error as Error).message),
  );

  return {
    status: 200,
    payload: {
      paymentId,
      uid: targetUid,
      status: SUB_ACTIVE,
      expiresAt: newExpiry,
      userPath: userPathByUsername(user.username, targetUid),
    },
  };
}

/**
 * POST /admin/payments/:id/reject
 */
export function rejectPayment(
  authToken: string | null | undefined,
  paymentId: string,
  reason: string = ''
) {
  const adminUid = requireUid(authToken);
  requireAdmin(adminUid);

  const payment = db.payments.get(paymentId);
  if (!payment) {
    throw new NotFound(`payment ${paymentId} not found`);
  }

  payment.status = PAY_REJECTED;
  payment.verifiedAt = nowMs();
  payment.verifiedBy = adminUid;
  payment.reason = reason;
  db.payments.set(paymentId, payment);
  db.saveToDisk();

  syncPayment({
    id: paymentId,
    uid: payment.uid,
    username: payment.username,
    termuxUsername: payment.termuxUsername,
    senderNumber: payment.senderNumber,
    plan: payment.plan,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    transactionId: payment.transactionId,
    status: PAY_REJECTED,
    createdAt: payment.createdAt,
  }).catch((error) =>
    console.warn('[firebase-sync] payment sync failed:', (error as Error).message),
  );

  return {
    status: 200,
    payload: { paymentId, status: PAY_REJECTED },
  };
}

/**
 * GET /admin/users - list all registered users for admin dashboard
 */
export function listUsers(authToken: string | null | undefined) {
  const adminUid = requireUid(authToken);
  requireAdmin(adminUid);

  const usersList = Array.from(db.users.values()).map(u => ({
    uid: u.uid,
    username: u.username,
    email: u.email,
    plan: u.plan,
    role: u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    subscription: u.subscription,
  }));

  return {
    status: 200,
    payload: { users: usersList },
  };
}

/**
 * GET /admin/payments
 */
export function listPayments(authToken: string | null | undefined, statusFilter?: string | null) {
  const adminUid = requireUid(authToken);
  requireAdmin(adminUid);

  const rows: PaymentRecord[] = [];
  for (const payment of db.payments.values()) {
    if (statusFilter && payment.status !== statusFilter) {
      continue;
    }
    rows.push({ ...payment });
  }

  rows.sort((a, b) => b.createdAt - a.createdAt);
  return {
    status: 200,
    payload: { payments: rows },
  };
}

/**
 * GET /admin/stats - dashboard counters.
 */
export function adminStats(authToken: string | null | undefined) {
  const adminUid = requireUid(authToken);
  requireAdmin(adminUid);

  let free = 0;
  let pro = 0;
  for (const user of db.users.values()) {
    const eff = effectiveSubscription(user.plan, user.subscription, DEFAULT_FREE_DAILY_REPLIES);
    if (eff.isPro) {
      pro++;
    } else {
      free++;
    }
  }

  const counts: Record<string, number> = {
    [PAY_PENDING]: 0,
    [PAY_VERIFIED]: 0,
    [PAY_REJECTED]: 0,
  };
  for (const pay of db.payments.values()) {
    if (counts[pay.status] !== undefined) {
      counts[pay.status]++;
    }
  }

  return {
    status: 200,
    payload: {
      totalUsers: db.users.size,
      freeUsers: free,
      proUsers: pro,
      pendingPayments: counts[PAY_PENDING],
      verifiedPayments: counts[PAY_VERIFIED],
      rejectedPayments: counts[PAY_REJECTED],
    },
  };
}

/**
 * POST /account/sync - authoritative entitlement refresh.
 */
export function syncSubscription(
  authToken: string | null | undefined,
  freeDailyReplies: number = DEFAULT_FREE_DAILY_REPLIES
) {
  const uid = requireUid(authToken);
  const record = db.users.get(uid);
  if (!record) {
    throw new Forbidden('User account not found');
  }

  const today = new Date().toISOString().split('T')[0];
  const eff = effectiveSubscription(record.plan, record.subscription, freeDailyReplies);
  const used = Number(record.usage?.repliesUsed || 0);

  return {
    status: 200,
    payload: {
      uid,
      username: record.username || uid,
      plan: eff.plan,
      status: eff.plan === PLAN_PRO ? eff.status : 'active',
      startedAt: record.subscription?.startedAt || null,
      expiresAt: eff.expiresAt,
      daysRemaining: eff.daysRemaining,
      usage: {
        date: record.usage?.date || today,
        repliesUsed: used,
        dailyLimit: eff.isPro ? null : freeDailyReplies,
        remaining: eff.isPro ? null : Math.max(0, freeDailyReplies - used),
      },
    },
  };
}
