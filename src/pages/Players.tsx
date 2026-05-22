import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, FileText, Loader2, MessageSquareWarning, MoreHorizontal, RefreshCw, Search, Send, ShieldAlert, Users, X, Zap } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Select, SelectOption } from '../components/Select';
import PlayerProfileModal, { type PlayerProfile, type ProfileTab } from '../components/PlayerProfileModal';
import { apiFetch, hasPermission } from '../lib/api';
import { toast } from 'sonner';
import ConfirmModal from '../components/ConfirmModal';

const PAGE_SIZE = 50;
type ProfileFocus = 'actions' | 'dm' | null;

interface PlayerRow {
  id?: string;
  sourceId?: number | null;
  displayName: string;
  name?: string;
  ping?: number | null;
  online?: boolean;
  identifiers: string[];
  hwids?: string[];
  actionCounts?: {
    activeBans: number;
    warnings: number;
    kicks: number;
  };
}

const defaultDurations = ['1h', '24h', '3d', '1w', 'permanent'];

const playerIsOnline = (player: Pick<PlayerRow, 'online' | 'sourceId'>) => Boolean(player.online || player.sourceId);

const hasActiveBan = (player: Pick<PlayerRow, 'actionCounts'> & { actions?: any[] }) => {
  if ((player.actionCounts?.activeBans || 0) > 0) return true;
  return Boolean(player.actions?.some(action => (
    action.type === 'ban' &&
    !action.revokedAt &&
    (!action.expiresAt || new Date(action.expiresAt).getTime() > Date.now())
  )));
};

