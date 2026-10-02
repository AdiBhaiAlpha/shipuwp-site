/**
 * Database abstraction for ShiPu WP.
 *
 * Implements persistent user accounts, real authentication sessions,
 * and subscription lifecycle under the `shipuwp` namespace.
 *
 * All mock/demo/sample users have been completely eradicated.
 * Fresh visits start strictly logged out.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { nowMs, DAY_MS, PLAN_FREE, PLAN_PRO, SUB_ACTIVE } from './subscription.ts';

const DB_FILE_PATH = path.resolve(process.cwd(), 'shipu_db.json');

export interface UserRecord {
  uid: string;
  /** Firebase Auth UID. Falls back to `uid` when the account was never synced. */
  firebaseUid?: string;
  username: string;
  usernameLower: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  passwordSalt: string;
  accountStatus: 'active' | 'suspended';
  createdAt: number;
  lastLoginAt?: number;
  plan: 'free' | 'pro';
  role?: 'user' | 'admin';
  subscription?: {
    status: 'none' | 'active' | 'expired';
    startedAt: number | null;
    expiresAt: number | null;
    paymentId?: string;
  };
  usage: {
    date: string;
    repliesUsed: number;
  };
}

export interface SessionRecord {
  token: string;
  uid: string;
  createdAt: number;
  expiresAt: number;
}

export interface AdminRecord {
  role: 'admin';
  active: boolean;
  createdAt: number;
}

export interface PaymentRecord {
  id: string;
  uid: string;
  username: string;
  termuxUsername: string;
  senderNumber: string;
  plan: string;
  amount: number;
  currency: string;
  method: string;
  transactionId: string;
  status: 'pending' | 'verified' | 'rejected';
  durationDays?: number;
  createdAt: number;
  verifiedAt?: number;
  verifiedBy?: string;
  expiresAt?: number;
  reason?: string;
}

export interface PurchaseSessionRecord {
  sessionId: string;
  uid: string;
  username: string;
  plan: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

export interface PricingPlan {
  id: string;
  name: string;
  cadence: string;
  priceTk: number;
  durationDays: number;
  savings?: string;
  highlightBadge?: string;
  periodLabel: string;
}

export interface AppConfig {
  paymentMethods: Record<string, { name: string; number: string; instructions: string; enabled: boolean }>;
  announcement: string;
  freeDailyReplies: number;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: '1_month',
    name: '1 Month',
    cadence: 'Monthly',
    priceTk: 100,
    durationDays: 30,
    periodLabel: 'per 30 days',
  },
  {
    id: '3_months',
    name: '3 Months',
    cadence: 'Quarterly',
    priceTk: 250,
    durationDays: 90,
    savings: 'Save ৳50 · 17%',
    highlightBadge: 'MOST POPULAR',
    periodLabel: 'per 90 days',
  },
  {
    id: '6_months',
    name: '6 Months',
    cadence: 'Semi-Annual',
    priceTk: 500,
    durationDays: 180,
    savings: 'Save ৳100 · 17%',
    periodLabel: 'per 180 days',
  },
  {
    id: '1_year',
    name: '1 Year',
    cadence: 'Annual',
    priceTk: 800,
    durationDays: 365,
    savings: 'Save ৳400 · 33%',
    highlightBadge: 'BEST VALUE',
    periodLabel: 'per 365 days',
  },
];

// Helper: secure password hashing with salt
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

class ShiPuDatabase {
  users: Map<string, UserRecord> = new Map();
  sessions: Map<string, SessionRecord> = new Map();
  usernameIndex: Map<string, string> = new Map(); // usernameLower -> uid
  emailIndex: Map<string, string> = new Map();    // emailLower -> uid
  admins: Map<string, AdminRecord> = new Map();
  payments: Map<string, PaymentRecord> = new Map();
  purchaseSessions: Map<string, PurchaseSessionRecord> = new Map();
  config: AppConfig;

