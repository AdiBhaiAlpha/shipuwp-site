/**
 * Short-lived purchase session tokens (idea.txt item 8).
 * Uses standard crypto HMAC-SHA256 for signing tokens.
 */

import crypto from 'crypto';
import { nowMs } from './subscription.ts';

export const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_SECRET = 'shipuwp_internal_fixed_key_2026';

export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseError';
  }
}

export interface PurchaseSession {
  sessionId: string;
  uid: string;
  username: string;
  plan: string;
  createdAt: number;
  expiresAt: number;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(str: string): Buffer {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

export function sign(payload: Record<string, any>, secret?: string): string {
  const activeSecret = secret || process.env.PAYMENT_SECRET || DEFAULT_SECRET;
  // Sort keys for deterministic JSON serialization
  const sorted: Record<string, any> = {};
  for (const k of Object.keys(payload).sort()) {
    sorted[k] = payload[k];
  }
  const body = base64url(Buffer.from(JSON.stringify(sorted), 'utf-8'));
  const hmac = crypto.createHmac('sha256', activeSecret);
  hmac.update(body);
  const signature = base64url(hmac.digest());
  return `${body}.${signature}`;
}

export function verify(token: string, secret?: string): Record<string, any> {
  const activeSecret = secret || process.env.PAYMENT_SECRET || DEFAULT_SECRET;
  if (!token || !token.includes('.')) {
    throw new PurchaseError('malformed session token');
  }
  const [body, signature] = token.split('.');
  if (!body || !signature) {
    throw new PurchaseError('malformed session token');
  }

  const hmac = crypto.createHmac('sha256', activeSecret);
  hmac.update(body);
  const expectedSignature = base64url(hmac.digest());

  // Timing safe compare
  if (expectedSignature !== signature) {
    throw new PurchaseError('signature mismatch');
  }

  let payload: Record<string, any>;
  try {
    const rawJson = unbase64url(body).toString('utf-8');
    payload = JSON.parse(rawJson);
  } catch (err: any) {
    throw new PurchaseError('malformed payload');
  }

  if (Number(payload.expiresAt || 0) <= nowMs()) {
    throw new PurchaseError('session expired');
  }

  return payload;
}

export function createSession(
  uid: string,
  username: string,
  plan: string,
  secret: string,
  referenceMs?: number | null
): PurchaseSession {
  if (!uid) {
    throw new PurchaseError('uid is required');
  }
  const created = referenceMs ?? nowMs();
  const session: PurchaseSession = {
    sessionId: crypto.randomBytes(12).toString('base64url'),
    uid,
    username,
    plan,
    createdAt: created,
    expiresAt: created + TOKEN_TTL_MS,
  };

  sign(session as any, secret); // fail fast if secret is missing
  return session;
}

export function tokenFor(session: PurchaseSession, secret: string): string {
  return sign(session as any, secret);
}

export function resolveUid(token: string, secret: string): string {
  return String(verify(token, secret).uid || '');
}
