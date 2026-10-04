"use client";

import { useState, useRef } from "react";
import { useWallet } from "../lib/wallet/context";
import { usePrivy, useLoginWithEmail, type User } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import { toast } from "sonner";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export type OnboardingStep =
  | "AUTH_CHOICE"     // Step 1: Choose between Email (Privy) or Phantom / Existing Wallet
  | "EMAIL_INPUT"     // Step 1b: User enters email address
  | "OTP_VERIFY"      // Step 1c: User enters 6-digit OTP sent by Privy
  | "CREATING_WALLET" // Step 2: Privy generates & links embedded Solana wallet
  | "ACCOUNT_READY";  // Step 3: Confirmation with real address & 3 rules of Kolo

export function OnboardingModal({ isOpen, onClose, onSuccess }: OnboardingModalProps) {
  const { connectors, connect, wallet } = useWallet();
  const { ready: isPrivyReady, authenticated, user } = usePrivy();
  const { createWallet } = useCreateWallet();

  const [step, setStep] = useState<OnboardingStep>("AUTH_CHOICE");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [isCreatingSolanaWallet, setIsCreatingSolanaWallet] = useState(false);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Privy Email OTP authentication hook
  const { sendCode, loginWithCode, state: otpState } = useLoginWithEmail({
    onComplete: async ({ user: privyUser, isNewUser }: { user: User; isNewUser: boolean }) => {
      setErrorMessage(null);
      setStep("CREATING_WALLET");
      setIsCreatingSolanaWallet(true);

      try {
        // Look for existing Solana embedded wallet in Privy user account
        const accounts = (privyUser.linkedAccounts || []) as Array<{
          type: string;
          chainType?: string;
          address?: string;
        }>;
        const existingSolanaAccount = accounts.find(
          (acc) => acc.type === "wallet" && acc.chainType === "solana"
        );

        if (existingSolanaAccount?.address) {
          setSolanaAddress(existingSolanaAccount.address);
          setStep("ACCOUNT_READY");
          toast.success(isNewUser ? "Solana savings wallet created!" : "Welcome back to Kolo!");
        } else {
          // Explicitly create Solana embedded wallet if not automatically provisioned
          const newWallet = await createWallet();
          if (newWallet?.wallet?.address) {
            setSolanaAddress(newWallet.wallet.address);
          }
          setStep("ACCOUNT_READY");
          toast.success("Solana savings wallet created successfully!");
        }
      } catch (err: unknown) {
        console.error("Error securing Solana embedded wallet:", err);
        // Fallback: check if linked accounts has the address
        const accounts = (privyUser.linkedAccounts || []) as Array<{
          type: string;
          chainType?: string;
          address?: string;
        }>;
        const fallbackAccount = accounts.find(
          (acc) => acc.type === "wallet" && acc.chainType === "solana"
        );

        if (fallbackAccount?.address) {
          setSolanaAddress(fallbackAccount.address);
        }
        setStep("ACCOUNT_READY");
      } finally {
        setIsCreatingSolanaWallet(false);
      }
    },
    onError: (error) => {
      console.error("Privy authentication error:", error);
      const friendlyMsg =
        typeof error === "string"
          ? error
          : (error as { message?: string })?.message ||
            "Authentication failed. Please verify the code and try again.";
      setErrorMessage(friendlyMsg);
      toast.error(friendlyMsg);
    },
  });

  // Track connected Phantom / Solana wallet adapter address if already connected
  // (address is derived from wallet in render, no setState needed)

  // Sync address from Privy if user is already authenticated
  // (address is derived from user in render, no setState needed)

  if (!isOpen) return null;

  // Handle Phantom Connect button with robust try/catch
  const handlePhantomConnect = async () => {
    setErrorMessage(null);
    const phantom =
      connectors.find(
        (c) => c.name.toLowerCase().includes("phantom") || c.id.toLowerCase().includes("phantom")
      ) || connectors[0];

    if (phantom) {
      try {
        await connect(phantom.id);
        toast.success("Phantom wallet connected successfully!");
        setStep("ACCOUNT_READY");
      } catch (err: unknown) {
        console.error("Phantom connection rejected or failed:", err);
        const errStr = err instanceof Error ? err.message : "Connection failed";
        setErrorMessage("Phantom connection was canceled or failed. Please approve the prompt.");
        toast.error(`Phantom Error: ${errStr}`);
      }
    } else {
      toast.info("Phantom extension not detected. Use email login to create an instant seedless wallet.");
      setStep("EMAIL_INPUT");
    }
  };

  // Handle Email Form Submission: Only shows success if sendCode resolves cleanly
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      const errorText = "Please enter a valid email address.";
      setErrorMessage(errorText);
      toast.error(errorText);
      return;
    }

    try {
      // Must await sendCode — will throw if network error, invalid app ID, or rate limited
      await sendCode({ email: trimmedEmail });

      // Only reached on confirmed success:
      setErrorMessage(null);
      setStep("OTP_VERIFY");
      toast.success(`Verification code sent to ${trimmedEmail}`);
    } catch (err: unknown) {
      console.error("Failed to send verification code via Privy:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Unable to send verification code. Please check your connection and try again.";
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Handle OTP digit changes & auto-focus next input
  const handleOtpChange = (index: number, val: string) => {
    if (!/^\d*$/.test(val)) return; // numbers only
    const updated = [...otp];
    updated[index] = val.slice(-1);
    setOtp(updated);

    if (val && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // Handle OTP Verification submission: Explicit error catching and state management
  const handleOtpVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage(null);

    const fullCode = otp.join("").trim();
    if (fullCode.length !== 6) {
      const errorText = "Please enter the complete 6-digit verification code.";
      setErrorMessage(errorText);
      toast.error(errorText);
      return;
    }

    try {
      // Triggers Privy loginWithCode; success is handled in onComplete callback
      await loginWithCode({ code: fullCode });
    } catch (err: unknown) {
      console.error("Failed to verify code with Privy:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Invalid or expired code. Please check the code or request a new one.";
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  // Resend OTP handler: Only shows success if resend resolves cleanly
  const handleResendCode = async () => {
    if (!email) return;
    setErrorMessage(null);
    try {
      await sendCode({ email });
      setOtp(["", "", "", "", "", ""]);
      toast.success(`New verification code sent to ${email}`);
    } catch (err: unknown) {
      console.error("Failed to resend verification code:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Could not resend code. Please try again in a moment.";
      setErrorMessage(msg);
      toast.error(msg);
    }
  };

  const isSendingEmail = otpState.status === "sending-code";
  const isVerifyingOtp = otpState.status === "submitting-code" || isCreatingSolanaWallet;
  const activeAddress = solanaAddress || wallet?.account.address || "Generating address...";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-6 md:p-8 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-2 text-slate-400 hover:text-white transition rounded-full hover:bg-white/5"
          aria-label="Close modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Brand Header */}
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-black text-base shadow-inner">
            K
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-tight text-white">KOLO SAVINGS</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Solana Ajo / ROSCA
              </span>
            </div>
          </div>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2 animate-in fade-in duration-150">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 1: AUTH CHOICE                                                       */}
        {/* ========================================================================= */}
        {step === "AUTH_CHOICE" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-white">
                Start Saving with Your Circle
              </h2>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                Save money in rotating groups, earn lump-sum payouts on schedule, and build financial trust on Solana.
              </p>
            </div>

            {/* Zero-Crypto Entry: Email Authentication via Privy */}
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-3.5 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Recommended for Beginners
                </span>
                <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                  Zero Seed Phrase
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Continue with Email Login</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  We securely generate an embedded Solana wallet linked to your email. No extensions required.
                </p>
              </div>
              <button
                id="btn-onboarding-email-choice"
                onClick={() => {
                  setErrorMessage(null);
                  setStep("EMAIL_INPUT");
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 font-bold text-sm py-3.5 px-4 shadow-lg shadow-emerald-950 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Continue with Email
              </button>
            </div>

            <div className="relative flex items-center justify-center my-2">
              <div className="border-t border-white/10 w-full" />
              <span className="bg-slate-950 px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                Or Connect Wallet
              </span>
              <div className="border-t border-white/10 w-full" />
            </div>

            {/* Phantom & Standard Web3 Wallets */}
            <div className="space-y-2.5">
              <button
                id="btn-onboarding-phantom-connect"
                onClick={handlePhantomConnect}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-purple-500/40 bg-purple-950/20 hover:bg-purple-900/30 transition group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center text-white text-base shadow">
                    👻
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-1.5">
                      Phantom Connect
                      <span className="text-[10px] font-normal text-purple-300 px-1.5 py-0.5 rounded bg-purple-500/20">
                        Browser / Mobile
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">Connect your existing Solana wallet</div>
                  </div>
                </div>
                <span className="text-sm text-purple-400 group-hover:translate-x-1 transition font-bold">
                  &rarr;
                </span>
              </button>

              {connectors
                .filter((c) => !c.name.toLowerCase().includes("phantom"))
                .slice(0, 2)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={async () => {
                      setErrorMessage(null);
                      try {
                        await connect(c.id);
                        setStep("ACCOUNT_READY");
                      } catch (e) {
                        toast.error(`Failed to connect ${c.name}`);
                      }
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-left"
                  >
                    <div className="flex items-center gap-3">
                      {c.icon ? (
                        <img src={c.icon} alt="" className="w-5 h-5 rounded" />
                      ) : (
                        <div className="w-5 h-5 rounded bg-slate-700" />
                      )}
                      <span className="text-xs font-semibold text-white">{c.name}</span>
                    </div>
                    <span className="text-xs text-slate-400">&rarr;</span>
                  </button>
                ))}
            </div>

            <p className="text-[11px] text-center text-slate-500 leading-normal">
              Protected by non-custodial smart contracts. You retain 100% control of your funds at all times.
            </p>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 1b: EMAIL INPUT                                                      */}
        {/* ========================================================================= */}
        {step === "EMAIL_INPUT" && (
          <form onSubmit={handleEmailSubmit} className="space-y-6">
            <div>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setStep("AUTH_CHOICE");
                }}
                className="text-xs font-semibold text-slate-400 hover:text-white flex items-center gap-1.5 mb-3 transition"
              >
                &larr; Back to options
              </button>
              <h2 className="text-2xl font-black text-white">Enter your email</h2>
              <p className="mt-1.5 text-xs text-slate-400">
                We&rsquo;ll send a 6-digit one-time passcode to verify your email and provision your seedless Solana wallet.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <input
                id="input-onboarding-email"
                type="email"
                required
                autoFocus
                disabled={isSendingEmail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
              />
            </div>

            <button
              id="btn-onboarding-send-code"
              type="submit"
              disabled={isSendingEmail || !email}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/50 disabled:cursor-not-allowed text-slate-950 font-bold text-sm py-3.5 px-4 transition shadow-lg shadow-emerald-950 flex items-center justify-center gap-2"
            >
              {isSendingEmail ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Sending Passcode...
                </>
              ) : (
                "Send Verification Code"
              )}
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* STEP 1c: OTP VERIFY                                                       */}
        {/* ========================================================================= */}
        {step === "OTP_VERIFY" && (
          <div className="space-y-6">
            <div>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setStep("EMAIL_INPUT");
                }}
                className="text-xs font-semibold text-slate-400 hover:text-white flex items-center gap-1.5 mb-3 transition"
              >
                &larr; Change email address
              </button>
              <h2 className="text-2xl font-black text-white">Check your inbox</h2>
              <p className="mt-1 text-xs text-slate-400">
                Enter the 6-digit verification code sent to{" "}
                <span className="font-semibold text-white">{email}</span>
              </p>
            </div>

            {/* 6 Digit OTP Input Grid */}
            <div className="flex justify-between gap-2">
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => {
                    otpInputRefs.current[idx] = el;
                  }}
                  id={`input-otp-${idx}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  disabled={isVerifyingOtp}
                  value={digit}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  className="w-12 h-14 text-center text-xl font-mono font-bold rounded-xl border border-white/10 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50 transition"
                />
              ))}
            </div>

            <button
              id="btn-onboarding-verify-otp"
              type="button"
              disabled={isVerifyingOtp || otp.join("").length < 6}
              onClick={() => handleOtpVerify()}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/50 disabled:cursor-not-allowed text-slate-950 font-bold text-sm py-3.5 px-4 transition shadow-lg shadow-emerald-950 flex items-center justify-center gap-2"
            >
              {isVerifyingOtp ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Verifying Code...
                </>
              ) : (
                "Verify & Create Wallet"
              )}
            </button>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <span>Didn&rsquo;t receive the code?</span>
              <button
                type="button"
                onClick={handleResendCode}
                className="font-semibold text-emerald-400 hover:underline transition"
              >
                Resend code
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 2: CREATING WALLET ANIMATION                                         */}
        {/* ========================================================================= */}
        {step === "CREATING_WALLET" && (
          <div className="py-10 text-center space-y-5 animate-in fade-in duration-300">
            <div className="relative w-20 h-20 mx-auto rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shadow-lg shadow-emerald-950">
              <div className="absolute inset-0 rounded-3xl bg-emerald-500/20 animate-ping opacity-25" />
              <svg className="w-10 h-10 text-emerald-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white">Generating Your Kolo Wallet</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Creating your non-custodial Solana keypair through Privy. No seed phrases to write down — protected by secure multi-party computation.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 text-emerald-400 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Provisioning Solana Account...
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 3: ACCOUNT READY & KOLO EXPLANATION                                  */}
        {/* ========================================================================= */}
        {step === "ACCOUNT_READY" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="text-center space-y-1.5">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center text-2xl font-black shadow-inner mb-2">
                ✓
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight">Your Wallet is Ready!</h2>
              <p className="text-xs text-slate-400">
                You&rsquo;re ready to join rotating savings circles and build financial discipline on-chain.
              </p>
            </div>

            {/* Real Solana Address Card */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                  Your Solana Savings Address
                </span>
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live on Devnet
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 bg-slate-950 p-3 rounded-xl border border-white/5 font-mono text-xs text-emerald-300 break-all select-all">
                <span>{activeAddress}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(activeAddress);
                    toast.success("Wallet address copied to clipboard!");
                  }}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition shrink-0"
                  title="Copy address"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 3 Rules of Kolo UX Educational Component */}
            <div className="space-y-2.5">
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                How Kolo Circles Work (The 3 Rules):
              </span>
              <div className="grid gap-2 text-xs">
                <div className="flex gap-3 items-start p-3 rounded-xl bg-slate-900 border border-white/5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    1
                  </div>
                  <div>
                    <span className="font-bold text-white">Lock Collateral Stake</span>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      Deposit 1x contribution as collateral when joining. 100% refunded to you upon completing all rounds.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 items-start p-3 rounded-xl bg-slate-900 border border-white/5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    2
                  </div>
                  <div>
                    <span className="font-bold text-white">Contribute Every Round</span>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      Pay your fixed round contribution (e.g. 50 USDC) before the round deadline to keep your circle healthy.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 items-start p-3 rounded-xl bg-slate-900 border border-white/5">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-xs">
                    3
                  </div>
                  <div>
                    <span className="font-bold text-white">Receive Your Lump Sum</span>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      When your round turn arrives, the smart vault automatically releases the full collected pot directly to your wallet.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Final CTA */}
            <button
              id="btn-onboarding-complete-cta"
              type="button"
              onClick={() => {
                onClose();
                if (onSuccess) onSuccess();
              }}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm py-3.5 px-4 shadow-lg shadow-emerald-950 transition text-center"
            >
              Explore & Join Circles &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
