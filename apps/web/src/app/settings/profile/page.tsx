'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { settingsAPI, gmailAPI, authAPI } from '@/lib/api';
import AppNav from '@/components/AppNav';
import Avatar from '@/components/Avatar';

function ProfilePageInner() {
  const [profile, setProfile] = useState<any>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    settingsAPI.getProfile().then(res => {
      setProfile(res.data);
      setFirstName(res.data.firstName);
      setLastName(res.data.lastName);
    }).catch(console.error);
    gmailAPI.status().then(res => setGmailStatus(res.data)).catch(() => {});
  }, []);

  // Show flash message if just connected/errored
  const gmailParam = searchParams.get('gmail');

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await settingsAPI.updateProfile({ firstName, lastName });
      setProfile(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to update profile:', error);
      alert('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    setPasswordSaved(false);
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setPasswordSaving(true);
    try {
      await authAPI.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err: any) {
      setPasswordError(err.response?.data?.message || 'Failed to change password');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Resize and convert to base64
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);

      try {
        const res = await settingsAPI.uploadAvatar(dataUrl);
        setProfile((p: any) => ({ ...p, avatarUrl: res.data.avatarUrl }));
        setPreview(null);
      } catch (error) {
        console.error('Failed to upload avatar:', error);
        alert('Failed to upload photo');
        setPreview(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = async () => {
    try {
      const res = await settingsAPI.updateProfile({ avatarUrl: '' });
      setProfile(res.data);
    } catch (error) {
      console.error('Failed to remove avatar:', error);
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AppNav />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading profile...</div>
        </div>
      </div>
    );
  }

  const displayUrl = preview || profile.avatarUrl;
  const fullName = `${firstName} ${lastName}`.trim();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AppNav />
      <main className="max-w-xl mx-auto px-6 py-10 space-y-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Profile</h1>

        {/* Avatar section */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Profile Photo</h2>
          <div className="flex items-center gap-5">
            <Avatar
              name={fullName || 'User'}
              avatarUrl={displayUrl}
              size="lg"
            />
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Upload photo
              </button>
              {profile.avatarUrl && (
                <button
                  onClick={handleRemovePhoto}
                  className="block text-sm text-gray-400 dark:text-gray-500 hover:text-red-500"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Name form */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">First name</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-950"
            />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Change Password</h2>
          {passwordError && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-4 py-3 rounded-lg">
              {passwordError}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
                placeholder="At least 6 characters"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleChangePassword}
              disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {passwordSaving ? 'Updating...' : 'Update password'}
            </button>
            {passwordSaved && <span className="text-sm text-green-600 font-medium">Password updated</span>}
          </div>
        </div>

        {/* Gmail Integration */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Gmail Integration</h2>
          {gmailParam === 'connected' && (
            <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400">
              Gmail connected successfully!
            </div>
          )}
          {gmailParam === 'error' && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
              Failed to connect Gmail. Please try again.
            </div>
          )}
          {gmailStatus?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 text-xs font-medium">
                  Connected
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-300">{gmailStatus.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      const res = await gmailAPI.sync();
                      alert(`Synced ${res.data.imported} emails from Gmail`);
                    } catch {
                      alert('Failed to sync inbox');
                    } finally {
                      setSyncing(false);
                    }
                  }}
                  disabled={syncing}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {syncing ? 'Syncing...' : 'Sync Inbox'}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('Disconnect Gmail? You can reconnect anytime.')) return;
                    setDisconnecting(true);
                    try {
                      await gmailAPI.disconnect();
                      setGmailStatus({ connected: false });
                    } catch {
                      alert('Failed to disconnect');
                    } finally {
                      setDisconnecting(false);
                    }
                  }}
                  disabled={disconnecting}
                  className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Connect your Gmail account to send and receive emails directly from the CRM.
              </p>
              <button
                onClick={() => {
                  const token = localStorage.getItem('auth_token');
                  window.location.href = `${gmailAPI.getAuthUrl()}?token=${token}`;
                }}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Connect Gmail
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center"><div className="text-gray-400 dark:text-gray-500 text-sm animate-pulse">Loading profile...</div></div>}>
      <ProfilePageInner />
    </Suspense>
  );
}
