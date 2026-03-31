'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authAPI } from '@/lib/api';
import Logo from '@/components/Logo';

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await authAPI.resetPasswordWithToken(token!, newPassword);
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid or expired reset link.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <Logo size="lg" />
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8 text-center">
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">Invalid reset link. Please request a new one.</p>
            <Link href="/forgot-password" className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
              Request new reset link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" />
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Real estate deal intelligence</div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">Set new password</h1>

          {success ? (
            <div className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm px-4 py-3 rounded-lg">
                Password reset successfully. You can now sign in with your new password.
              </div>
              <Link
                href="/login"
                className="block text-center text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input w-full"
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input w-full"
                  placeholder="Re-enter your password"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full mt-2"
              >
                {loading ? 'Resetting...' : 'Reset password'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
          mydealcore.com
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading...</div>
      </div>
    }>
      <ResetPasswordInner />
    </Suspense>
  );
}
