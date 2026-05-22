import React, { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { ShieldCheck, Plus, Trash2, Edit, Save, X, User, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getPermissionMeta } from '../lib/permissionLabels';

const AVAILABLE_PERMISSIONS = [
  'all_permissions',
  'manage.admins',
  'settings.view',
  'settings.write',
  'console.view',
  'console.write',
  'control.server',
  'announcement',
  'commands.resources',
  'server.cfg.editor',
  'txadmin.log.view',
  'server.log.view',
  'menu.vehicle',
  'menu.clear_area',
  'menu.viewids',
  'players.direct_message',
  'players.whitelist',
  'players.warn',
  'players.kick',
  'players.ban',
  'players.freeze',
  'players.heal',
  'players.playermode',
  'players.spectate',
  'players.teleport',
  'players.troll',
  'database.read',
  'database.write',
  'database.admin',
];

interface Role {
  id: string;
  name: string;
  permissions: string[];
  isOwner?: boolean;
}

interface PlatformUser {
  id: string;
  username: string;
  roleId: string;
  role?: string;
  identifiers?: string[];
  enabled?: boolean;
  isOwner?: boolean;
}

interface LinkedIdentity {
  id: string;
  adminId: string;
  adminUsername: string;
  provider: 'cfx';
  providerUserId: string;
  displayName: string;
  identifiers: string[];
}

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [rolePendingDelete, setRolePendingDelete] = useState<Role | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [newAdmin, setNewAdmin] = useState({ username: '', password: '', roleId: '' });
  const [identifierDrafts, setIdentifierDrafts] = useState<Record<string, string>>({});
  const [adminLoading, setAdminLoading] = useState(false);
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [identityLoading, setIdentityLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('provider') !== 'cfx') return;
    const status = params.get('status');
    const reason = params.get('reason');
    if (status === 'linked') {
      toast.success('Cfx identity linked');
      fetchData();
    } else if (status === 'error') {
      toast.error(reason || 'Cfx identity flow failed');
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rolesData, usersData] = await Promise.all([
        apiFetch('/roles'),
        apiFetch('/platform-users')
      ]);
      setRoles(rolesData);
      setUsers(usersData);
      setIdentifierDrafts(Object.fromEntries(usersData.map((user: PlatformUser) => [user.id, (user.identifiers || []).join('\n')])));
      const identityResponse = await apiFetch('/auth/identities');
      setIdentities(identityResponse.identities || []);
    } catch (err) {
      toast.error('Failed to load roles and users');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRole = async () => {
    if (!editingRole) return;
    try {
      if (isCreating) {
        const newRole = await apiFetch('/roles', {
          method: 'POST',
          body: JSON.stringify(editingRole)
        });
        setRoles(prev => [...prev, newRole]);
        toast.success(`Role ${newRole.name} created`);
      } else {
        const updatedRole = await apiFetch(`/roles/${editingRole.id}`, {
          method: 'PUT',
          body: JSON.stringify(editingRole)
        });
        setRoles(prev => prev.map(r => r.id === updatedRole.id ? updatedRole : r));
        toast.success(`Role updated`);
      }
      setEditingRole(null);
      setIsCreating(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save role');
    }
  };

  const handleDeleteRole = async () => {
    if (!rolePendingDelete) return;
    setDeleteLoading(true);
    try {
      await apiFetch(`/roles/${rolePendingDelete.id}`, { method: 'DELETE' });
      setRoles(prev => prev.filter(r => r.id !== rolePendingDelete.id));
      toast.success('Role deleted');
      setRolePendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete role');
    } finally {
      setDeleteLoading(false);
    }
  };

  const togglePermission = (perm: string) => {
    if (!editingRole) return;
    setEditingRole(prev => {
      if (!prev) return prev;
      const hasPerm = prev.permissions.includes(perm);
      let newPerms = hasPerm 
        ? prev.permissions.filter(p => p !== perm)
        : [...prev.permissions, perm];
      
      return { ...prev, permissions: newPerms };
    });
  };

  const handleAssignRole = async (userId: string, targetRoleId: string) => {
    try {
      await apiFetch(`/platform-users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ roleId: targetRoleId })
      });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, roleId: targetRoleId } : u));
      toast.success('User role updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user role');
    }
  };

  const handleSaveIdentifiers = async (userId: string) => {
    try {
      const identifiers = (identifierDrafts[userId] || '')
        .split(/\r?\n|,/)
        .map(identifier => identifier.trim())
        .filter(Boolean);
      const updated = await apiFetch(`/platform-users/${userId}/identifiers`, {
        method: 'PUT',
        body: JSON.stringify({ identifiers }),
      });
      setUsers(prev => prev.map(user => user.id === userId ? updated : user));
      setIdentifierDrafts(prev => ({ ...prev, [userId]: (updated.identifiers || []).join('\n') }));
      toast.success('Admin identifiers updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update identifiers');
    }
  };

  const handleCreateAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdminLoading(true);
    try {
      const created = await apiFetch('/platform-users', {
        method: 'POST',
        body: JSON.stringify(newAdmin),
      });
      setUsers(prev => [...prev, created]);
      setNewAdmin({ username: '', password: '', roleId: '' });
      toast.success(`Admin ${created.username} created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create admin');
    } finally {
      setAdminLoading(false);
    }
  };

  const handleStartIdentityLink = async (adminId: string) => {
    setIdentityLoading(true);
    try {
      const response = await apiFetch('/auth/identities/link', {
        method: 'POST',
        body: JSON.stringify({ adminId, returnTo: '/roles' }),
      });
      window.location.href = response.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start identity linking');
      setIdentityLoading(false);
    }
  };

  const handleUnlinkIdentity = async (identityId: string) => {
    setIdentityLoading(true);
    try {
      await apiFetch('/auth/identities/unlink', {
        method: 'POST',
        body: JSON.stringify({ identityId }),
      });
      setIdentities(prev => prev.filter(identity => identity.id !== identityId));
      toast.success('Identity unlinked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unlink identity');
    } finally {
      setIdentityLoading(false);
    }
  };

  if (loading && roles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
          Loading roles...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 lg:p-8 overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-zinc-800/50 mb-8">
        <div>
           <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Role Management</h1>
           <p className="text-sm text-zinc-500">Configure access levels and assign permissions to platform users.</p>
        </div>
        <div className="mt-4 sm:mt-0">
          <button 
            onClick={() => { setIsCreating(true); setEditingRole({ id: '', name: 'New Role', permissions: [] }); }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600/10 text-orange-500 border border-orange-600/20 rounded-lg text-sm font-bold tracking-wider hover:bg-orange-600/20 transition-colors uppercase"
          >
            <Plus className="w-4 h-4" /> Create Role
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Roles List */}
        <div>
          <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-orange-500" /> Existing Roles
          </h2>
          <div className="space-y-4">
            {roles.map(role => (
              <div key={role.id} className="bg-[#111] border border-zinc-800 rounded-xl p-5 shadow-sm group hover:border-zinc-700 transition-colors">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-white">{role.name}</h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => { setIsCreating(false); setEditingRole({ ...role }); }}
                      className="p-1.5 text-zinc-500 hover:text-white bg-zinc-900 border border-zinc-800 rounded transition-colors"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => setRolePendingDelete(role)}
                      disabled={role.isOwner}
                      className="p-1.5 text-zinc-500 hover:text-red-500 bg-zinc-900 border border-zinc-800 rounded hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
                      aria-label={`Delete ${role.name}`}
                      title={role.isOwner ? 'Owner role cannot be deleted' : `Delete ${role.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {role.permissions.map(p => (
                    <span key={p} className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded text-[10px] uppercase font-mono text-zinc-400">
                      {p}
                    </span>
                  ))}
                  {role.permissions.length === 0 && (
                    <span className="text-[11px] text-zinc-600 italic">No permissions assigned</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* User Assignments */}
        <div>
          <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-blue-500" /> Platform Users
          </h2>
          <form onSubmit={handleCreateAdmin} className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-[#111] p-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
            <input
              type="text"
              value={newAdmin.username}
              onChange={(event) => setNewAdmin(prev => ({ ...prev, username: event.target.value }))}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
              placeholder="Username"
              required
            />
            <input
              type="password"
              value={newAdmin.password}
              onChange={(event) => setNewAdmin(prev => ({ ...prev, password: event.target.value }))}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
              placeholder="Password (10+ chars)"
              minLength={10}
              required
            />
            <select
              value={newAdmin.roleId}
              onChange={(event) => setNewAdmin(prev => ({ ...prev, roleId: event.target.value }))}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-700"
              required
            >
              <option value="">Select role</option>
              {roles.filter(role => !role.isOwner).map(role => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={adminLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-blue-400 transition-colors hover:bg-blue-500/20 disabled:opacity-50"
            >
              {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </button>
          </form>
          <div className="bg-[#111] border border-zinc-800 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-900 border-b border-zinc-800">
                  <th className="p-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Username</th>
                  <th className="p-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Assigned Role</th>
                  <th className="p-4 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">FiveM Identifiers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="p-4 text-sm font-medium text-white">{user.username}</td>
                    <td className="p-4">
                      <select 
                        value={user.roleId}
                        onChange={(e) => handleAssignRole(user.id, e.target.value)}
                        disabled={user.isOwner}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-700 w-full max-w-[200px]"
                      >
                        <option value="" disabled>Select Role</option>
                        {roles.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <textarea
                          value={identifierDrafts[user.id] || ''}
                          onChange={(event) => setIdentifierDrafts(prev => ({ ...prev, [user.id]: event.target.value }))}
                          placeholder="license:... or discord:..."
                          className="min-h-16 w-full max-w-[260px] resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-[11px] text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveIdentifiers(user.id)}
                          className="self-start rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:border-zinc-700 hover:text-white"
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-zinc-800 bg-[#111] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">Linked Provider Identities</h2>
          {identityLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-800 text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="px-3 py-2">Admin</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Identity</th>
                <th className="px-3 py-2">Identifiers</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const identity = identities.find(item => item.adminId === user.id);
                return (
                  <tr key={user.id} className="border-b border-zinc-900">
                    <td className="px-3 py-3 text-sm text-white">{user.username}</td>
                    <td className="px-3 py-3 text-xs text-zinc-400">{identity?.provider || '-'}</td>
                    <td className="px-3 py-3 text-xs text-zinc-400">
                      {identity ? (
                        <div>
                          <div className="text-zinc-200">{identity.displayName}</div>
                          <div className="font-mono text-[10px] text-zinc-600">{identity.providerUserId}</div>
                        </div>
                      ) : 'Not linked'}
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-500">
                      {identity?.identifiers?.length ? identity.identifiers.join(', ') : '-'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {identity ? (
                        <button
                          type="button"
                          onClick={() => handleUnlinkIdentity(identity.id)}
                          disabled={identityLoading}
                          className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          Unlink
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartIdentityLink(user.id)}
                          disabled={identityLoading}
                          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                        >
                          Link Cfx
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Editor Modal */}
      {editingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#111] border border-zinc-800 rounded-xl w-full max-w-lg shadow-2xl flex flex-col shrink-0">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-orange-500" />
                {isCreating ? 'Create New Role' : 'Edit Role'}
              </h2>
              <button 
                onClick={() => { setEditingRole(null); setIsCreating(false); }}
                className="p-1 text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-6">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                  Role Name
                </label>
                <input
                  type="text"
                  value={editingRole.name}
                  onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500 transition-colors"
                  placeholder="e.g. Moderator"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">
                  Permissions
                </label>
                <div className="grid grid-cols-1 gap-2 max-h-[320px] overflow-y-auto pr-2">
                  {AVAILABLE_PERMISSIONS.map(perm => {
                    const isSelected = editingRole.permissions.includes(perm);
                    const meta = getPermissionMeta(perm);
                    return (
                      <button
                        key={perm}
                        type="button"
                        onClick={() => togglePermission(perm)}
                        className={`text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-orange-600/10 border-orange-600/30'
                            : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800'
                        }`}
                      >
                        <div className={`mt-0.5 w-3 h-3 rounded flex-shrink-0 border ${isSelected ? 'border-orange-500 bg-orange-500' : 'border-zinc-600 bg-transparent'}`} />
                        <div className="min-w-0">
                          <div className={`text-sm font-semibold ${isSelected ? 'text-orange-300' : 'text-zinc-200'}`}>{meta.label}</div>
                          <div className="text-[10px] font-mono text-zinc-600">{perm}</div>
                          <div className="mt-0.5 text-xs text-zinc-500 leading-snug">{meta.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800/50 mt-6">
                <button
                  type="button"
                  onClick={() => { setEditingRole(null); setIsCreating(false); }}
                  className="px-4 py-2 bg-transparent text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRole}
                  disabled={!editingRole.name.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white border border-zinc-800 rounded-lg text-sm font-bold tracking-wider hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" /> Save Role
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {rolePendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-lg border border-red-500/20 bg-[#101010] shadow-2xl">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-zinc-800">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Delete Role</h2>
                  <p className="mt-1 text-xs text-zinc-500 font-mono">{rolePendingDelete.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRolePendingDelete(null)}
                disabled={deleteLoading}
                className="p-1 text-zinc-500 hover:text-white transition-colors disabled:opacity-50"
                aria-label="Close confirmation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5">
              <p className="text-sm leading-relaxed text-zinc-300">
                Delete this access role from Portside. Users assigned to it may lose their expected permissions until another role is selected.
              </p>
              <div className="mt-4 rounded border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-500">
                This action is immediate after confirmation.
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setRolePendingDelete(null)}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteRole}
                disabled={deleteLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {deleteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
