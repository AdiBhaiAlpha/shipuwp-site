import React, { useState, useEffect } from 'react';
import { syncUserToFirebase, syncPaymentToFirebase } from './firebase';
import {
  Check,
  Copy,
  CreditCard,
  User,
  Shield,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Smartphone,
  ExternalLink,
  Layers,
  HelpCircle,
  Activity,
  Terminal,
  Zap,
  MessageSquare,
  Lock,
  LogOut,
  LogIn,
  UserPlus,
  Mail,
  KeyRound,
} from 'lucide-react';

interface AuthUser {
  uid: string;
  username: string;
  email: string;
  plan: 'free' | 'pro';
  role?: 'user' | 'admin';
  status?: string;
  startedAt?: number | null;
  expiresAt?: number | null;
  daysRemaining?: number;
  usage?: {
    date: string;
    repliesUsed: number;
    dailyLimit: number | null;
    remaining: number | null;
  };
}

interface PaymentItem {
  id: string;
  uid: string;
  username: string;
  termuxUsername?: string;
  senderNumber?: string;
  plan: string;
  durationDays?: number;
  amount: number;
  currency: string;
  method: string;
  transactionId: string;
  status: 'pending' | 'verified' | 'rejected';
  createdAt: number;
  verifiedAt?: number;
  verifiedBy?: string;
  expiresAt?: number;
  reason?: string;
}

interface PlanOption {
  id: string;
  name: string;
  cadence: string;
  priceTk: number;
  durationDays: number;
  savings?: string;
  highlightBadge?: string;
  periodLabel: string;
}

