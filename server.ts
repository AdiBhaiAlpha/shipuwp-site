import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  BackendError,
  DEFAULT_PRO_DURATION_DAYS,
  adminStats,
  createPurchaseSession,
  listPayments,
  listUserPayments,
  listUsers,
  registerAccount,
  rejectPayment,
  submitPayment,
  syncSubscription,
  verifyPayment,
} from './server/admin_api.ts';
import { db, PRICING_PLANS, verifyPassword } from './server/db.ts';
import { effectiveSubscription } from './server/subscription.ts';
import { runTests } from './server/test_renewal.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Helper to extract bearer token
function getBearer(req: Request): string {
  const header = req.headers['authorization'] || '';
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return '';
}

// --------------------------------------------------------------------------
// Health
// --------------------------------------------------------------------------
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'shipu-wp' });
});

// --------------------------------------------------------------------------
// Account
// --------------------------------------------------------------------------
app.post('/account/register', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const username = String(req.body?.username || '');
    const result = registerAccount(bearer, username);
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

app.post('/account/sync', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const result = syncSubscription(bearer);
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// Purchase
// --------------------------------------------------------------------------
app.post('/purchase/session', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const plan = String(req.body?.plan || 'pro');
    const result = createPurchaseSession(bearer, plan, process.env.PAYMENT_SECRET || '');
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

app.post('/payments', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const payload = req.body || {};
    const result = submitPayment(
      bearer,
      String(payload.plan || '1_month'),
      Number(payload.amount || 0),
      String(payload.currency || 'BDT'),
      String(payload.method || 'bkash'),
      String(payload.transactionId || ''),
      String(payload.senderNumber || ''),
      String(payload.termuxUsername || payload.username || ''),
      payload.durationDays ? Number(payload.durationDays) : undefined
    );
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// Admin
// --------------------------------------------------------------------------
app.post('/api/admin/verify-pin', (req: Request, res: Response) => {
  const pin = String(req.body?.pin || '').trim();
  if (pin === '2448766') {
    return res.json({ status: 'ok', token: '2448766' });
  }
  return res.status(401).json({ error: 'Invalid PIN Code. Access denied.' });
});

app.get('/admin/users', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const result = listUsers(bearer);
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

app.get('/admin/payments', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const status = req.query.status ? String(req.query.status) : null;
    const result = listPayments(bearer, status);
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

app.get('/admin/stats', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const result = adminStats(bearer);
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

app.post('/admin/payments/:id/verify', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const paymentId = String(req.params.id);
    const durationDays = Number(req.body?.durationDays) || DEFAULT_PRO_DURATION_DAYS;
    const result = verifyPayment(bearer, paymentId, durationDays);
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

app.post('/admin/payments/:id/reject', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const paymentId = String(req.params.id);
    const reason = String(req.body?.reason || '');
    const result = rejectPayment(bearer, paymentId, reason);
    res.status(result.status).json(result.payload);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// Real Authentication Routes
// --------------------------------------------------------------------------
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { username, email, password, confirmPassword } = req.body || {};
  const cleanUsername = String(username || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const plainPassword = String(password || '');
  const confirm = String(confirmPassword || '');

  if (!cleanUsername || cleanUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
  }
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens.' });
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (!plainPassword || plainPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }
  if (plainPassword !== confirm) {
    return res.status(400).json({ error: 'Password confirmation does not match.' });
  }

  try {
    const user = db.createUser(cleanUsername, cleanEmail, plainPassword);
    const session = db.createSession(user.uid);
    return res.status(201).json({
      token: session.token,
      user: {
        uid: user.uid,
        username: user.username,
        email: user.email,
        plan: user.plan,
        role: user.role,
        subscription: user.subscription,
        usage: user.usage,
      },
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { login, password } = req.body || {};
  const cleanLogin = String(login || '').trim();
  const plainPassword = String(password || '');

  if (!cleanLogin || !plainPassword) {
    return res.status(400).json({ error: 'Please enter your email/username and password.' });
  }

  const user = db.findUserByLogin(cleanLogin);
  if (!user || !verifyPassword(plainPassword, user.passwordHash, user.passwordSalt)) {
    return res.status(400).json({ error: 'Invalid email/username or password.' });
  }

  if (user.accountStatus !== 'active') {
    return res.status(403).json({ error: 'Account is suspended. Please contact support.' });
  }

  user.lastLoginAt = Date.now();
  const session = db.createSession(user.uid);

  return res.json({
    token: session.token,
    user: {
      uid: user.uid,
      username: user.username,
      email: user.email,
      plan: user.plan,
      role: user.role,
      subscription: user.subscription,
      usage: user.usage,
    },
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const bearer = getBearer(req);
  if (bearer) {
    db.destroySession(bearer);
  }
  res.json({ status: 'ok' });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const bearer = getBearer(req);
  if (!bearer) {
    return res.status(401).json({ error: 'Unauthorized. No active session.' });
  }

  const user = db.getUserBySession(bearer);
  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }

  const effective = effectiveSubscription(user.plan, user.subscription, 25, Date.now());

  return res.json({
    user: {
      uid: user.uid,
      username: user.username,
      email: user.email,
      plan: effective.plan,
      role: user.role,
      status: effective.status,
      startedAt: user.subscription?.startedAt || null,
      expiresAt: user.subscription?.expiresAt || null,
      daysRemaining: effective.daysRemaining,
      usage: {
        date: user.usage.date,
        repliesUsed: user.usage.repliesUsed,
        dailyLimit: effective.plan === 'pro' ? null : 25,
        remaining: effective.plan === 'pro' ? null : Math.max(0, 25 - user.usage.repliesUsed),
      },
    },
  });
});

app.get('/api/user/payments', (req: Request, res: Response, next: NextFunction) => {
  try {
    const bearer = getBearer(req);
    const payments = listUserPayments(bearer);
    res.json({ payments });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// App Metadata & Config Endpoints
// --------------------------------------------------------------------------
app.get('/api/config', (_req: Request, res: Response) => {
  res.json({
    config: db.config,
    pricing: PRICING_PLANS,
  });
});

app.post('/api/test/renewal', (_req: Request, res: Response) => {
  const result = runTests();
  res.json(result);
});

// --------------------------------------------------------------------------
// Global Error Handler
// --------------------------------------------------------------------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof BackendError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('[API Error]', err);
  res.status(500).json({ error: 'internal server error' });
});

// --------------------------------------------------------------------------
// Start Server with Vite or Static Serving
// --------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ShiPu WP Web & Backend listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
