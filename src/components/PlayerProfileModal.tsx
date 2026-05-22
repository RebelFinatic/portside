import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Ban,
  ChevronDown,
  ChevronUp,
  History,
  LayoutDashboard,
  Loader2,
  MessageSquareWarning,
  Plus,
  Send,
  ShieldAlert,
  StickyNote,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { formatDistanceStrict, intervalToDuration } from 'date-fns';
import { Select, SelectOption } from './Select';
import { hasPermission } from '../lib/api';

export type ProfileTab = 'overview' | 'history' | 'sessions' | 'staff';

export interface PlayerProfile {
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
  recentNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  sessions: Array<{
    id: string;
    sourceId?: number | null;
    joinedAt: string;
    leftAt?: string | null;
    dropReason?: string | null;
  }>;
  notes: Array<{
    id: string;
    note: string;
    authorUsername?: string;
    updatedAt: string;
  }>;
  actions: Array<{
    id: string;
    type: string;
    reason?: string;
    authorUsername?: string;
    createdAt: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
    acknowledgedAt?: string | null;
  }>;
}

const PROFILE_TABS: { id: ProfileTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'history', label: 'History', icon: <History className="h-4 w-4" /> },
  { id: 'sessions', label: 'Sessions', icon: <UserRound className="h-4 w-4" /> },
  { id: 'staff', label: 'Staff tools', icon: <Wrench className="h-4 w-4" /> },
];

const defaultDurations = ['1h', '24h', '3d', '1w', 'permanent'];

const MODAL_SHELL_CLASS =
  'modal-panel-enter flex h-[min(680px,88vh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#101010] shadow-2xl';

const formatSessionDuration = (joinedAt: string, leftAt?: string | null) => {
  const start = new Date(joinedAt);
  const end = leftAt ? new Date(leftAt) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return leftAt ? '0m' : 'Active';
  }
  const duration = intervalToDuration({ start, end });
  const parts = [
    duration.hours ? `${duration.hours}h` : null,
    duration.minutes ? `${duration.minutes}m` : null,
    !duration.hours && duration.seconds ? `${duration.seconds}s` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '0m';
};

const formatSeenDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const actionTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    ban: 'Ban',
    warn: 'Warning',
    kick: 'Kick',
  };
  return labels[type] || type;
};

