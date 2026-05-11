export const ALL_PERMISSIONS = 'all_permissions';

export const PERMISSIONS = [
  ALL_PERMISSIONS,
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
] as const;

export type Permission = typeof PERMISSIONS[number];

export const hasPermission = (permissions: string[], permission: string) => {
  return permissions.includes(ALL_PERMISSIONS) || permissions.includes(permission);
};

export const normalizePermissions = (permissions: unknown): string[] => {
  if (!Array.isArray(permissions)) return [];

  return [...new Set(
    permissions
      .filter((permission): permission is string => typeof permission === 'string')
      .filter(permission => PERMISSIONS.includes(permission as Permission))
  )];
};