export default function Players() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [onlineFallback, setOnlineFallback] = useState<PlayerRow[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('24h');
  const [note, setNote] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [kickAllOpen, setKickAllOpen] = useState(false);
  const [kickAllReason, setKickAllReason] = useState('');
  const [kickAllConfirm, setKickAllConfirm] = useState('');
  const [openActionMenu, setOpenActionMenu] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [page, setPage] = useState(0);
  const [pendingKick, setPendingKick] = useState<PlayerRow | null>(null);
  const [pendingBan, setPendingBan] = useState<PlayerRow | null>(null);
  const [rowActionReason, setRowActionReason] = useState('');
  const [rowBanDuration, setRowBanDuration] = useState('24h');
  const [profileFocus, setProfileFocus] = useState<ProfileFocus>(null);
  const [profileTab, setProfileTab] = useState<ProfileTab>('overview');
  const profileActionsRef = useRef<HTMLElement>(null);
  const profileDmRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetchPlayers();
  }, []);

  useEffect(() => {
    if (!openActionMenu) return;
    const closeMenu = () => setOpenActionMenu('');
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openActionMenu]);

  const fetchPlayers = async () => {
    setLoading(true);
    try {
      const [knownResult, onlineResult] = await Promise.allSettled([
        apiFetch(`/moderation/players?query=${encodeURIComponent(search)}`),
        apiFetch('/players'),
      ]);

      const known = knownResult.status === 'fulfilled' && Array.isArray(knownResult.value) ? knownResult.value : [];
      const online = onlineResult.status === 'fulfilled' && Array.isArray(onlineResult.value) ? onlineResult.value : [];

      setPlayers(known);
      setOnlineFallback((Array.isArray(online) ? online : []).map((player: any) => ({
        sourceId: player.id,
        displayName: player.name,
        name: player.name,
        ping: player.ping,
        online: true,
        identifiers: player.identifiers || [],
        hwids: player.hwids || [],
      })));

      if (knownResult.status === 'rejected' && onlineResult.status === 'rejected') {
        toast.error('Failed to load players');
      }
    } catch {
      toast.error('Failed to load players');
    } finally {
      setLoading(false);
    }
  };

  const openProfile = async (player: PlayerRow, focus: ProfileFocus = null) => {
    if (!player.id) return;
    setProfileFocus(focus);
    setProfileTab(focus ? 'staff' : 'overview');
    setProfileLoading(true);
    try {
      setProfile(await apiFetch(`/moderation/players/${player.id}`));
      setReason('');
      setNote('');
      setDirectMessage('');
      setDuration('24h');
    } catch {
      toast.error('Failed to load player profile');
      setProfileFocus(null);
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (profileLoading || !profile) return;
    const target = profileFocus === 'dm' ? profileDmRef.current : profileFocus === 'actions' ? profileActionsRef.current : null;
    if (!target) return;
    window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const focusable = target.querySelector<HTMLElement>('input, textarea, select, button');
      focusable?.focus();
    }, 50);
  }, [profileLoading, profile, profileFocus]);

  useEffect(() => {
    const profileId = searchParams.get('profile');
    if (!profileId || loading) return;
    const existing = players.find(player => player.id === profileId);
    if (existing) {
      void openProfile(existing);
      setSearchParams({}, { replace: true });
      return;
    }
    void apiFetch(`/moderation/players/${profileId}`)
      .then(nextProfile => {
        setProfile(nextProfile);
        setProfileTab('overview');
        setProfileLoading(false);
        setSearchParams({}, { replace: true });
      })
      .catch(() => {
        toast.error('Failed to load player profile');
        setSearchParams({}, { replace: true });
      });
  }, [loading, players, searchParams, setSearchParams]);

  const refreshProfile = async () => {
    if (!profile?.id) return;
    setProfile(await apiFetch(`/moderation/players/${profile.id}`));
    fetchPlayers();
  };

  const runLegacyKick = async (player: PlayerRow, kickReason: string) => {
    if (!player.sourceId) return;
    setActionLoading(`kick-${player.sourceId}`);
    try {
      await apiFetch(`/players/${player.sourceId}/kick`, {
        method: 'POST',
        body: JSON.stringify({ reason: kickReason || 'Kicked by Portside' }),
      });
      toast.success('Player kicked');
      setPendingKick(null);
      setRowActionReason('');
      fetchPlayers();
    } catch {
      toast.error('Failed to kick player');
    } finally {
      setActionLoading('');
    }
  };

  const createBan = async (player: PlayerRow, banReason: string, banDuration: string) => {
    if (hasActiveBan(player)) {
      toast.error('Player already has an active ban');
      return;
    }

    setActionLoading('ban');
    try {
      if (player.id) {
        await apiFetch(`/moderation/players/${player.id}/bans`, {
          method: 'POST',
          body: JSON.stringify({ reason: banReason || 'Banned by Portside', duration: banDuration }),
        });
      } else if (player.sourceId) {
        await apiFetch(`/players/${player.sourceId}/ban`, {
          method: 'POST',
          body: JSON.stringify({ reason: banReason || 'Banned by Portside', duration: banDuration }),
        });
      }
      setPendingBan(null);
      setRowActionReason('');
      toast.success('Ban recorded');
      if (profile?.id) {
        await refreshProfile();
      } else {
        await fetchPlayers();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to ban player');
    } finally {
      setActionLoading('');
    }
  };

  const createWarning = async () => {
    if (!profile?.id) return;
    if (!playerIsOnline(profile)) {
      toast.error('Player must be online to receive a warning');
      return;
    }

    setActionLoading('warn');
    try {
      await apiFetch(`/moderation/players/${profile.id}/warnings`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Warned by Portside' }),
      });
      toast.success('Warning recorded');
      await refreshProfile();
    } catch (error: any) {
      toast.error(error.message || 'Failed to warn player');
    } finally {
      setActionLoading('');
    }
  };

  const createNote = async () => {
    if (!profile?.id || !note.trim()) return;
    setActionLoading('note');
    try {
      await apiFetch(`/moderation/players/${profile.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      toast.success('Note added');
      setNote('');
      await refreshProfile();
    } catch {
      toast.error('Failed to add note');
    } finally {
      setActionLoading('');
    }
  };

  const sendDirectMessage = async () => {
    if (!profile?.id || !directMessage.trim()) return;
    if (!playerIsOnline(profile)) {
      toast.error('Player must be online to receive a direct message');
      return;
    }

    setActionLoading('dm');
    try {
      await apiFetch(`/moderation/players/${profile.id}/direct-message`, {
        method: 'POST',
        body: JSON.stringify({ message: directMessage }),
      });
      toast.success('Direct message recorded');
      setDirectMessage('');
      await refreshProfile();
    } catch (error: any) {
      toast.error(error.message || 'Failed to send direct message');
    } finally {
      setActionLoading('');
    }
  };

  const kickAllPlayers = async () => {
    if (!kickAllReason.trim() || kickAllConfirm !== 'KICK ALL') return;
    setActionLoading('kick-all');
    try {
      const result = await apiFetch('/players/kick-all', {
        method: 'POST',
        body: JSON.stringify({ reason: kickAllReason }),
      });
      const failed = Array.isArray(result.results) ? result.results.filter((item: any) => !item.ok).length : 0;
      toast.success(failed ? `Kick-all finished with ${failed} failures` : 'Kick-all sent');
      setKickAllOpen(false);
      setKickAllReason('');
      setKickAllConfirm('');
      fetchPlayers();
    } catch {
      toast.error('Failed to kick all players');
    } finally {
      setActionLoading('');
    }
  };

  const revokeAction = async (actionId: string) => {
    setActionLoading(`revoke-${actionId}`);
    try {
      await apiFetch(`/moderation/actions/${actionId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Revoked from Portside' }),
      });
      toast.success('Action revoked');
      await refreshProfile();
    } catch {
      toast.error('Failed to revoke action');
    } finally {
      setActionLoading('');
    }
  };

  const visiblePlayers = useMemo(() => {
    const knownSourceIds = new Set(players.map(player => player.sourceId).filter(Boolean));
    const fallback = onlineFallback.filter(player => !knownSourceIds.has(player.sourceId || null));
    const combined = [...players, ...fallback];
    const query = search.trim().toLowerCase();
    if (!query) return combined;
    return combined.filter(player => [
      player.displayName,
      String(player.sourceId || ''),
      ...(player.identifiers || []),
    ].join(' ').toLowerCase().includes(query));
  }, [players, onlineFallback, search]);

  const totalPages = Math.max(1, Math.ceil(visiblePlayers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedPlayers = visiblePlayers.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [search, players.length, onlineFallback.length]);

  const profileOnline = profile ? playerIsOnline(profile) : false;
  const profileBanned = profile ? hasActiveBan(profile) : false;

  return (
    <div className="flex h-full w-full flex-1 flex-col p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-white">Players</h1>
          <p className="m-0 text-sm text-zinc-500">Search known players, review history, and record moderation actions.</p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search name, ID, identifier..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && fetchPlayers()}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-4 text-sm text-white placeholder-zinc-500 transition-colors focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div className="flex gap-2">
            {hasPermission('players.kick') && (
              <button
                type="button"
                onClick={() => setKickAllOpen(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/20 sm:flex-none"
              >
                <Users className="h-4 w-4" />
                Kick All
              </button>
            )}
            <button
              type="button"
              onClick={fetchPlayers}
              disabled={loading}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:border-zinc-700 disabled:opacity-60 sm:flex-none"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> : <RefreshCw className="h-4 w-4 text-zinc-400" />}
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-[#111] border border-zinc-800 rounded-xl overflow-hidden min-h-0">
        <div className="hidden lg:grid grid-cols-[90px_1.2fr_1.4fr_120px_160px_210px] px-6 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
          <TableHead>ID</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Identifiers</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>History</TableHead>
          <TableHead align="text-right">Actions</TableHead>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-12 text-center flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
          ) : visiblePlayers.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 text-sm">No players found yet. The monitor resource will populate durable records as players connect.</div>
          ) : (
            pagedPlayers.map(player => {
              const rowKey = player.id || `online-${player.sourceId}`;
              const rowOnline = playerIsOnline(player);
              const rowBanned = hasActiveBan(player);
              const hasRowActions = Boolean(
                player.id ||
                (hasPermission('players.warn') && player.id && rowOnline) ||
                (hasPermission('players.direct_message') && player.id && rowOnline) ||
                (hasPermission('players.kick') && player.sourceId) ||
                hasPermission('players.ban')
              );

              return (
              <div
                key={rowKey}
                role={player.id ? 'button' : undefined}
                tabIndex={player.id ? 0 : undefined}
                title={player.id ? 'Open player profile' : undefined}
                onClick={() => player.id && openProfile(player)}
                onKeyDown={(event) => {
                  if (!player.id || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  openProfile(player);
                }}
                className={`grid grid-cols-1 gap-3 border-b border-zinc-800/70 px-4 py-4 hover:bg-zinc-800/40 focus:bg-zinc-800/50 focus:outline-none lg:grid-cols-[90px_1.2fr_1.4fr_120px_160px_210px] lg:items-center lg:gap-4 lg:px-6 ${player.id ? 'cursor-pointer' : ''}`}
              >
                <div className="flex items-center justify-between lg:block lg:order-none order-2">
                  <MobileLabel>ID</MobileLabel>
                  <span className="font-mono text-xs text-zinc-500">{player.sourceId ? `#${player.sourceId}` : 'offline'}</span>
                </div>

                <div className="min-w-0 order-1 lg:order-none">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">{player.displayName || player.name}</span>
                    {(player.actionCounts?.activeBans || 0) > 0 && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-600">
                    {player.id ? 'known player' : 'online only'}
                  </div>
                </div>

                <div className="flex min-w-0 items-center justify-between gap-3 order-3 lg:order-none lg:block">
                  <MobileLabel>Identifiers</MobileLabel>
                  <span className="truncate font-mono text-[11px] text-zinc-500 lg:max-w-none">
                    {player.identifiers?.[0] || 'no identifier captured'}
                  </span>
                </div>

                <div className="flex items-center justify-between order-4 lg:order-none lg:block">
                  <MobileLabel>Status</MobileLabel>
                  <StatusBadge online={rowOnline} ping={player.ping} />
                </div>

                <div className="flex items-center justify-between order-5 lg:order-none lg:block">
                  <MobileLabel>History</MobileLabel>
                  <div className="flex gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    <span>{player.actionCounts?.activeBans || 0} bans</span>
                    <span>{player.actionCounts?.warnings || 0} warns</span>
                    <span>{player.actionCounts?.kicks || 0} kicks</span>
                  </div>
                </div>

                <div className="relative order-6 flex justify-end lg:order-none">
                  <button
                    type="button"
                    title="Player actions"
                    aria-label="Player actions"
                    aria-expanded={openActionMenu === rowKey}
                    disabled={!hasRowActions}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenActionMenu(openActionMenu === rowKey ? '' : rowKey);
                    }}
                    className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  {openActionMenu === rowKey && (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 py-1 shadow-xl lg:top-8 lg:mt-0"
                    >
                      {player.id && (
                        <MenuAction label="Open Profile" icon={<FileText className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); openProfile(player); }} />
                      )}
                      {hasPermission('players.warn') && player.id && rowOnline && (
                        <MenuAction label="Warn Player" icon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); void openProfile(player, 'actions'); }} />
                      )}
                      {hasPermission('players.direct_message') && player.id && rowOnline && (
                        <MenuAction label="Direct Message" icon={<Send className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); void openProfile(player, 'dm'); }} />
                      )}
                      {hasPermission('players.kick') && player.sourceId && (
                        <MenuAction label="Kick Player" icon={actionLoading === `kick-${player.sourceId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); setRowActionReason(''); setPendingKick(player); }} />
                      )}
                      {hasPermission('players.ban') && (
                        <MenuAction
                          danger
                          disabled={rowBanned}
                          label={rowBanned ? 'Already Banned' : 'Ban Player'}
                          icon={actionLoading === 'ban' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                          onClick={() => { setOpenActionMenu(''); setRowActionReason(''); setRowBanDuration('24h'); setPendingBan(player); }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>

        {visiblePlayers.length > PAGE_SIZE && (
          <div className="flex shrink-0 flex-col gap-3 border-t border-zinc-800 bg-zinc-900/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
            <span className="text-xs text-zinc-500">
              Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visiblePlayers.length)} of {visiblePlayers.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-xs font-bold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <span className="text-xs font-mono text-zinc-500">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                className="inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-xs font-bold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <PlayerProfileModal
        open={Boolean(profile || profileLoading)}
        loading={profileLoading}
        profile={profile}
        activeTab={profileTab}
        onTabChange={setProfileTab}
        onClose={() => {
          setProfile(null);
          setProfileFocus(null);
        }}
        profileOnline={profileOnline}
        profileBanned={profileBanned}
        reason={reason}
        onReasonChange={setReason}
        duration={duration}
        onDurationChange={setDuration}
        note={note}
        onNoteChange={setNote}
        directMessage={directMessage}
        onDirectMessageChange={setDirectMessage}
        actionLoading={actionLoading}
        onBan={() => profile && createBan(profile, reason, duration)}
        onWarn={createWarning}
        onAddNote={createNote}
        onSendDm={sendDirectMessage}
        onRevokeAction={revokeAction}
        profileActionsRef={profileActionsRef}
        profileDmRef={profileDmRef}
      />

      <ConfirmModal
        open={Boolean(pendingKick)}
        title="Kick player?"
        description={pendingKick ? `Remove ${pendingKick.displayName || pendingKick.name} from the server now.` : ''}
        confirmLabel="Kick Player"
        danger
        loading={Boolean(pendingKick?.sourceId && actionLoading === `kick-${pendingKick.sourceId}`)}
        confirmDisabled={!rowActionReason.trim()}
        onConfirm={() => pendingKick && runLegacyKick(pendingKick, rowActionReason.trim())}
        onCancel={() => { setPendingKick(null); setRowActionReason(''); }}
      >
        <input
          value={rowActionReason}
          onChange={event => setRowActionReason(event.target.value)}
          placeholder="Kick reason (required)"
          className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
        />
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(pendingBan)}
        title="Ban player?"
        description={pendingBan ? `Record a ban for ${pendingBan.displayName || pendingBan.name}. They will be blocked on next join when ban enforcement is active.` : ''}
        confirmLabel="Ban Player"
        danger
        loading={actionLoading === 'ban'}
        confirmDisabled={!rowActionReason.trim()}
        onConfirm={() => pendingBan && createBan(pendingBan, rowActionReason.trim(), rowBanDuration)}
        onCancel={() => { setPendingBan(null); setRowActionReason(''); }}
      >
        <div className="space-y-3">
          <input
            value={rowActionReason}
            onChange={event => setRowActionReason(event.target.value)}
            placeholder="Ban reason (required)"
            className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
          />
          <Select
            value={rowBanDuration}
            onChange={event => setRowBanDuration(event.target.value)}
          >
            {defaultDurations.map(item => <SelectOption key={item} value={item}>{item}</SelectOption>)}
          </Select>
        </div>
      </ConfirmModal>

      {kickAllOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-[#101010] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">Kick All Players</h2>
                <p className="mt-1 text-sm text-zinc-500">This sends a kick command to every currently online player.</p>
              </div>
              <button onClick={() => setKickAllOpen(false)} className="p-1 text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 space-y-3">
              <input value={kickAllReason} onChange={event => setKickAllReason(event.target.value)} placeholder="Reason" className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500" />
              <input value={kickAllConfirm} onChange={event => setKickAllConfirm(event.target.value)} placeholder="Type KICK ALL to confirm" className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500" />
              <button
                onClick={kickAllPlayers}
                disabled={!kickAllReason.trim() || kickAllConfirm !== 'KICK ALL' || actionLoading === 'kick-all'}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {actionLoading === 'kick-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                Kick All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableHead({ children, align = 'text-left' }: { children: React.ReactNode; align?: string }) {
  return <div className={`text-[10px] font-bold uppercase tracking-widest text-zinc-400 ${align}`}>{children}</div>;
}

function MobileLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 lg:hidden">{children}</span>;
}

function StatusBadge({ online, ping }: { online: boolean; ping?: number | null }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${online ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
      {online ? `${ping ?? 0}ms` : 'offline'}
    </span>
  );
}

function MenuAction({ label, icon, onClick, danger = false, disabled = false }: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${danger ? 'text-red-300 hover:bg-red-500/10 disabled:hover:bg-transparent' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:hover:bg-transparent disabled:hover:text-zinc-300'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