  constructor() {
    // Official merchant config for bKash and Nagad
    this.config = {
      paymentMethods: {
        bkash: {
          name: 'bKash (Send Money)',
          number: '01316655254',
          instructions: 'Send Money to 01316655254 and submit your Transaction ID and Sender Number.',
          enabled: true,
        },
        nagad: {
          name: 'Nagad (Send Money)',
          number: '01945971168',
          instructions: 'Send Money to 01945971168 and submit your Transaction ID and Sender Number.',
          enabled: true,
        },
      },
      announcement: 'ShiPu WP WhatsApp Automation Suite',
      freeDailyReplies: 25,
    };

    // Load persistent database if exists
    this.loadFromDisk();
  }

  saveToDisk(): void {
    try {
      const data = {
        users: Array.from(this.users.entries()),
        sessions: Array.from(this.sessions.entries()),
        usernameIndex: Array.from(this.usernameIndex.entries()),
        emailIndex: Array.from(this.emailIndex.entries()),
        payments: Array.from(this.payments.entries()),
        purchaseSessions: Array.from(this.purchaseSessions.entries()),
      };
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DB Persistence Error]', e);
    }
  }

  loadFromDisk(): void {
    try {
      if (!fs.existsSync(DB_FILE_PATH)) return;
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      if (parsed.users) this.users = new Map(parsed.users);
      if (parsed.sessions) this.sessions = new Map(parsed.sessions);
      if (parsed.usernameIndex) this.usernameIndex = new Map(parsed.usernameIndex);
      if (parsed.emailIndex) this.emailIndex = new Map(parsed.emailIndex);
      if (parsed.payments) this.payments = new Map(parsed.payments);
      if (parsed.purchaseSessions) this.purchaseSessions = new Map(parsed.purchaseSessions);
    } catch (e) {
      console.error('[DB Load Error]', e);
    }
  }

  // Create real user
  createUser(username: string, email: string, passwordPlain: string): UserRecord {
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const uLower = cleanUsername.toLowerCase();

    if (this.usernameIndex.has(uLower)) {
      throw new Error('Username is already taken');
    }
    if (this.emailIndex.has(cleanEmail)) {
      throw new Error('An account with this email address already exists');
    }

    const uid = 'usr_' + crypto.randomBytes(12).toString('hex');
    const { hash, salt } = hashPassword(passwordPlain);
    const now = nowMs();
    const today = new Date().toISOString().split('T')[0];

    const user: UserRecord = {
      uid,
      username: cleanUsername,
      usernameLower: uLower,
      email: cleanEmail,
      emailLower: cleanEmail,
      passwordHash: hash,
      passwordSalt: salt,
      accountStatus: 'active',
      createdAt: now,
      lastLoginAt: now,
      plan: PLAN_FREE,
      role: 'user',
      subscription: {
        status: 'none',
        startedAt: null,
        expiresAt: null,
      },
      usage: {
        date: today,
        repliesUsed: 0,
      },
    };

    this.users.set(uid, user);
    this.usernameIndex.set(uLower, uid);
    this.emailIndex.set(cleanEmail, uid);
    this.saveToDisk();

    return user;
  }

  // Find user by username or email
  findUserByLogin(login: string): UserRecord | null {
    const clean = login.trim().toLowerCase();
    const uidFromEmail = this.emailIndex.get(clean);
    if (uidFromEmail) {
      return this.users.get(uidFromEmail) || null;
    }
    const uidFromUsername = this.usernameIndex.get(clean);
    if (uidFromUsername) {
      return this.users.get(uidFromUsername) || null;
    }
    return null;
  }

  // Create real authenticated session
  createSession(uid: string): SessionRecord {
    const token = 'spw_' + crypto.randomBytes(24).toString('hex');
    const now = nowMs();
    const session: SessionRecord = {
      token,
      uid,
      createdAt: now,
      expiresAt: now + 30 * DAY_MS, // 30 days valid
    };
    this.sessions.set(token, session);
    this.saveToDisk();
    return session;
  }

  // Verify session and get user
  getUserBySession(token: string): UserRecord | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= nowMs()) {
      this.sessions.delete(token);
      this.saveToDisk();
      return null;
    }
    const user = this.users.get(session.uid);
    if (!user || user.accountStatus !== 'active') {
      return null;
    }
    return user;
  }

  // Invalidate session
  destroySession(token: string): boolean {
    const res = this.sessions.delete(token);
    if (res) this.saveToDisk();
    return res;
  }
}

// Global database instance
export const db = new ShiPuDatabase();