export type PlayerProfileModalProps = {
  open: boolean;
  loading: boolean;
  profile: PlayerProfile | null;
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  onClose: () => void;
  profileOnline: boolean;
  profileBanned: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  duration: string;
  onDurationChange: (value: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  directMessage: string;
  onDirectMessageChange: (value: string) => void;
  actionLoading: string;
  onBan: () => void;
  onWarn: () => void;
  onAddNote: () => void;
  onSendDm: () => void;
  onRevokeAction: (actionId: string) => void;
  profileActionsRef: React.RefObject<HTMLElement | null>;
  profileDmRef: React.RefObject<HTMLElement | null>;
};

export default function PlayerProfileModal({
  open,
  loading,
  profile,
  activeTab,
  onTabChange,
  onClose,
  profileOnline,
  profileBanned,
  reason,
  onReasonChange,
  duration,
  onDurationChange,
  note,
  onNoteChange,
  directMessage,
  onDirectMessageChange,
  actionLoading,
  onBan,
  onWarn,
  onAddNote,
  onSendDm,
  onRevokeAction,
  profileActionsRef,
  profileDmRef,
}: PlayerProfileModalProps) {
  const titleId = useId();
  const tabContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  useEffect(() => {
    tabContentRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  if (!open) return null;

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="modal-overlay-enter fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={MODAL_SHELL_CLASS}
        onClick={event => event.stopPropagation()}
      >
        {loading || !profile ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 px-6 py-4">
              <h2 id={titleId} className="text-lg font-semibold text-white">
                Loading player...
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
                aria-label="Close profile"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-orange-500" />
            </div>
          </>
        ) : (
          <>
            <ProfileHero
              profile={profile}
              titleId={titleId}
              profileOnline={profileOnline}
              onClose={onClose}
            />

            <ProfileTabBar activeTab={activeTab} onTabChange={onTabChange} />

            <div
              ref={tabContentRef}
              className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
            >
              {activeTab === 'overview' && <OverviewTab profile={profile} />}
              {activeTab === 'history' && (
                <HistoryTab
                  profile={profile}
                  actionLoading={actionLoading}
                  onRevokeAction={onRevokeAction}
                />
              )}
              {activeTab === 'sessions' && <SessionsTab profile={profile} />}
              {activeTab === 'staff' && (
                <StaffTab
                  profile={profile}
                  profileOnline={profileOnline}
                  profileBanned={profileBanned}
                  reason={reason}
                  onReasonChange={onReasonChange}
                  duration={duration}
                  onDurationChange={onDurationChange}
                  note={note}
                  onNoteChange={onNoteChange}
                  directMessage={directMessage}
                  onDirectMessageChange={onDirectMessageChange}
                  actionLoading={actionLoading}
                  onBan={onBan}
                  onWarn={onWarn}
                  onAddNote={onAddNote}
                  onSendDm={onSendDm}
                  profileActionsRef={profileActionsRef}
                  profileDmRef={profileDmRef}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileHero({
  profile,
  titleId,
  profileOnline,
  onClose,
}: {
  profile: PlayerProfile;
  titleId: string;
  profileOnline: boolean;
  onClose: () => void;
}) {
  const allIdentifiers = [
    ...profile.identifiers,
    ...(profile.hwids || []).map(value => `hwid:${value}`),
  ];
  const activeBans = profile.actionCounts?.activeBans ?? 0;
  const warnings = profile.actionCounts?.warnings ?? 0;
  const kicks = profile.actionCounts?.kicks ?? 0;

  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-950/50 px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-lg font-semibold text-white">
              {profile.displayName || profile.name}
            </h2>
            <OnlineStatusBadge online={profileOnline} ping={profile.ping} />
            {profileOnline && profile.sourceId != null && (
              <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-400">
                #{profile.sourceId}
              </span>
            )}
          </div>

          {allIdentifiers[0] && (
            <p className="truncate font-mono text-xs text-zinc-500" title={allIdentifiers[0]}>
              {allIdentifiers[0]}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>
              First seen {formatSeenDate(profile.firstSeenAt)}
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              Last seen {formatSeenDate(profile.lastSeenAt)}
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              <span className={activeBans > 0 ? 'text-red-400' : 'text-zinc-400'}>{activeBans}</span>
              {' bans · '}
              <span className="text-amber-400">{warnings}</span>
              {' warns · '}
              <span className="text-zinc-400">{kicks}</span>
              {' kicks'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
          aria-label="Close profile"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function ProfileTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
}) {
  return (
    <div className="shrink-0 border-b border-zinc-800 px-6">
      <div className="flex flex-wrap gap-2 py-3" role="tablist" aria-label="Player profile sections">
        {PROFILE_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? 'border-orange-600/40 bg-orange-600/10 text-orange-300'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-white'
            }`}
          >
            <span className={activeTab === tab.id ? 'text-orange-500' : 'text-zinc-500'}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ profile }: { profile: PlayerProfile }) {
  const latestNote = profile.notes[0];
  const recentNames = profile.recentNames?.filter(Boolean) ?? [];

  return (
    <div className="space-y-5">
      <Section title="Identifiers" icon={<ShieldAlert className="h-4 w-4" />}>
        <CollapsibleIdentifierList
          items={[
            ...profile.identifiers,
            ...(profile.hwids || []).map(value => `hwid:${value}`),
          ]}
        />
      </Section>

      {recentNames.length > 0 && (
        <Section title="Recent names" icon={<UserRound className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            {recentNames.map(name => (
              <span
                key={name}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-sm text-zinc-300"
              >
                {name}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Latest staff note" icon={<StickyNote className="h-4 w-4" />}>
        {latestNote ? (
          <div className="rounded-lg border border-zinc-800 bg-black/20 p-4">
            <p className="text-sm leading-relaxed text-zinc-300">{latestNote.note}</p>
            <p className="mt-2 text-xs text-zinc-600">
              {latestNote.authorUsername || 'system'} · {new Date(latestNote.updatedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <EmptyText>No staff notes yet. Add one under Staff tools.</EmptyText>
        )}
      </Section>
    </div>
  );
}

function HistoryTab({
  profile,
  actionLoading,
  onRevokeAction,
}: {
  profile: PlayerProfile;
  actionLoading: string;
  onRevokeAction: (actionId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Bans, warnings, and kicks recorded for this player. Revoke active bans when appropriate.
      </p>
      {profile.actions.length === 0 ? (
        <EmptyText>No moderation history yet. Actions you take will appear here.</EmptyText>
      ) : (
        <div className="space-y-3">
          {profile.actions.map(action => (
            <div key={action.id} className="rounded-lg border border-zinc-800 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="inline-flex rounded-md border border-orange-600/30 bg-orange-600/10 px-2 py-0.5 text-xs font-semibold text-orange-300">
                    {actionTypeLabel(action.type)}
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                    {action.reason || 'No reason provided'}
                  </p>
                </div>
                {action.type === 'ban' && !action.revokedAt && hasPermission('players.ban') && (
                  <button
                    type="button"
                    onClick={() => onRevokeAction(action.id)}
                    disabled={actionLoading === `revoke-${action.id}`}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-50"
                  >
                    {actionLoading === `revoke-${action.id}` && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Revoke
                  </button>
                )}
              </div>
              <div className="mt-3 text-xs leading-relaxed text-zinc-600">
                {action.authorUsername || 'system'} · {new Date(action.createdAt).toLocaleString()}
                {action.expiresAt ? ` · expires ${new Date(action.expiresAt).toLocaleString()}` : ''}
                {action.revokedAt ? ` · revoked ${new Date(action.revokedAt).toLocaleString()}` : ''}
                {action.type === 'warn'
                  ? action.acknowledgedAt
                    ? ` · acknowledged ${new Date(action.acknowledgedAt).toLocaleString()}`
                    : ' · awaiting acknowledgment'
                  : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionsTab({ profile }: { profile: PlayerProfile }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        Connection history for this player — when they joined, left, and how long they played.
      </p>
      {profile.sessions.length === 0 ? (
        <EmptyText>No sessions recorded yet. Sessions appear after the player connects.</EmptyText>
      ) : (
        <div className="space-y-3">
          {profile.sessions.map(session => (
            <div key={session.id} className="rounded-lg border border-zinc-800 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium text-white">
                  Slot #{session.sourceId ?? 'offline'}
                </span>
                <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-xs font-semibold text-zinc-400">
                  {formatSessionDuration(session.joinedAt, session.leftAt)}
                </span>
              </div>
              <div className="mt-2 text-sm text-zinc-400">
                Joined {new Date(session.joinedAt).toLocaleString()}
                {session.leftAt
                  ? ` · Left ${new Date(session.leftAt).toLocaleString()}`
                  : ' · Still connected'}
              </div>
              {session.leftAt && (
                <div className="mt-2 text-xs text-zinc-600">
                  Playtime{' '}
                  {formatDistanceStrict(new Date(session.joinedAt), new Date(session.leftAt))}
                </div>
              )}
              {session.dropReason ? (
                <div className="mt-2 text-xs text-zinc-600">Disconnect reason: {session.dropReason}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaffTab({
  profile,
  profileOnline,
  profileBanned,
  reason,
  onReasonChange,
  duration,
  onDurationChange,
  note,
  onNoteChange,
  directMessage,
  onDirectMessageChange,
  actionLoading,
  onBan,
  onWarn,
  onAddNote,
  onSendDm,
  profileActionsRef,
  profileDmRef,
}: {
  profile: PlayerProfile;
  profileOnline: boolean;
  profileBanned: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  duration: string;
  onDurationChange: (value: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  directMessage: string;
  onDirectMessageChange: (value: string) => void;
  actionLoading: string;
  onBan: () => void;
  onWarn: () => void;
  onAddNote: () => void;
  onSendDm: () => void;
  profileActionsRef: React.RefObject<HTMLElement | null>;
  profileDmRef: React.RefObject<HTMLElement | null>;
}) {
  const inputClass =
    'w-full rounded-lg border border-zinc-800 bg-black/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500';

  return (
    <div className="space-y-6">
      <Section
        ref={profileActionsRef}
        title="Ban and warn"
        description="Record a ban or send an in-game warning while the player is online."
        icon={<Ban className="h-4 w-4" />}
      >
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/20 p-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">Reason</label>
            <input
              value={reason}
              onChange={event => onReasonChange(event.target.value)}
              placeholder="Why is this action being taken?"
              className={inputClass}
            />
          </div>
          {hasPermission('players.ban') && (
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-300">Ban duration</label>
              <p className="mb-2 text-xs text-zinc-500">How long the ban should last.</p>
              <Select value={duration} onChange={event => onDurationChange(event.target.value)}>
                {defaultDurations.map(item => (
                  <SelectOption key={item} value={item}>
                    {item}
                  </SelectOption>
                ))}
              </Select>
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            {hasPermission('players.ban') && (
              <ActionButton
                onClick={onBan}
                loading={actionLoading === 'ban'}
                disabled={profileBanned}
                label={profileBanned ? 'Already banned' : 'Ban player'}
                icon={<Ban className="h-4 w-4" />}
              />
            )}
            {hasPermission('players.warn') && profileOnline && (
              <ActionButton
                onClick={onWarn}
                loading={actionLoading === 'warn'}
                label="Warn player"
                icon={<MessageSquareWarning className="h-4 w-4" />}
              />
            )}
            {hasPermission('players.warn') && !profileOnline && (
              <p className="text-sm text-zinc-500">Player must be online to receive a warning.</p>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Staff notes"
        description="Private notes for your team — not shown to the player."
        icon={<StickyNote className="h-4 w-4" />}
      >
        <div className="space-y-3">
          {profile.notes.map(item => (
            <div key={item.id} className="rounded-lg border border-zinc-800 bg-black/20 p-4">
              <p className="text-sm leading-relaxed text-zinc-300">{item.note}</p>
              <p className="mt-2 text-xs text-zinc-600">
                {item.authorUsername || 'system'} · {new Date(item.updatedAt).toLocaleString()}
              </p>
            </div>
          ))}
          {profile.notes.length === 0 && <EmptyText>No notes yet.</EmptyText>}
          {hasPermission('players.warn') && (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/20 p-4">
              <textarea
                value={note}
                onChange={event => onNoteChange(event.target.value)}
                placeholder="Add a staff note..."
                className={`${inputClass} min-h-20 resize-y`}
              />
              <button
                type="button"
                onClick={onAddNote}
                disabled={!note.trim() || actionLoading === 'note'}
                className="inline-flex items-center gap-2 rounded-lg border border-orange-600/30 bg-orange-600/10 px-4 py-2.5 text-sm font-bold text-orange-400 transition-colors hover:bg-orange-600/20 disabled:opacity-50"
              >
                {actionLoading === 'note' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add note
              </button>
            </div>
          )}
        </div>
      </Section>

      {hasPermission('players.direct_message') && (
        <Section
          ref={profileDmRef}
          title="Direct message"
          description={
            profileOnline
              ? 'Send a message that appears in-game for this player.'
              : 'Player must be online to receive a direct message.'
          }
          icon={<Send className="h-4 w-4" />}
        >
          {profileOnline ? (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-black/20 p-4">
              <textarea
                value={directMessage}
                onChange={event => onDirectMessageChange(event.target.value)}
                placeholder="Message to send in-game..."
                className={`${inputClass} min-h-20 resize-y`}
              />
              <button
                type="button"
                onClick={onSendDm}
                disabled={!directMessage.trim() || actionLoading === 'dm'}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-zinc-700 disabled:opacity-50"
              >
                {actionLoading === 'dm' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send message
              </button>
            </div>
          ) : (
            <EmptyText>Connect to the server first — this player is offline.</EmptyText>
          )}
        </Section>
      )}
    </div>
  );
}

function CollapsibleIdentifierList({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!items.length) {
    return <EmptyText>No identifiers captured yet.</EmptyText>;
  }

  const primary = items[0];
  const rest = items.slice(1);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-2.5 font-mono text-sm text-zinc-400 break-all">
        {primary}
      </div>
      {rest.length > 0 && (
        <>
          {expanded && (
            <div className="space-y-2">
              {rest.map(item => (
                <div
                  key={item}
                  className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-2.5 font-mono text-sm text-zinc-400 break-all"
                >
                  {item}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-orange-400 transition-colors hover:text-orange-300"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Hide {rest.length} more identifier{rest.length === 1 ? '' : 's'}
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                Show all identifiers ({items.length})
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

function OnlineStatusBadge({ online, ping }: { online: boolean; ping?: number | null }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
        online
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
          : 'border-zinc-700 bg-zinc-900 text-zinc-500'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
      {online ? `Online · ${ping ?? 0}ms` : 'Offline'}
    </span>
  );
}

function Section({
  title,
  description,
  icon,
  children,
  ref,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={ref} className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="text-orange-500">{icon}</span>
          {title}
        </h3>
        {description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-5 text-center text-sm text-zinc-600">
      {children}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  loading,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  loading: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> : icon}
      {label}
    </button>
  );
}
