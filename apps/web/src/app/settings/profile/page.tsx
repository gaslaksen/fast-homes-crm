'use client';

import { useEffect, useState, useRef } from 'react';
import { settingsAPI } from '@/lib/api';
import AppNav from '@/components/AppNav';
import Avatar from '@/components/Avatar';

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    settingsAPI.getProfile().then(res => {
      setProfile(res.data);
      setFirstName(res.data.firstName);
      setLastName(res.data.lastName);
    }).catch(console.error);
  }, []);

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
      <div className="min-h-screen bg-gray-50">
        <AppNav />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-sm animate-pulse">Loading profile...</div>
        </div>
      </div>
    );
  }

  const displayUrl = preview || profile.avatarUrl;
  const fullName = `${firstName} ${lastName}`.trim();

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <main className="max-w-xl mx-auto px-6 py-10 space-y-8">
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>

        {/* Avatar section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Profile Photo</h2>
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
                  className="block text-sm text-gray-400 hover:text-red-500"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Name form */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">First name</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm text-gray-400 bg-gray-50"
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
      </main>
    </div>
  );
}