const PRICING_TIERS: PlanOption[] = [
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

const FAQS = [
  {
    q: 'What happens after I complete my payment?',
    a: 'Once you submit your Transaction ID (TrxID), Remitter Phone Number, and Termux Username, our settlement desk verifies the transaction against merchant statements. Your account automatically activates for the selected duration upon approval.',
  },
  {
    q: 'How does renewal work? Do unused days carry over?',
    a: 'Yes, absolutely. Unused days carry over on renewal. If you have 10 days remaining and renew with a 30-day plan, your new expiration date is calculated from your existing expiration date (10 + 30 = 40 days total). You never lose paid days.',
  },
  {
    q: 'How long does verification take?',
    a: 'Verification is typically completed within 5 to 30 minutes during standard operating hours. You can track your status in real time from the Payment Submission or Dashboard tab.',
  },
  {
    q: 'What happens when my subscription expires?',
    a: 'When your paid subscription period concludes, your account seamlessly reverts to the Standard Free Tier (25 replies per day). No data is lost, and you can renew at any time.',
  },
  {
    q: 'Can I change to a different plan upon renewal?',
    a: 'Yes. You can switch to any tier (1 Month, 3 Months, 6 Months, or 1 Year) upon renewal. The newly purchased duration will be appended to your active expiration date.',
  },
  {
    q: 'What payment methods are supported?',
    a: 'We accept direct Send Money transfers via bKash Personal (01316655254) and Nagad Personal (01945971168). There are no automated recurring card deductions.',
  },
];

export default function App() {
  // Navigation & Authentication States - STRICTLY NULL by default
  const [activeTab, setActiveTab] = useState<'home' | 'pricing' | 'payment' | 'account' | 'docs' | 'login' | 'register' | 'admin'>('home');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [pendingRedirect, setPendingRedirect] = useState<'payment' | 'account' | null>(null);

  // User payments history & feedback
  const [userPayments, setUserPayments] = useState<PaymentItem[]>([]);
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Login Form
  const [loginIdentifier, setLoginIdentifier] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');

  // Register Form
  const [regUsername, setRegUsername] = useState<string>('');
  const [regEmail, setRegEmail] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');
  const [regConfirmPassword, setRegConfirmPassword] = useState<string>('');
  const [regError, setRegError] = useState<string>('');

  // Checkout Flow
  const [checkoutStep, setCheckoutStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('3_months');
  const [selectedMethod, setSelectedMethod] = useState<'bkash' | 'nagad'>('bkash');
  const [termuxUsernameInput, setTermuxUsernameInput] = useState<string>('');
  const [senderNumberInput, setSenderNumberInput] = useState<string>('');
  const [transactionIdInput, setTransactionIdInput] = useState<string>('');
  const [lastSubmittedPayment, setLastSubmittedPayment] = useState<any>(null);

  // User Dropdown & Forgot Password State
  const [userDropdownOpen, setUserDropdownOpen] = useState<boolean>(false);
  const [showForgotPassword, setShowForgotPassword] = useState<boolean>(false);
  const userDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // FAQ Accordion
  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(0);

  // Admin PIN & View State
  const [isAdminPinUnlocked, setIsAdminPinUnlocked] = useState<boolean>(() => {
    return sessionStorage.getItem('shipu_admin_pin') === '2448766';
  });
  const [adminPinInput, setAdminPinInput] = useState<string>('');
  const [adminPinError, setAdminPinError] = useState<string>('');
  const [adminPayments, setAdminPayments] = useState<PaymentItem[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminFilter, setAdminFilter] = useState<string>('all');
  const [adminViewSection, setAdminViewSection] = useState<'payments' | 'users'>('payments');
  const [adminSearchQuery, setAdminSearchQuery] = useState<string>('');
  const [rejectReason, setRejectReason] = useState<string>('Statement record not found with remitter phone number');
  const [selectedPaymentForReject, setSelectedPaymentForReject] = useState<string | null>(null);

  const selectedPlan = PRICING_TIERS.find((p) => p.id === selectedPlanId) || PRICING_TIERS[1];

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // URL Path listener for /admin
  useEffect(() => {
    const handleUrlChange = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path === '/admin' || path.startsWith('/admin') || hash === '#admin') {
        setActiveTab('admin');
      }
    };
    handleUrlChange();
    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // 1. Initial Session Check on Mount (NO FAKE AUTO-LOGIN)
  useEffect(() => {
    const token = localStorage.getItem('shipu_session_token');
    if (!token) {
      setCurrentUser(null);
      setIsAuthChecking(false);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Session invalid');
        return res.json();
      })
      .then((data) => {
        if (data.user) {
          setCurrentUser(data.user);
          setTermuxUsernameInput(data.user.username);
          syncUserToFirebase(data.user);
        } else {
          localStorage.removeItem('shipu_session_token');
          setCurrentUser(null);
        }
      })
      .catch(() => {
        localStorage.removeItem('shipu_session_token');
        setCurrentUser(null);
      })
      .finally(() => {
        setIsAuthChecking(false);
      });
  }, []);

  // Route protection guard: redirect logged-out visitors away from user dashboard/payment
  useEffect(() => {
    if (!isAuthChecking && !currentUser && (activeTab === 'account' || activeTab === 'payment')) {
      setPendingRedirect(activeTab);
      setActiveTab('login');
      setFeedback({ message: 'Please log in to continue.', type: 'info' });
    }
  }, [activeTab, currentUser, isAuthChecking]);

  // Fetch user's payments when in Account / Dashboard
  const fetchUserPayments = async () => {
    const token = localStorage.getItem('shipu_session_token');
    if (!token) return;
    try {
      const res = await fetch('/api/user/payments', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUserPayments(data.payments || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Sync profile data
  const syncAccountData = async () => {
    const token = localStorage.getItem('shipu_session_token');
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch('/account/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser((prev) => (prev ? { ...prev, ...data } : null));
        fetchUserPayments();
        setFeedback({ message: 'Account status synchronized successfully.', type: 'success' });
      }
    } catch (e: any) {
      setFeedback({ message: e.message || 'Sync failed', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const getAdminAuthHeader = (): string => {
    const sessionToken = localStorage.getItem('shipu_session_token');
    if (sessionToken && currentUser?.role === 'admin') return `Bearer ${sessionToken}`;
    return 'Bearer 2448766';
  };

  // Fetch admin console data
  const fetchAdminData = async () => {
    const authHeader = getAdminAuthHeader();
    setIsLoading(true);
    try {
      const [statsRes, paymentsRes, usersRes] = await Promise.all([
        fetch('/admin/stats', { headers: { Authorization: authHeader } }),
        fetch(`/admin/payments${adminFilter !== 'all' ? `?status=${adminFilter}` : ''}`, {
          headers: { Authorization: authHeader },
        }),
        fetch('/admin/users', { headers: { Authorization: authHeader } }),
      ]);
      if (statsRes.ok) setAdminStats(await statsRes.json());
      if (paymentsRes.ok) {
        const data = await paymentsRes.json();
        setAdminPayments(data.payments || []);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setAdminUsers(data.users || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'account' && currentUser) {
      fetchUserPayments();
    }
    if (activeTab === 'admin' && isAdminPinUnlocked) {
      fetchAdminData();
    }
  }, [activeTab, currentUser, adminFilter, isAdminPinUnlocked]);

  // Handle Admin PIN Unlock
  const handleAdminPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPinError('');
    if (adminPinInput.trim() === '2448766') {
      setIsAdminPinUnlocked(true);
      sessionStorage.setItem('shipu_admin_pin', '2448766');
      setAdminPinInput('');
      setFeedback({ message: 'Admin session unlocked.', type: 'success' });
    } else {
      setAdminPinError('Invalid Admin PIN code. Access denied.');
    }
  };

  const handleAdminLock = () => {
    setIsAdminPinUnlocked(false);
    sessionStorage.removeItem('shipu_admin_pin');
    setActiveTab('home');
    setFeedback({ message: 'Admin session locked.', type: 'info' });
  };

  // Route Guard Helper
  const navigateToTab = (tab: typeof activeTab) => {
    const protectedTabs = ['account', 'payment'];
    if (protectedTabs.includes(tab) && !currentUser) {
      setPendingRedirect(tab as any);
      setActiveTab('login');
      setFeedback({ message: 'Please log in to continue.', type: 'info' });
      return;
    }
    setActiveTab(tab);
  };

  // Handle Plan selection from Landing or Pricing
  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    if (!currentUser) {
      setPendingRedirect('payment');
      setActiveTab('login');
      setFeedback({ message: 'Please log in to continue with plan checkout.', type: 'info' });
    } else {
      setCheckoutStep(2);
      setActiveTab('payment');
    }
  };

  // Real Login Handler
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!loginIdentifier.trim() || !loginPassword) {
      setLoginError('Please enter your email or username and password.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginIdentifier.trim(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Invalid credentials');
        return;
      }

      localStorage.setItem('shipu_session_token', data.token);
      setCurrentUser(data.user);
      setTermuxUsernameInput(data.user.username);
      syncUserToFirebase(data.user, loginPassword);
      setLoginPassword('');
      setFeedback({ message: `Welcome back, ${data.user.username}!`, type: 'success' });

      if (pendingRedirect) {
        const dest = pendingRedirect;
        setPendingRedirect(null);
        setActiveTab(dest);
        if (dest === 'payment') setCheckoutStep(2);
      } else {
        setActiveTab('account');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Network error during login');
    } finally {
      setIsLoading(false);
    }
  };

  // Real Registration Handler
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');

    if (!regUsername.trim() || regUsername.trim().length < 3) {
      setRegError('Username must be at least 3 characters.');
      return;
    }
    if (!regEmail.trim() || !regEmail.includes('@')) {
      setRegError('Please provide a valid email address.');
      return;
    }
    if (!regPassword || regPassword.length < 6) {
      setRegError('Password must be at least 6 characters.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setRegError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: regUsername.trim(),
          email: regEmail.trim(),
          password: regPassword,
          confirmPassword: regConfirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegError(data.error || 'Registration failed');
        return;
      }

      localStorage.setItem('shipu_session_token', data.token);
      setCurrentUser(data.user);
      setTermuxUsernameInput(data.user.username);
      syncUserToFirebase(data.user, regPassword);
      setRegPassword('');
      setRegConfirmPassword('');
      setFeedback({ message: 'Account created successfully! Welcome to ShiPu WP.', type: 'success' });

      if (pendingRedirect) {
        const dest = pendingRedirect;
        setPendingRedirect(null);
        setActiveTab(dest);
        if (dest === 'payment') setCheckoutStep(2);
      } else {
        setActiveTab('account');
      }
    } catch (err: any) {
      setRegError(err.message || 'Network error during registration');
    } finally {
      setIsLoading(false);
    }
  };

  // Real Logout Handler
  const handleLogout = async () => {
    const token = localStorage.getItem('shipu_session_token');
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }

    localStorage.removeItem('shipu_session_token');
    setCurrentUser(null);
    setUserPayments([]);
    setUserDropdownOpen(false);
    setActiveTab('home');
    setFeedback({ message: 'You have been logged out.', type: 'info' });
  };

  // Payment Submit Handler
  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('shipu_session_token');
    if (!token || !currentUser) {
      setPendingRedirect('payment');
      setActiveTab('login');
      setFeedback({ message: 'Please log in to submit your payment.', type: 'error' });
      return;
    }

    if (!termuxUsernameInput.trim() || !senderNumberInput.trim() || !transactionIdInput.trim()) {
      setFeedback({ message: 'All 3 fields are required.', type: 'error' });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: selectedPlan.id,
          amount: selectedPlan.priceTk,
          currency: 'BDT',
          method: selectedMethod,
          transactionId: transactionIdInput.trim(),
          senderNumber: senderNumberInput.trim(),
          termuxUsername: termuxUsernameInput.trim(),
          durationDays: selectedPlan.durationDays,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ message: data.error || 'Payment submission failed', type: 'error' });
        return;
      }

      setLastSubmittedPayment({
        paymentId: data.paymentId,
        plan: selectedPlan,
        method: selectedMethod,
        transactionId: transactionIdInput.trim(),
        senderNumber: senderNumberInput.trim(),
        termuxUsername: termuxUsernameInput.trim(),
        amount: selectedPlan.priceTk,
      });

      syncPaymentToFirebase({
        id: data.paymentId,
        uid: currentUser.uid,
        username: currentUser.username,
        termuxUsername: termuxUsernameInput.trim(),
        senderNumber: senderNumberInput.trim(),
        plan: selectedPlan.id,
        amount: selectedPlan.priceTk,
        currency: 'BDT',
        method: selectedMethod,
        transactionId: transactionIdInput.trim(),
        status: 'pending',
        createdAt: Date.now(),
      });

      setCheckoutStep(4);
      setTransactionIdInput('');
      setSenderNumberInput('');
      setFeedback({ message: `Payment reference ${data.paymentId} submitted. Pending verification.`, type: 'success' });
      fetchUserPayments();
    } catch (e: any) {
      setFeedback({ message: e.message || 'Submission failed', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // Admin Verification
  const handleAdminVerify = async (paymentId: string, durationDays: number = 30) => {
    const authHeader = getAdminAuthHeader();
    setIsLoading(true);
    try {
      const res = await fetch(`/admin/payments/${paymentId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ durationDays }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({ message: `Payment ${paymentId} verified successfully.`, type: 'success' });
        // status is server-owned: /admin/payments/:id/verify already wrote
        // it to Firebase via the Admin SDK. No client write needed.
        fetchAdminData();
      } else {
        setFeedback({ message: data.error || 'Verification failed', type: 'error' });
      }
    } catch (e: any) {
      setFeedback({ message: e.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // Admin Rejection
  const handleAdminReject = async (paymentId: string) => {
    const authHeader = getAdminAuthHeader();
    setIsLoading(true);
    try {
      const res = await fetch(`/admin/payments/${paymentId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (res.ok) {
        setFeedback({ message: `Payment ${paymentId} rejected.`, type: 'info' });
        // status is server-owned: the reject endpoint already synced it.
        setSelectedPaymentForReject(null);
        fetchAdminData();
      }
    } catch (e: any) {
      setFeedback({ message: e.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-[#F8FAFC] flex flex-col font-sans selection:bg-slate-800 selection:text-white">
      {/* Top Bar (3-column grid container: Max-width 1280px, px: 32px, py: 24px) */}
      <header className="border-b border-white/[0.08] bg-[#070B14]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-[1280px] mx-auto px-6 sm:px-8 py-6 flex items-center justify-between md:grid md:grid-cols-3 gap-6">
          {/* Left Col: Brand logo using 'Instrument Serif' at 30px size with a registered trademark symbol in superscript */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center bg-[#0D1422] border border-white/10 shrink-0">
              <img
                src="https://shipu.c0m.in/assets/logo-edae341e.png"
                alt="ShiPu WP Logo"
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <button
              onClick={() => setActiveTab('home')}
              className="font-serif-display text-[30px] font-normal leading-none tracking-tight text-white hover:text-slate-200 transition-colors inline-flex items-baseline gap-1"
            >
              <span>ShiPu WP</span>
              <sup className="text-xs font-sans text-slate-400 font-normal">®</sup>
            </button>
          </div>

          {/* Center Col: Hidden on mobile. Horizontal flex list of 4 links using 'Inter' 14px Medium, spacing: 40px */}
          <nav className="hidden md:flex items-center justify-center gap-10 text-sm font-medium text-[#94A3B8]">
            <button
              onClick={() => setActiveTab('pricing')}
              className={`py-1 text-sm transition-colors relative ${
                activeTab === 'pricing' ? 'text-white font-medium' : 'hover:text-white'
              }`}
            >
              <span>Plans</span>
              {activeTab === 'pricing' && (
                <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
              )}
            </button>

            {currentUser ? (
              <>
                <button
                  onClick={() => navigateToTab('account')}
                  className={`py-1 text-sm transition-colors relative ${
                    activeTab === 'account' ? 'text-white font-medium' : 'hover:text-white'
                  }`}
                >
                  <span>Dashboard</span>
                  {activeTab === 'account' && (
                    <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
                  )}
                </button>

                <button
                  onClick={() => navigateToTab('payment')}
                  className={`py-1 text-sm transition-colors relative ${
                    activeTab === 'payment' ? 'text-white font-medium' : 'hover:text-white'
                  }`}
                >
                  <span>Submit Payment</span>
                  {activeTab === 'payment' && (
                    <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setActiveTab('home');
                    setTimeout(() => {
                      document.getElementById('features-section')?.scrollIntoView({ behavior: 'smooth' });
                    }, 50);
                  }}
                  className="py-1 text-sm hover:text-white transition-colors"
                >
                  Features
                </button>

                <button
                  onClick={() => {
                    setActiveTab('home');
                    setTimeout(() => {
                      document.getElementById('how-it-works-section')?.scrollIntoView({ behavior: 'smooth' });
                    }, 50);
                  }}
                  className="py-1 text-sm hover:text-white transition-colors"
                >
                  How It Works
                </button>
              </>
            )}

            <button
              onClick={() => setActiveTab('docs')}
              className={`py-1 text-sm transition-colors relative ${
                activeTab === 'docs' ? 'text-white font-medium' : 'hover:text-white'
              }`}
            >
              <span>Documentation</span>
              {activeTab === 'docs' && (
                <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
              )}
            </button>
          </nav>

          {/* Right Col: Pill-shaped CTA button in solid black with white text / Auth controls */}
          <div className="flex items-center justify-end gap-4">
            {!currentUser ? (
              <>
                <button
                  onClick={() => {
                    setLoginError('');
                    setActiveTab('login');
                  }}
                  className="text-sm font-medium text-slate-300 hover:text-white transition-colors px-2 py-1"
                >
                  Login
                </button>
                <button
                  onClick={() => {
                    setRegError('');
                    setActiveTab('register');
                  }}
                  className="pill-action px-6 py-2.5 text-sm font-medium border border-white/20 shadow-md flex items-center gap-1.5"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <div className="relative" ref={userDropdownRef}>
                <button
                  type="button"
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2.5 px-3.5 py-2 rounded-full border border-white/10 bg-[#0D1422] hover:bg-[#111A2A] text-xs font-medium text-slate-200 hover:text-white transition-colors"
                  aria-expanded={userDropdownOpen}
                  aria-haspopup="true"
                >
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-[10px]">
                    {currentUser.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium max-w-[120px] truncate">{currentUser.username}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${
                      userDropdownOpen ? 'rotate-180 text-white' : ''
                    }`}
                  />
                </button>

                {userDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-white/10 bg-[#0D1422] shadow-2xl z-50 overflow-hidden divide-y divide-white/[0.08]">
                    <div className="p-3.5 bg-[#070B14]/90">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-xs shrink-0">
                          {currentUser.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate">{currentUser.username}</p>
                          <p className="text-[11px] text-[#94A3B8] truncate">{currentUser.email}</p>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between">
                        <span className="text-[10px] text-[#94A3B8]">Subscription:</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                            currentUser.plan === 'pro'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {currentUser.plan === 'pro' ? 'Pro Commercial' : 'Free Tier'}
                        </span>
                      </div>
                    </div>

                    <div className="p-1 space-y-0.5">
                      <button
                        onClick={() => {
                          navigateToTab('account');
                          setUserDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                          activeTab === 'account'
                            ? 'bg-[#111A2A] text-white font-medium'
                            : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        <Activity className="w-3.5 h-3.5 text-slate-400" />
                        <span>Customer Dashboard</span>
                      </button>

                      <button
                        onClick={() => {
                          navigateToTab('payment');
                          setUserDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                          activeTab === 'payment'
                            ? 'bg-[#111A2A] text-white font-medium'
                            : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                        <span>Submit Payment</span>
                      </button>
                    </div>

                    <div className="p-1">
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          handleLogout();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5 text-rose-400" />
                        <span>Log out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Notice / Feedback */}
      {feedback && (
        <div
          role="status"
          className={`border-b py-2.5 px-4 text-xs transition-colors ${
            feedback.type === 'success'
              ? 'bg-emerald-950/70 text-emerald-200 border-emerald-800/80'
              : feedback.type === 'error'
              ? 'bg-rose-950/70 text-rose-200 border-rose-800/80'
              : 'bg-[#0D1422] text-slate-200 border-white/10'
          }`}
        >
          <div className="max-w-[1280px] mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : feedback.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-white px-2 py-0.5 ml-4"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 w-full">
        {/* ========================================================================= */}
        {/* 0. PUBLIC LANDING PAGE (MINIMALIST EDITORIAL CINEMATIC HERO)             */}
        {/* ========================================================================= */}
        {activeTab === 'home' && (
          <div className="space-y-24 pb-20">
            {/* Full-screen Hero Section with full-bleed video background */}
            <div className="relative min-h-[92vh] flex flex-col justify-center items-center text-center px-6 overflow-hidden border-b border-white/[0.08] bg-[#070B14]">
              {/* Full-bleed Video Background Layer */}
              <div className="absolute inset-0 -z-10 overflow-hidden bg-slate-950">
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-cover opacity-45 filter brightness-90"
                  src="https://designerstephen.github.io/public-assets/videos/serene-art-hero.mp4"
                />
                {/* Subtle dark overlay for perfect text legibility (alpha 0.35 to 0.70) */}
                <div className="absolute inset-0 bg-gradient-to-b from-[#070B14]/85 via-[#070B14]/65 to-[#070B14]" />
              </div>

              {/* Content Area: Centered vertically and horizontally. Max-width: 1280px */}
              <div className="max-w-[1280px] mx-auto w-full py-24 sm:py-32 flex flex-col items-center">
                {/* Category Pill / Accent */}
                <div
                  className="animate-fade-rise inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full border border-white/15 bg-black/60 backdrop-blur-md text-xs font-mono text-slate-300 mb-8"
                  style={{ animationDelay: '0s' }}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="tracking-wide">ShiPu WhatsApp Daemon · 2.0 Commercial Suite</span>
                </div>

                {/* Heading: 'Instrument Serif' H1, 80px size (mobile 48px), line-height: 0.95, and tight letter-spacing: -2.46px */}
                <h1
                  className="animate-fade-rise font-serif-display text-[48px] sm:text-[68px] lg:text-[80px] leading-[0.95] tracking-[-2.46px] font-normal text-white max-w-4xl mx-auto"
                  style={{ animationDelay: '0s' }}
                >
                  WhatsApp automation, <em className="not-italic text-emerald-400 font-normal">uncompromised</em> & autonomous.
                </h1>

                {/* Paragraph: Max-width 670px, centered. Line-height: 1.625. Color: text-slate-300 */}
                <p
                  className="animate-fade-rise mt-8 max-w-[670px] mx-auto text-base sm:text-[18px] leading-[1.625] text-slate-300 font-normal"
                  style={{ animationDelay: '0.2s' }}
                >
                  Manage your ShiPu daemon service, commercial subscription periods, mobile remittances via bKash & Nagad, and active Termux sessions from one unified portal.
                </p>

                {/* Main CTA: Large pill-shaped button (padding: 20px 56px, 16px Medium font weight, placed 48px below text) */}
                <div
                  className="animate-fade-rise mt-12 flex flex-wrap items-center justify-center gap-4"
                  style={{ animationDelay: '0.4s' }}
                >
                  {!currentUser ? (
                    <button
                      onClick={() => {
                        setRegError('');
                        setActiveTab('register');
                      }}
                      className="pill-action px-14 py-5 text-base font-medium border border-white/20 shadow-2xl flex items-center gap-2.5"
                    >
                      <span>Get Started</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => setActiveTab('account')}
                      className="pill-action px-14 py-5 text-base font-medium border border-white/20 shadow-2xl flex items-center gap-2.5"
                    >
                      <span>Open Customer Dashboard</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => setActiveTab('pricing')}
                    className="rounded-full px-10 py-5 text-base font-medium bg-white/10 hover:bg-white/15 text-white backdrop-blur border border-white/15 transition-transform duration-300 hover:scale-[1.03] shadow-lg flex items-center gap-2"
                  >
                    <span>View Plans</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* 1. The ShiPu WP Quad Architecture (Product Positioning) */}
            <div id="how-it-works-section" className="max-w-[1280px] mx-auto px-6 sm:px-8 space-y-12">
              <div className="text-center max-w-2xl mx-auto space-y-3">
                <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider font-semibold">
                  Architectural Foundation
                </span>
                <h2 className="font-serif-display text-3xl sm:text-4xl text-white font-normal tracking-tight">
                  How ShiPu WP connects your entire workflow
                </h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                  A seamless bridge linking the Termux daemon, commercial subscription licenses, instant mobile remittances, and customer telemetry.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Pillar 1: Product */}
                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-4 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-mono text-sm font-bold">
                    01
                  </div>
                  <div>
                    <span className="text-[11px] font-mono text-emerald-400 block uppercase font-medium">Core Product</span>
                    <h3 className="text-lg font-semibold text-white mt-1">WhatsApp Daemon</h3>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Autonomous 24/7 background listener thread running in Termux with persistent socket reconnects and contextual replies.
                  </p>
                </div>

                {/* Pillar 2: Subscription */}
                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-4 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-mono text-sm font-bold">
                    02
                  </div>
                  <div>
                    <span className="text-[11px] font-mono text-emerald-400 block uppercase font-medium">Commercial Licensing</span>
                    <h3 className="text-lg font-semibold text-white mt-1">4 Subscription Tiers</h3>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Choose from 1 Month, 3 Months, 6 Months, or 1 Year. All tiers provide identical Pro capabilities with zero feature gates.
                  </p>
                </div>

                {/* Pillar 3: Payment */}
                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-4 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-mono text-sm font-bold">
                    03
                  </div>
                  <div>
                    <span className="text-[11px] font-mono text-emerald-400 block uppercase font-medium">Settlement Flow</span>
                    <h3 className="text-lg font-semibold text-white mt-1">bKash & Nagad</h3>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Direct Send Money transfers to verified personal merchant numbers. Submit TrxID and remitter number for fast audit.
                  </p>
                </div>

                {/* Pillar 4: Account */}
                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-4 hover:border-white/20 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-mono text-sm font-bold">
                    04
                  </div>
                  <div>
                    <span className="text-[11px] font-mono text-emerald-400 block uppercase font-medium">Telemetry & Sync</span>
                    <h3 className="text-lg font-semibold text-white mt-1">Customer Dashboard</h3>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Authoritative server-side telemetry showing days remaining, rollover accumulation, token sync, and payment history.
                  </p>
                </div>
              </div>
            </div>

            {/* 2. Key Capabilities Grid */}
            <div id="features-section" className="max-w-[1280px] mx-auto px-6 sm:px-8 space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
                <div>
                  <span className="text-xs font-mono text-emerald-400 uppercase font-semibold block">Key Capabilities</span>
                  <h2 className="font-serif-display text-3xl sm:text-4xl text-white font-normal tracking-tight mt-1">
                    Engineered for high-volume WhatsApp automation
                  </h2>
                </div>
                <button
                  onClick={() => setActiveTab('pricing')}
                  className="pill-action px-6 py-2.5 text-xs font-semibold border border-white/20 shadow-md shrink-0"
                >
                  Explore Pricing →
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-2">
                  <div className="text-xs font-mono text-emerald-400 font-semibold">01. CONTINUOUS UPTIME</div>
                  <div className="text-lg font-semibold text-white">24/7 Termux Daemon</div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Runs persistent background listener sessions with automated socket reconnection and zero downtime drops.
                  </p>
                </div>

                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-2">
                  <div className="text-xs font-mono text-emerald-400 font-semibold">02. UNLIMITED REPLIES</div>
                  <div className="text-lg font-semibold text-white">Zero Batch Limits</div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Commercial Pro tiers eliminate all daily rate boundaries. Handle hundreds of concurrent inquiries without throttling.
                  </p>
                </div>

                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-2">
                  <div className="text-xs font-mono text-emerald-400 font-semibold">03. ROLLOVER PROTECTION</div>
                  <div className="text-lg font-semibold text-white">Unused Days Carry Over</div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Early renewals strictly extend from your active expiration timestamp. You never forfeit a single paid calendar day.
                  </p>
                </div>

                <div className="border border-white/[0.08] rounded-2xl p-6 bg-[#0D1422] space-y-2">
                  <div className="text-xs font-mono text-emerald-400 font-semibold">04. DIRECT SETTLEMENT</div>
                  <div className="text-lg font-semibold text-white">bKash & Nagad</div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Transparent Send Money transfers audited directly against official operator merchant statements with prompt verification.
                  </p>
                </div>
              </div>
            </div>

            {/* 3. Pricing Preview on Landing (The 4 Official Plans) */}
            <div className="max-w-[1280px] mx-auto px-6 sm:px-8 space-y-8">
              <div className="border border-white/[0.08] rounded-3xl p-8 sm:p-12 bg-[#0D1422] space-y-10">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 border-b border-white/[0.08] pb-8">
                  <div className="space-y-2">
                    <span className="text-xs font-mono text-emerald-400 uppercase font-semibold">
                      Transparent Commercial Licensing
                    </span>
                    <h2 className="font-serif-display text-3xl sm:text-4xl text-white font-normal tracking-tight">
                      Choose your subscription period
                    </h2>
                    <p className="text-xs sm:text-sm text-[#94A3B8] max-w-xl leading-relaxed">
                      All plans include the complete ShiPu feature set. Product capabilities remain identical across all tiers.
                    </p>
                  </div>

                  <button
                    onClick={() => setActiveTab('pricing')}
                    className="pill-action px-6 py-3 text-xs font-semibold border border-white/20 shadow-md shrink-0 flex items-center gap-2"
                  >
                    <span>View All Plans</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {PRICING_TIERS.map((tier) => (
                    <div
                      key={tier.id}
                      onClick={() => handleSelectPlan(tier.id)}
                      className="p-6 rounded-2xl border border-white/[0.08] bg-[#070B14] hover:border-white/25 transition-all cursor-pointer flex flex-col justify-between space-y-6 relative group"
                    >
                      {tier.highlightBadge && (
                        <div className="absolute -top-3 left-6">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wide bg-emerald-500 text-slate-950 uppercase font-mono shadow-sm">
                            {tier.highlightBadge}
                          </span>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-white text-base">{tier.name}</span>
                          <span className="text-[#94A3B8] font-mono">{tier.cadence}</span>
                        </div>

                        <div className="border-y border-white/[0.06] py-4 space-y-1">
                          <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-bold font-mono text-white tabular-nums">৳{tier.priceTk}</span>
                            <span className="text-xs text-[#94A3B8]">/{tier.durationDays}d</span>
                          </div>
                          <div className="text-xs font-mono text-emerald-400">
                            {tier.savings || 'Standard license'}
                          </div>
                        </div>

                        <p className="text-xs text-[#94A3B8] leading-relaxed">
                          Complete access to autonomous WhatsApp replies with zero artificial rate boundary.
                        </p>
                      </div>

                      <button
                        type="button"
                        className="pill-action w-full py-3 text-xs font-semibold border border-white/10 group-hover:border-white/30 text-center"
                      >
                        Select Plan →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 4. Payment Coordinates Box */}
            <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
              <div className="border border-white/[0.08] rounded-2xl p-8 bg-[#0D1422] flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-800 text-[11px] text-emerald-300 font-mono">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Direct Send Money Settlement</span>
                  </div>
                  <h3 className="font-serif-display text-2xl sm:text-3xl font-normal text-white">
                    Pay via bKash or Nagad Personal
                  </h3>
                  <p className="text-xs text-[#94A3B8] max-w-xl leading-relaxed">
                    Send exact subscription fees to <strong className="text-white font-mono">01316655254</strong> (bKash) or <strong className="text-white font-mono">01945971168</strong> (Nagad), then submit your TrxID for prompt operator audit.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => copyToClipboard('01316655254', 'bkash_hero')}
                    className="rounded-full px-5 py-2.5 text-xs font-mono bg-[#070B14] hover:bg-[#111A2A] text-slate-200 border border-white/10 transition-colors"
                  >
                    {copiedKey === 'bkash_hero' ? 'bKash Copied ✓' : 'Copy bKash: 01316655254'}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToClipboard('01945971168', 'nagad_hero')}
                    className="rounded-full px-5 py-2.5 text-xs font-mono bg-[#070B14] hover:bg-[#111A2A] text-slate-200 border border-white/10 transition-colors"
                  >
                    {copiedKey === 'nagad_hero' ? 'Nagad Copied ✓' : 'Copy Nagad: 01945971168'}
                  </button>
                </div>
              </div>
            </div>

            {/* 5. Customer Dashboard Preview */}
            <div className="max-w-[1280px] mx-auto px-6 sm:px-8 space-y-6">
              <div className="text-center max-w-2xl mx-auto space-y-2">
                <span className="text-xs font-mono text-emerald-400 uppercase font-semibold">Client Telemetry</span>
                <h3 className="font-serif-display text-3xl font-normal text-white">
                  Real-time customer dashboard
                </h3>
                <p className="text-xs text-[#94A3B8]">
                  Subscribers enjoy a private, authoritative portal showing exact validity timestamps, quota meters, and receipt history.
                </p>
              </div>

              <div className="border border-white/[0.08] rounded-2xl p-6 sm:p-8 bg-[#0D1422] space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-[#070B14] border border-white/5 space-y-1">
                    <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-mono">Status</span>
                    <span className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Active Pro License
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-[#070B14] border border-white/5 space-y-1">
                    <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-mono">Plan Duration</span>
                    <span className="text-sm font-semibold text-white">6 Months (180 Days)</span>
                  </div>
                  <div className="p-4 rounded-xl bg-[#070B14] border border-white/5 space-y-1">
                    <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-mono">Days Remaining</span>
                    <span className="text-lg font-bold font-mono text-white tabular-nums">177 Days</span>
                  </div>
                  <div className="p-4 rounded-xl bg-[#070B14] border border-white/5 space-y-1">
                    <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-mono">Rollover Status</span>
                    <span className="text-xs text-slate-300 font-medium">Protected (Monotonic)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 6. FAQs */}
            <div className="max-w-[1280px] mx-auto px-6 sm:px-8 space-y-8">
              <div className="space-y-2">
                <span className="text-xs font-mono text-emerald-400 uppercase font-semibold">Common Queries</span>
                <h3 className="font-serif-display text-3xl font-normal text-white">Frequently Asked Questions</h3>
                <p className="text-xs text-[#94A3B8]">Operational details regarding licensing, rollover, and mobile verification.</p>
              </div>

              <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                {FAQS.map((faq, idx) => {
                  const isExpanded = expandedFaqIndex === idx;
                  return (
                    <div key={idx} className="py-4">
                      <button
                        onClick={() => setExpandedFaqIndex(isExpanded ? null : idx)}
                        className="w-full flex justify-between items-center text-left text-sm font-medium text-white hover:text-emerald-400 transition-colors gap-4"
                      >
                        <span>{faq.q}</span>
                        <ChevronDown
                          className={`w-4 h-4 text-[#94A3B8] shrink-0 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180 text-emerald-400' : ''
                          }`}
                        />
                      </button>
                      {isExpanded && (
                        <div className="pt-2 text-xs text-[#94A3B8] leading-relaxed pr-8">
                          {faq.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 7. Documentation Callout */}
            <div className="max-w-[1280px] mx-auto px-6 sm:px-8">
              <div className="border border-white/[0.08] rounded-3xl p-8 sm:p-12 bg-gradient-to-r from-[#0D1422] to-[#070B14] flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="space-y-3">
                  <span className="text-xs font-mono text-emerald-400 uppercase font-semibold">Ready to launch?</span>
                  <h3 className="font-serif-display text-3xl font-normal text-white">
                    Read the complete ShiPu WP Documentation
                  </h3>
                  <p className="text-xs text-[#94A3B8] max-w-lg leading-relaxed">
                    Learn how to install Python in Termux, clone the repository, pair your WhatsApp session, and execute <code>python -m tool.start</code>.
                  </p>
                </div>

                <button
                  onClick={() => setActiveTab('docs')}
                  className="pill-action px-8 py-3.5 text-xs font-semibold border border-white/20 shadow-md shrink-0 flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  <span>Open Documentation</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Outer container for all other tabs */}
        {activeTab !== 'home' && (
          <div className="max-w-[1280px] mx-auto px-6 sm:px-8 py-12">

        {/* ========================================================================= */}
        {/* 1. PUBLIC PRICING PAGE                                                    */}
        {/* ========================================================================= */}
        {activeTab === 'pricing' && (
          <div className="space-y-16">
            <div className="space-y-3">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider block font-mono">
                Commercial Subscription Tiers
              </span>
              <h1 className="font-serif-display text-4xl sm:text-5xl font-normal tracking-tight text-white text-balance">
                Choose your ShiPu plan
              </h1>
              <p className="text-[#94A3B8] text-sm leading-relaxed max-w-2xl">
                Choose a subscription period that fits your usage. All plans include the complete ShiPu feature set
                and activate after payment verification.
              </p>
            </div>

            {/* 4 Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
              {PRICING_TIERS.map((tier) => {
                const isSelected = selectedPlanId === tier.id;
                const isPopular = tier.highlightBadge === 'MOST POPULAR';
                return (
                  <div
                    key={tier.id}
                    onClick={() => setSelectedPlanId(tier.id)}
                    className={`rounded-xl border p-6 flex flex-col justify-between transition-all duration-200 cursor-pointer relative ${
                      isSelected
                        ? 'bg-[#111A2A] border-emerald-500 shadow-sm'
                        : isPopular
                        ? 'bg-[#0D1422] border-white/20 hover:border-white/30'
                        : 'bg-[#0D1422] border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    {tier.highlightBadge && (
                      <div className="absolute -top-3 left-6">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wide bg-emerald-500 text-slate-950 uppercase font-mono shadow-sm">
                          {tier.highlightBadge}
                        </span>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center">
                          <h3 className="font-semibold text-base text-white">{tier.name}</h3>
                          <span className="text-xs text-[#94A3B8] font-mono">{tier.cadence}</span>
                        </div>
                      </div>

                      <div className="border-y border-white/[0.06] py-4 space-y-1">
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold tracking-tight text-white tabular-nums font-mono">
                            ৳{tier.priceTk}
                          </span>
                          <span className="text-xs text-[#94A3B8]">{tier.periodLabel}</span>
                        </div>
                        <div className="text-xs font-mono">
                          {tier.savings ? (
                            <span className="text-emerald-400 font-medium">{tier.savings}</span>
                          ) : (
                            <span className="text-[#94A3B8]">30-day subscription</span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-[#94A3B8] leading-relaxed">
                        Full access to automated AI WhatsApp assistant replies with zero artificial throttles.
                      </p>
                    </div>

                    <div className="pt-6">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectPlan(tier.id);
                        }}
                        className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                          isSelected
                            ? 'bg-emerald-400 text-slate-950 hover:bg-emerald-300'
                            : 'bg-[#111A2A] text-slate-200 hover:bg-slate-800 hover:text-white border border-white/10'
                        }`}
                      >
                        <span>{isSelected ? 'Selected ✓' : 'Select Plan'}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Every Plan Includes */}
            <div className="border border-white/[0.08] rounded-xl p-8 bg-[#0D1422] space-y-6">
              <div className="space-y-1 border-b border-white/[0.08] pb-4">
                <h3 className="text-base font-semibold text-white">Every ShiPu plan includes</h3>
                <p className="text-xs text-[#94A3B8]">
                  Product capabilities remain identical across all tiers. You only choose the duration that matches your timeline.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 text-xs text-slate-300">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Unlimited AI Replies</span>
                  </div>
                  <p className="text-[#94A3B8] text-[11px] leading-relaxed pl-6">
                    Zero artificial batch throttles or message limits for all incoming WhatsApp discussions.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Continuous Service Uptime</span>
                  </div>
                  <p className="text-[#94A3B8] text-[11px] leading-relaxed pl-6">
                    Designed to run seamlessly via Termux daemon in the background with persistent reconnection.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Remaining Validity Carries Over</span>
                  </div>
                  <p className="text-[#94A3B8] text-[11px] leading-relaxed pl-6">
                    Unused days roll over automatically upon renewal. You never forfeit paid time when renewing early.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Pay via bKash or Nagad</span>
                  </div>
                  <p className="text-[#94A3B8] text-[11px] leading-relaxed pl-6">
                    Direct Send Money transfers to verified personal merchant numbers with prompt settlement.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Account Usage Dashboard</span>
                  </div>
                  <p className="text-[#94A3B8] text-[11px] leading-relaxed pl-6">
                    Real-time server-side tracking of active plan status, remaining calendar days, and token sync.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Direct Payment Verification</span>
                  </div>
                  <p className="text-[#94A3B8] text-[11px] leading-relaxed pl-6">
                    Safe manual verification against official operator records. No recurring unexpected credit deductions.
                  </p>
                </div>
              </div>
            </div>

            {/* Payment Coordinates Box */}
            <div className="border border-white/[0.08] rounded-xl p-6 bg-[#0D1422] flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-white">Payment & Verification Flow</h4>
                <p className="text-xs text-[#94A3B8]">
                  Send Money to bKash (<span className="font-mono text-slate-200">01316655254</span>) or Nagad (<span className="font-mono text-slate-200">01945971168</span>), then submit your TrxID for instant activation.
                </p>
              </div>

              <button
                onClick={() => handleSelectPlan(selectedPlanId)}
                className="px-5 py-2.5 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-semibold transition-colors shrink-0 flex items-center gap-2"
              >
                <span>Continue to Payment</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* FAQs */}
            <div className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-xl font-semibold text-white">Frequently Asked Questions</h3>
                <p className="text-xs text-[#94A3B8]">Common inquiries regarding subscriptions, rollover, and verification.</p>
              </div>

              <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
                {FAQS.map((faq, idx) => {
                  const isExpanded = expandedFaqIndex === idx;
                  return (
                    <div key={idx} className="py-4">
                      <button
                        onClick={() => setExpandedFaqIndex(isExpanded ? null : idx)}
                        className="w-full flex justify-between items-center text-left text-sm font-medium text-white hover:text-emerald-400 transition-colors gap-4"
                      >
                        <span>{faq.q}</span>
                        <ChevronDown
                          className={`w-4 h-4 text-[#94A3B8] shrink-0 transition-transform duration-200 ${
                            isExpanded ? 'rotate-180 text-emerald-400' : ''
                          }`}
                        />
                      </button>
                      {isExpanded && (
                        <div className="pt-2 text-xs text-[#94A3B8] leading-relaxed pr-8">
                          {faq.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* LOGIN SCREEN                                                             */}
        {/* ========================================================================= */}
        {activeTab === 'login' && (
          <div className="max-w-md mx-auto py-8">
            <div className="border border-white/[0.08] rounded-2xl p-8 bg-[#0D1422] space-y-6 shadow-xl">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center bg-[#111A2A] border border-white/10 mx-auto">
                  <img
                    src="https://shipu.c0m.in/assets/logo-edae341e.png"
                    alt="ShiPu WP"
                    className="w-8 h-8 object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <h2 className="font-serif-display text-3xl font-normal text-white tracking-tight">Welcome back</h2>
                <p className="text-xs text-[#94A3B8]">Log in to your ShiPu account.</p>
              </div>

              {loginError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Email or Username
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      placeholder="e.g. your_username or email@domain.com"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-slate-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-slate-200">Password</label>
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(!showForgotPassword)}
                      className="text-[11px] text-emerald-400 hover:underline transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-slate-500 font-mono"
                    />
                  </div>
                  {showForgotPassword && (
                    <div className="mt-2.5 p-3 rounded-lg bg-[#070B14] border border-white/10 text-xs text-[#94A3B8] space-y-1">
                      <p className="font-semibold text-white">Password Recovery</p>
                      <p className="leading-relaxed">
                        To recover or reset your password, contact our desk via WhatsApp (
                        <span className="font-mono text-emerald-400">01316655254</span> /{' '}
                        <span className="font-mono text-emerald-400">01945971168</span>) with your registered email and username to verify account ownership.
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2.5 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>Log in</span>
                  </button>
                </div>
              </form>

              <div className="border-t border-white/[0.08] pt-4 text-center text-xs text-[#94A3B8]">
                <span>Don't have an account? </span>
                <button
                  onClick={() => {
                    setRegError('');
                    setActiveTab('register');
                  }}
                  className="text-emerald-400 hover:underline font-semibold"
                >
                  Register
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* REGISTER SCREEN                                                          */}
        {/* ========================================================================= */}
        {activeTab === 'register' && (
          <div className="max-w-md mx-auto py-8">
            <div className="border border-white/[0.08] rounded-2xl p-8 bg-[#0D1422] space-y-6 shadow-xl">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center bg-[#111A2A] border border-white/10 mx-auto">
                  <img
                    src="https://shipu.c0m.in/assets/logo-edae341e.png"
                    alt="ShiPu WP"
                    className="w-8 h-8 object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <h2 className="font-serif-display text-3xl font-normal text-white tracking-tight">Create your ShiPu account</h2>
                <p className="text-xs text-[#94A3B8]">Start your automated WhatsApp journey today.</p>
              </div>

              {regError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{regError}</span>
                </div>
              )}

              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Name / Username <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. rahim_wp"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-slate-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 block mt-1">3–32 characters (letters, numbers, _ -)</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Email Address <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="name@domain.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-slate-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Password <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="At least 6 characters"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-slate-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Confirm Password <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Confirm your password"
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-slate-500 font-mono"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-2.5 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>Create Account</span>
                  </button>
                </div>
              </form>

              <div className="border-t border-white/[0.08] pt-4 text-center text-xs text-[#94A3B8]">
                <span>Already have an account? </span>
                <button
                  onClick={() => {
                    setLoginError('');
                    setActiveTab('login');
                  }}
                  className="text-emerald-400 hover:underline font-semibold"
                >
                  Log in
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PROTECTED: PAYMENT SUBMISSION / CHECKOUT                                 */}
        {/* ========================================================================= */}
        {activeTab === 'payment' && currentUser && (
          <div className="max-w-2xl mx-auto space-y-10">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              {[
                { step: 1, label: 'Plan' },
                { step: 2, label: 'Payment' },
                { step: 3, label: 'Submit Details' },
                { step: 4, label: 'Verification' },
              ].map((s) => (
                <div key={s.step} className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full text-[11px] font-mono flex items-center justify-center font-bold ${
                      checkoutStep === s.step
                        ? 'bg-emerald-400 text-slate-950'
                        : checkoutStep > s.step
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'bg-[#111A2A] text-slate-500'
                    }`}
                  >
                    {checkoutStep > s.step ? '✓' : s.step}
                  </div>
                  <span
                    className={`text-xs ${
                      checkoutStep === s.step ? 'font-semibold text-white' : 'text-[#94A3B8]'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-[#0D1422] border border-white/[0.08] rounded-xl p-5 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-[#94A3B8] block">Selected Subscription</span>
                <span className="font-semibold text-white text-sm">
                  {selectedPlan.name} ({selectedPlan.durationDays} Days)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="bg-[#070B14] border border-white/10 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                >
                  {PRICING_TIERS.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} — ৳{tier.priceTk}
                    </option>
                  ))}
                </select>
                <div className="text-right pl-3 border-l border-white/[0.08]">
                  <span className="text-[10px] text-[#94A3B8] block">Payable</span>
                  <span className="font-mono font-bold text-white text-sm tabular-nums">
                    ৳{selectedPlan.priceTk}
                  </span>
                </div>
              </div>
            </div>

            {checkoutStep <= 2 && (
              <div className="border border-white/[0.08] rounded-xl p-6 bg-[#0D1422] space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-white">Step 2: Transfer via Send Money</h3>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    Send ৳{selectedPlan.priceTk} to your preferred mobile wallet using Send Money.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div
                    onClick={() => setSelectedMethod('bkash')}
                    className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                      selectedMethod === 'bkash'
                        ? 'bg-[#111A2A] border-emerald-500/80 shadow-sm'
                        : 'bg-[#070B14] border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-white">bKash (Send Money)</span>
                      {selectedMethod === 'bkash' && (
                        <span className="text-[10px] font-semibold text-emerald-400">Selected</span>
                      )}
                    </div>
                    <div className="font-mono text-sm text-slate-200 mb-2">01316655254</div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard('01316655254', 'bkash_pay');
                      }}
                      className="text-[11px] text-[#94A3B8] hover:text-white transition-colors"
                    >
                      {copiedKey === 'bkash_pay' ? 'Number Copied' : 'Click to copy number'}
                    </button>
                  </div>

                  <div
                    onClick={() => setSelectedMethod('nagad')}
                    className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                      selectedMethod === 'nagad'
                        ? 'bg-[#111A2A] border-emerald-500/80 shadow-sm'
                        : 'bg-[#070B14] border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold text-white">Nagad (Send Money)</span>
                      {selectedMethod === 'nagad' && (
                        <span className="text-[10px] font-semibold text-emerald-400">Selected</span>
                      )}
                    </div>
                    <div className="font-mono text-sm text-slate-200 mb-2">01945971168</div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard('01945971168', 'nagad_pay');
                      }}
                      className="text-[11px] text-[#94A3B8] hover:text-white transition-colors"
                    >
                      {copiedKey === 'nagad_pay' ? 'Number Copied' : 'Click to copy number'}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setCheckoutStep(3)}
                    className="w-full py-3 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
                  >
                    <span>I have completed the payment →</span>
                  </button>
                </div>
              </div>
            )}

            {checkoutStep === 3 && (
              <form onSubmit={handlePaymentSubmit} className="border border-white/[0.08] rounded-xl p-6 bg-[#0D1422] space-y-5">
                <div className="border-b border-white/[0.08] pb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Step 3: Submit Verification Details</h3>
                    <p className="text-xs text-[#94A3B8] mt-0.5">
                      Logged in as <strong className="text-white">{currentUser.username}</strong> ({currentUser.email})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckoutStep(2)}
                    className="text-xs text-[#94A3B8] hover:text-white"
                  >
                    ← Back to Numbers
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    1. Termux Account Username <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. rahim_wp"
                    value={termuxUsernameInput}
                    onChange={(e) => setTermuxUsernameInput(e.target.value)}
                    className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-slate-500 font-mono"
                  />
                  <span className="text-[11px] text-[#94A3B8] block mt-1">
                    The identifier you see in Termux upon tool startup.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    2. Remitter Phone Number <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 01712345678"
                    value={senderNumberInput}
                    onChange={(e) => setSenderNumberInput(e.target.value)}
                    className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-slate-500 font-mono"
                  />
                  <span className="text-[11px] text-[#94A3B8] block mt-1">
                    The mobile wallet number from which you initiated the Send Money transfer.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    3. Transaction ID (TrxID) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BKA792019X"
                    value={transactionIdInput}
                    onChange={(e) => setTransactionIdInput(e.target.value)}
                    className="w-full bg-[#070B14] border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-slate-500 font-mono uppercase"
                  />
                  <span className="text-[11px] text-[#94A3B8] block mt-1">
                    Received in operator SMS after successful remittance.
                  </span>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>Submit Payment</span>
                  </button>
                </div>
              </form>
            )}

            {checkoutStep === 4 && lastSubmittedPayment && (
              <div className="border border-white/[0.08] rounded-xl p-8 bg-[#0D1422] space-y-6">
                <div className="space-y-1 border-b border-white/[0.08] pb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                    <h3 className="text-base font-semibold text-white">Payment Submitted — Pending Verification</h3>
                  </div>
                  <p className="text-xs text-[#94A3B8]">
                    We will update your account once verification against the merchant statement is complete.
                  </p>
                </div>

                <div className="bg-[#070B14] p-4 rounded-lg border border-white/10 space-y-2.5 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Payment Record ID:</span>
                    <span className="text-white font-semibold">{lastSubmittedPayment.paymentId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Transaction ID (TrxID):</span>
                    <span className="text-white font-semibold uppercase">{lastSubmittedPayment.transactionId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Account User:</span>
                    <span className="text-white">{currentUser.username}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Remitter Phone:</span>
                    <span className="text-white">{lastSubmittedPayment.senderNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Amount / Duration:</span>
                    <span className="text-emerald-400 font-bold">
                      ৳{lastSubmittedPayment.amount} · {lastSubmittedPayment.plan.durationDays} Days
                    </span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setActiveTab('account')}
                    className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold text-xs transition-colors"
                  >
                    Go to Dashboard
                  </button>
                  <button
                    onClick={() => setCheckoutStep(2)}
                    className="py-2.5 px-4 rounded-lg border border-white/10 bg-[#111A2A] hover:bg-slate-800 text-slate-200 text-xs font-medium transition-colors"
                  >
                    Submit Another Payment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* PROTECTED: ACCOUNT DASHBOARD                                              */}
        {/* ========================================================================= */}
        {activeTab === 'account' && currentUser && (
          <div className="max-w-4xl mx-auto space-y-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Account Usage & Subscription</h1>
                <p className="text-xs text-[#94A3B8] mt-0.5">Authoritative telemetry, daily quota, rollover status, and payment history.</p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={syncAccountData}
                  disabled={isLoading}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 bg-[#0D1422] hover:bg-[#111A2A] text-xs font-medium text-slate-200 hover:text-white transition-colors flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Sync Account</span>
                </button>
                <button
                  onClick={() => setActiveTab('pricing')}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-semibold transition-colors"
                >
                  Renew / Upgrade
                </button>
                <button
                  onClick={handleLogout}
                  className="px-3.5 py-1.5 rounded-lg border border-rose-800/60 bg-rose-950/20 hover:bg-rose-950/50 text-xs font-medium text-rose-300 hover:text-rose-200 transition-colors flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>

            {/* Dashboard Telemetry Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="bg-[#0D1422] border border-white/[0.08] rounded-xl p-5 space-y-1">
                <span className="text-[11px] text-[#94A3B8] font-medium block">Account Identifier</span>
                <span className="text-base font-semibold text-white font-mono block truncate">
                  {currentUser.username}
                </span>
                <span className="text-[10px] text-slate-500 font-mono block truncate">{currentUser.email}</span>
              </div>

              <div className="bg-[#0D1422] border border-white/[0.08] rounded-xl p-5 space-y-1">
                <span className="text-[11px] text-[#94A3B8] font-medium block">Subscription</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      currentUser.plan === 'pro' ? 'bg-emerald-400' : 'bg-slate-400'
                    }`}
                  />
                  <span className="text-base font-semibold text-white capitalize">
                    {currentUser.plan === 'pro' ? 'Pro Commercial' : 'Free Tier'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block capitalize">
                  {currentUser.status === 'active' ? 'Active Entitlement' : 'Standard Quota'}
                </span>
              </div>

              <div className="bg-[#0D1422] border border-white/[0.08] rounded-xl p-5 space-y-1">
                <span className="text-[11px] text-[#94A3B8] font-medium block">Days Remaining</span>
                <span className="text-xl font-bold text-white font-mono tabular-nums block">
                  {currentUser.plan === 'pro' ? `${currentUser.daysRemaining || 0} Days` : 'Standard Free'}
                </span>
                <span className="text-[10px] text-emerald-400 font-mono block">
                  {currentUser.plan === 'pro' ? 'Unlimited Processing' : '25 Replies / Day'}
                </span>
              </div>

              <div className="bg-[#0D1422] border border-white/[0.08] rounded-xl p-5 space-y-1">
                <span className="text-[11px] text-[#94A3B8] font-medium block">Expiry Date</span>
                <span className="text-base font-semibold text-white font-mono tabular-nums block">
                  {currentUser.expiresAt
                    ? new Date(currentUser.expiresAt).toLocaleDateString()
                    : 'Standard Free Tier'}
                </span>
                <span className="text-[10px] text-slate-400 block">Rollover enabled</span>
              </div>
            </div>

            {/* Daily Usage Progress Meter (Free Tier) */}
            {currentUser.plan !== 'pro' && (
              <div className="bg-[#0D1422] border border-white/[0.08] rounded-xl p-5 space-y-3">
                <div className="flex justify-between items-center text-xs text-slate-300">
                  <span className="font-medium">Free Tier Daily Reply Allocation</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {currentUser.usage?.repliesUsed || 0} / 25 Used
                  </span>
                </div>
                <div className="w-full bg-[#070B14] h-2 rounded-full overflow-hidden border border-white/10">
                  <div
                    className="bg-emerald-400 h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        ((currentUser.usage?.repliesUsed || 0) / 25) * 100
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-[#94A3B8]">
                  Resets daily at 00:00 UTC. Upgrading to a paid plan unlocks unlimited conversational threads.
                </p>
              </div>
            )}

            {/* Real User Payment History */}
            <div className="border border-white/[0.08] rounded-xl bg-[#0D1422] overflow-hidden">
              <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Your Payment Records</h3>
                <button
                  onClick={fetchUserPayments}
                  className="text-xs text-[#94A3B8] hover:text-white flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh</span>
                </button>
              </div>
              {userPayments.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No payment records found for this account yet.
                </div>
              ) : (
                <div className="overflow-x-auto font-mono text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-[#070B14] text-[#94A3B8] uppercase text-[10px] tracking-wider border-b border-white/[0.08]">
                      <tr>
                        <th className="py-2.5 px-4">Date</th>
                        <th className="py-2.5 px-4">Method & TrxID</th>
                        <th className="py-2.5 px-4">Plan / Amount</th>
                        <th className="py-2.5 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {userPayments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 px-4 text-[#94A3B8]">
                            {new Date(p.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="uppercase text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 mr-2">
                              {p.method}
                            </span>
                            <span className="text-white">{p.transactionId}</span>
                          </td>
                          <td className="py-2.5 px-4">
                            ৳{p.amount} · {p.durationDays || 30} Days
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`text-[10px] font-semibold uppercase ${
                                p.status === 'verified'
                                  ? 'text-emerald-400'
                                  : p.status === 'rejected'
                                  ? 'text-rose-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PUBLIC: DOCUMENTATION TAB                                                 */}
        {/* ========================================================================= */}
        {activeTab === 'docs' && (
          <div className="max-w-4xl mx-auto space-y-10">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white">Documentation & Operations</h1>
              <p className="text-xs text-[#94A3B8]">Operational architecture, commands, and subscription mechanics.</p>
            </div>

            <div className="space-y-6 text-xs text-slate-300">
              <div className="border border-white/[0.08] rounded-xl p-6 bg-[#0D1422] space-y-3">
                <h4 className="text-sm font-semibold text-white">1. Getting Started</h4>
                <p className="text-[#94A3B8] leading-relaxed">
                  ShiPu WP pairs a background Termux automated listener with our backend subscription platform.
                  Ensure your phone has Termux installed with Python and access to WhatsApp Web pairing.
                </p>
                <div className="bg-[#070B14] p-3 rounded-lg border border-white/10 font-mono text-[11px] text-slate-300">
                  pkg update && pkg install python git<br />
                  git clone https://github.com/AdiBhaiAlpha/shipu-wp-web<br />
                  python -m tool.start
                </div>
              </div>

              <div className="border border-white/[0.08] rounded-xl p-6 bg-[#0D1422] space-y-3">
                <h4 className="text-sm font-semibold text-white">2. Essential Commands</h4>
                <div className="space-y-2">
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <code className="text-emerald-400 font-mono">[R] Refresh</code>
                    <span className="text-[#94A3B8]">Synchronizes subscription status and remaining quota</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <code className="text-emerald-400 font-mono">[P] Purchase</code>
                    <span className="text-[#94A3B8]">Generates checkout session link directly to portal</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <code className="text-emerald-400 font-mono">[Q] Quit</code>
                    <span className="text-[#94A3B8]">Cleanly shuts down listener thread</span>
                  </div>
                </div>
              </div>

              <div className="border border-white/[0.08] rounded-xl p-6 bg-[#0D1422] space-y-3">
                <h4 className="text-sm font-semibold text-white">3. Renewal Rollover Invariant</h4>
                <p className="text-[#94A3B8] leading-relaxed">
                  The subscription arithmetic strictly guarantees that renewals never delete paid calendar days.
                  Active time is monotonically extended:
                </p>
                <pre className="p-3 bg-[#070B14] border border-white/10 rounded-lg font-mono text-[11px] text-emerald-400 overflow-x-auto">
                  newExpiry = Math.max(currentExpiresAt, nowMs) + (durationDays * 86400000);
                </pre>
              </div>

              <div className="border border-white/[0.08] rounded-xl p-6 bg-[#0D1422] space-y-3">
                <h4 className="text-sm font-semibold text-white">4. Troubleshooting & FAQ</h4>
                <p className="text-[#94A3B8] leading-relaxed">
                  If your Termux client displays free tier quota after making a payment, press <strong>[R]</strong> to
                  refresh token headers or verify your TrxID status in the Dashboard tab.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PROTECTED: ADMIN SETTLEMENT LEDGER (PIN CODE 2448766 REQUIRED)            */}
        {/* ========================================================================= */}
        {activeTab === 'admin' && !isAdminPinUnlocked && (
          <div className="max-w-md mx-auto my-12 p-8 rounded-2xl bg-[#0D1422] border border-white/10 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">Admin Portal Authentication</h2>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                Enter your 7-digit PIN code to manage merchant settlements, customer orders, and registered accounts.
              </p>
            </div>

            <form onSubmit={handleAdminPinSubmit} className="space-y-4">
              {adminPinError && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{adminPinError}</span>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Security PIN Code</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={adminPinInput}
                    onChange={(e) => setAdminPinInput(e.target.value)}
                    placeholder="Enter PIN code"
                    maxLength={10}
                    className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#070B14] border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-500/80 tracking-widest font-mono"
                    autoFocus
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                <span>Unlock Admin Dashboard</span>
              </button>
            </form>
          </div>
        )}

        {activeTab === 'admin' && isAdminPinUnlocked && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-white">Merchant Settlement & Order Console</h1>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    PIN Verified
                  </span>
                </div>
                <p className="text-xs text-[#94A3B8] mt-0.5">Full authoritative management for bKash & Nagad payments and user accounts.</p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={fetchAdminData}
                  disabled={isLoading}
                  className="px-3.5 py-1.5 rounded-lg border border-white/10 bg-[#0D1422] hover:bg-[#111A2A] text-xs font-medium text-slate-200 hover:text-white transition-colors flex items-center gap-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh Queue</span>
                </button>
                <button
                  onClick={handleAdminLock}
                  className="px-3.5 py-1.5 rounded-lg border border-rose-900/60 bg-rose-950/30 hover:bg-rose-950/60 text-xs font-medium text-rose-300 transition-colors flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Lock Session</span>
                </button>
              </div>
            </div>

            {/* KPI Matrix */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              {[
                { label: 'Total Users', val: adminStats?.totalUsers ?? '-' },
                { label: 'Free Tier', val: adminStats?.freeUsers ?? '-' },
                { label: 'Pro Licensees', val: adminStats?.proUsers ?? '-' },
                { label: 'Pending Queue', val: adminStats?.pendingPayments ?? '-' },
                { label: 'Verified Total', val: adminStats?.verifiedPayments ?? '-' },
                { label: 'Rejected Records', val: adminStats?.rejectedPayments ?? '-' },
              ].map((kpi, idx) => (
                <div key={idx} className="bg-[#0D1422] border border-white/[0.08] rounded-lg p-3">
                  <span className="text-[10px] text-[#94A3B8] block">{kpi.label}</span>
                  <span className="text-lg font-semibold text-white font-mono mt-0.5 block tabular-nums">
                    {kpi.val}
                  </span>
                </div>
              ))}
            </div>

            {/* Section Switcher */}
            <div className="flex border-b border-white/10 gap-6 text-sm">
              <button
                onClick={() => setAdminViewSection('payments')}
                className={`pb-3 font-medium transition-colors relative ${
                  adminViewSection === 'payments' ? 'text-white' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                <span>Orders & Payments ({adminPayments.length})</span>
                {adminViewSection === 'payments' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
                )}
              </button>
              <button
                onClick={() => setAdminViewSection('users')}
                className={`pb-3 font-medium transition-colors relative ${
                  adminViewSection === 'users' ? 'text-white' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                <span>Registered Users ({adminUsers.length})</span>
                {adminViewSection === 'users' && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400 rounded-full" />
                )}
              </button>
            </div>

            {adminViewSection === 'payments' && (
              <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-[#0D1422] space-y-0">
                <div className="p-3.5 border-b border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[#94A3B8]">Status:</span>
                    {['all', 'pending', 'verified', 'rejected'].map((st) => (
                      <button
                        key={st}
                        onClick={() => setAdminFilter(st)}
                        className={`px-2.5 py-1 rounded text-xs capitalize transition-colors ${
                          adminFilter === st
                            ? 'bg-[#111A2A] text-white font-medium border border-white/10'
                            : 'text-[#94A3B8] hover:text-white'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <div className="w-full sm:w-64">
                    <input
                      type="text"
                      placeholder="Search TrxID, Phone, User..."
                      value={adminSearchQuery}
                      onChange={(e) => setAdminSearchQuery(e.target.value)}
                      className="w-full px-3 py-1.5 bg-[#070B14] border border-white/10 rounded-lg text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-500/80"
                    />
                  </div>
                </div>

                {adminPayments.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    No payment records found under status filter: {adminFilter}
                  </div>
                ) : (
                  <div className="overflow-x-auto font-mono text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-[#070B14] text-[#94A3B8] uppercase text-[10px] tracking-wider border-b border-white/[0.08]">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">Record ID</th>
                          <th className="py-2.5 px-4 font-medium">Account / Termux</th>
                          <th className="py-2.5 px-4 font-medium">Remitter Phone</th>
                          <th className="py-2.5 px-4 font-medium">Method & TrxID</th>
                          <th className="py-2.5 px-4 font-medium">Amount / Days</th>
                          <th className="py-2.5 px-4 font-medium">Status</th>
                          <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {adminPayments
                          .filter((p) => {
                            if (!adminSearchQuery.trim()) return true;
                            const q = adminSearchQuery.toLowerCase();
                            return (
                              p.transactionId?.toLowerCase().includes(q) ||
                              p.senderNumber?.toLowerCase().includes(q) ||
                              p.termuxUsername?.toLowerCase().includes(q) ||
                              p.username?.toLowerCase().includes(q)
                            );
                          })
                          .map((p) => (
                            <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                              <td className="py-3 px-4 text-[#94A3B8]">{p.id}</td>
                              <td className="py-3 px-4 font-semibold text-white">
                                {p.username}
                                <span className="text-[10px] text-slate-500 block">({p.termuxUsername})</span>
                              </td>
                              <td className="py-3 px-4 text-slate-300 tabular-nums">{p.senderNumber || '-'}</td>
                              <td className="py-3 px-4">
                                <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 mr-2">
                                  {p.method}
                                </span>
                                <span className="text-white font-semibold">{p.transactionId}</span>
                              </td>
                              <td className="py-3 px-4 tabular-nums">
                                <span className="text-emerald-400 font-bold">৳{p.amount}</span>
                                <span className="text-[10px] text-[#94A3B8] block">{p.durationDays || 30} Days</span>
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                                    p.status === 'verified'
                                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/80'
                                      : p.status === 'rejected'
                                      ? 'bg-rose-950 text-rose-300 border border-rose-800/80'
                                      : 'bg-amber-950 text-amber-300 border border-amber-800/80'
                                  }`}
                                >
                                  {p.status}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right">
                                {p.status === 'pending' ? (
                                  <div className="flex items-center justify-end gap-2 font-sans">
                                    <button
                                      onClick={() => handleAdminVerify(p.id, p.durationDays || 30)}
                                      disabled={isLoading}
                                      className="px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-[11px] transition-colors shadow-sm"
                                    >
                                      Verify & Activate
                                    </button>
                                    <button
                                      onClick={() => handleAdminReject(p.id)}
                                      disabled={isLoading}
                                      className="px-2.5 py-1 rounded border border-rose-800/80 text-rose-300 hover:bg-rose-950/60 font-medium text-[11px] transition-colors"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-slate-500 text-[11px] font-sans">
                                    {p.status === 'verified' ? 'Verified & Activated' : 'Rejected'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {adminViewSection === 'users' && (
              <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-[#0D1422]">
                <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between gap-3 text-xs">
                  <span className="text-white font-medium">Database User Directory</span>
                  <span className="text-[11px] text-[#94A3B8]">{adminUsers.length} total registered accounts</span>
                </div>

                {adminUsers.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">No registered accounts in database.</div>
                ) : (
                  <div className="overflow-x-auto font-mono text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-[#070B14] text-[#94A3B8] uppercase text-[10px] tracking-wider border-b border-white/[0.08]">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">User ID</th>
                          <th className="py-2.5 px-4 font-medium">Username</th>
                          <th className="py-2.5 px-4 font-medium">Email</th>
                          <th className="py-2.5 px-4 font-medium">Current Plan</th>
                          <th className="py-2.5 px-4 font-medium">Subscription Status</th>
                          <th className="py-2.5 px-4 font-medium">Expires At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {adminUsers.map((u) => (
                          <tr key={u.uid} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 px-4 text-slate-400">{u.uid}</td>
                            <td className="py-3 px-4 font-semibold text-white">{u.username}</td>
                            <td className="py-3 px-4 text-slate-300">{u.email}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                  u.plan === 'pro'
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {u.plan === 'pro' ? 'Pro Commercial' : 'Free Tier'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-slate-300 capitalize">
                              {u.subscription?.status || 'none'}
                            </td>
                            <td className="py-3 px-4 text-slate-300 tabular-nums">
                              {u.subscription?.expiresAt
                                ? new Date(u.subscription.expiresAt).toLocaleDateString('en-GB', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })
                                : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
          </div>
        )}
      </main>

      {/* Corporate Minimalist Footer */}
      <footer className="border-t border-white/[0.08] bg-[#070B14] py-12 text-xs text-[#94A3B8] mt-16">
        <div className="max-w-[1280px] mx-auto px-6 sm:px-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center bg-[#0D1422] border border-white/10 shrink-0">
                  <img
                    src="https://shipu.c0m.in/assets/logo-edae341e.png"
                    alt="ShiPu WP Logo"
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <span className="font-serif-display text-2xl font-normal text-white">ShiPu WP</span>
                <sup className="text-[10px] text-slate-500 font-sans">®</sup>
              </div>
              <p className="text-[11px] leading-relaxed text-[#94A3B8]">
                WhatsApp conversational AI automation infrastructure for individuals and commercial operations.
              </p>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs block">Product</span>
              <ul className="space-y-1 text-[11px]">
                <li>
                  <button onClick={() => setActiveTab('pricing')} className="hover:text-white transition-colors">
                    Plans & Pricing
                  </button>
                </li>
                <li>
                  <button onClick={() => navigateToTab('account')} className="hover:text-white transition-colors">
                    Account Dashboard
                  </button>
                </li>
                <li>
                  <button onClick={() => setActiveTab('docs')} className="hover:text-white transition-colors">
                    Documentation
                  </button>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs block">Settlement & Verification</span>
              <ul className="space-y-1 text-[11px]">
                <li>bKash Personal: 01316655254</li>
                <li>Nagad Personal: 01945971168</li>
                <li>Verification ETA: 5–30 Mins</li>
              </ul>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-white text-xs block">Trust & Policy</span>
              <ul className="space-y-1 text-[11px] text-[#94A3B8]">
                <li>Monotonic Rollover Protection</li>
                <li>No Hidden Recurring Debits</li>
                <li>Manual Operator Auditing</li>
                <li>Strict Data Privacy</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px]">
            <span>© 2026 ShiPu WP. All rights reserved.</span>
            <div className="flex items-center gap-6">
              <span className="hover:text-white cursor-pointer">Terms of Service</span>
              <span className="hover:text-white cursor-pointer">Privacy Policy</span>
              <span className="hover:text-white cursor-pointer">Refund Policy</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
