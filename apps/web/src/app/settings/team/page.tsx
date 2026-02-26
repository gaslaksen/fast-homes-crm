'use client';

import { useEffect, useState } from 'react';
import AppNav from '@/components/AppNav';
import { authAPI } from '@/lib/api';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  AGENT: 'Agent',
  VIEWER: 'Viewer',
};

function getUser() {
  try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
}

export default function TeamPage() {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>({});
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', lastName: '', role: 'AGENT', tempPassword: '' });
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviting, setInviting] = useState(false);

  // Change own password
  const [showPassword, setShowPassword] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  useEffect(() => {
    setCurrentUser(getUser());
    authAPI.getTeam()
      .then(r => setMembers(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(''); setInviteSuccess(''); setInviting(true);
    try {
      await authAPI.invite(inviteForm);
      setInviteSuccess(`✅ Account created for ${inviteForm.firstName}. Share their temp password: ${inviteForm.tempPassword}`);
      setInviteForm({ email: '', firstName: '', lastName: '', role: 'AGENT', tempPassword: '' });
      const r = await authAPI.getTeam();
      setMembers(r.data);
    } catch (err: any) {
      setInviteError(err.response?.data?.message || 'Failed to create account');
    } finally {
      setInviting(false);
    }
  };

  const handleResetPassword = async (userId: string, name: string) => {
    const newPw = prompt(`New password for ${name}:`);
    if (!newPw || newPw.length < 6) return alert('Password must be at least 6 characters');
    try {
      await authAPI.resetPassword(userId, newPw);
      alert(`Password reset for ${name}. New password: ${newPw}`);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to reset password');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(''); setPwSuccess('');
    if (pwForm.newPassword !== pwForm.confirm) { setPwError('Passwords do not match'); return; }
    if (pwForm.newPassword.length < 6) { setPwError('Password must be at least 6 characters'); return; }
    try {
      await authAPI.changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwSuccess('Password changed successfully');
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err: any) {
      setPwError(err.response?.data?.message || 'Failed to change password');
    }
  };

  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav />
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="text-sm text-gray-500 mt-0.5">Quick Cash Home Buyers</p>
        </div>

        {/* Team Members */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">Members</h2>
            {isAdmin && (
              <button
                onClick={() => setShowInvite(v => !v)}
                className="btn btn-primary btn-sm"
              >
                + Add Member
              </button>
            )}
          </div>

          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400 animate-pulse">Loading...</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {members.map(m => (
                <div key={m.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-900">
                        {m.firstName} {m.lastName}
                        {m.id === currentUser?.id && <span className="text-xs text-blue-500 ml-1">(you)</span>}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        m.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' :
                        m.role === 'VIEWER' ? 'bg-gray-100 text-gray-500' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {ROLE_LABELS[m.role] || m.role}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{m.email}</div>
                  </div>
                  {isAdmin && m.id !== currentUser?.id && (
                    <button
                      onClick={() => handleResetPassword(m.id, `${m.firstName} ${m.lastName}`)}
                      className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                    >
                      Reset password
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invite / Add Member */}
        {isAdmin && showInvite && (
          <div className="bg-white rounded-xl border border-blue-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">Add Team Member</h2>
            {inviteError && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg mb-4 border border-red-200">{inviteError}</div>}
            {inviteSuccess && <div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg mb-4 border border-green-200">{inviteSuccess}</div>}
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
                  <input className="input w-full" value={inviteForm.firstName} onChange={e => setInviteForm(f => ({...f, firstName: e.target.value}))} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                  <input className="input w-full" value={inviteForm.lastName} onChange={e => setInviteForm(f => ({...f, lastName: e.target.value}))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" className="input w-full" value={inviteForm.email} onChange={e => setInviteForm(f => ({...f, email: e.target.value}))} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                  <select className="input w-full" value={inviteForm.role} onChange={e => setInviteForm(f => ({...f, role: e.target.value}))}>
                    <option value="AGENT">Agent — can view/edit leads</option>
                    <option value="ADMIN">Admin — full access</option>
                    <option value="VIEWER">Viewer — read only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Temporary Password</label>
                  <input className="input w-full" value={inviteForm.tempPassword} onChange={e => setInviteForm(f => ({...f, tempPassword: e.target.value}))} placeholder="min 6 chars" required minLength={6} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={inviting} className="btn btn-primary">{inviting ? 'Creating...' : 'Create Account'}</button>
                <button type="button" onClick={() => setShowInvite(false)} className="btn btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Change Your Own Password */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900">Change Password</h2>
            <button onClick={() => setShowPassword(v => !v)} className="text-xs text-blue-600 hover:underline">
              {showPassword ? 'Cancel' : 'Change'}
            </button>
          </div>
          {showPassword && (
            <form onSubmit={handleChangePassword} className="space-y-4">
              {pwError && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-lg border border-red-200">{pwError}</div>}
              {pwSuccess && <div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg border border-green-200">{pwSuccess}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Current Password</label>
                <input type="password" className="input w-full" value={pwForm.currentPassword} onChange={e => setPwForm(f => ({...f, currentPassword: e.target.value}))} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
                  <input type="password" className="input w-full" value={pwForm.newPassword} onChange={e => setPwForm(f => ({...f, newPassword: e.target.value}))} required minLength={6} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Confirm New Password</label>
                  <input type="password" className="input w-full" value={pwForm.confirm} onChange={e => setPwForm(f => ({...f, confirm: e.target.value}))} required />
                </div>
              </div>
              <button type="submit" className="btn btn-primary">Update Password</button>
            </form>
          )}
          {!showPassword && (
            <p className="text-sm text-gray-500">Click "Change" to update your password.</p>
          )}
        </div>

      </main>
    </div>
  );
}
