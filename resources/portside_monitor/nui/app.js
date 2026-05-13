const warning = document.getElementById('warning');
const reason = document.getElementById('reason');
const author = document.getElementById('author');
const acknowledge = document.getElementById('acknowledge');
const menu = document.getElementById('menu');
const menuTitle = document.getElementById('menu-title');
const menuStatus = document.getElementById('menu-status');
const closeMenu = document.getElementById('close-menu');
const playersContainer = document.getElementById('players');
const selectedPlayer = document.getElementById('selected-player');
const actionReason = document.getElementById('action-reason');
const actionDuration = document.getElementById('action-duration');
const actions = document.getElementById('actions');

let activeActionId = null;
let currentMenu = { admin: null, players: [] };
let activePlayer = null;

const actionDefinitions = [
  { action: 'kick', label: 'Kick', permission: 'players.kick', needsPlayer: true, danger: true },
  { action: 'ban', label: 'Ban', permission: 'players.ban', needsPlayer: true, danger: true },
  { action: 'warn', label: 'Warn', permission: 'players.warn', needsPlayer: true },
  { action: 'direct_message', label: 'Direct Message', permission: 'players.direct_message', needsPlayer: true, message: true },
  { action: 'heal', label: 'Heal', permission: 'players.heal', needsPlayer: true },
  { action: 'freeze', label: 'Freeze', permission: 'players.freeze', needsPlayer: true },
  { action: 'teleport', label: 'Go To', permission: 'players.teleport', needsPlayer: true },
  { action: 'spectate', label: 'Spectate', permission: 'players.spectate', needsPlayer: true },
  { action: 'viewids', label: 'Toggle IDs', permission: 'menu.viewids', needsPlayer: false },
];

const hasPermission = (permission) => {
  const permissions = currentMenu.admin?.permissions || [];
  return permissions.includes('all_permissions') || permissions.includes(permission);
};

const renderPlayers = () => {
  playersContainer.innerHTML = '';
  (currentMenu.players || []).forEach((player) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `player-row ${activePlayer?.id === player.id ? 'active' : ''}`;
    button.innerHTML = `<span>#${player.id} ${player.name}</span><small>${player.ping || 0}ms</small>`;
    button.addEventListener('click', () => {
      activePlayer = player;
      renderPlayers();
      renderActions();
    });
    playersContainer.appendChild(button);
  });
};

const renderActions = () => {
  selectedPlayer.textContent = activePlayer ? `#${activePlayer.id} ${activePlayer.name}` : 'Select a player';
  actions.innerHTML = '';

  actionDefinitions
    .filter((definition) => hasPermission(definition.permission))
    .forEach((definition) => {
      const disabled = definition.needsPlayer && !activePlayer;
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = disabled;
      button.className = definition.danger ? 'danger' : '';
      button.textContent = definition.label;
      button.addEventListener('click', () => {
        fetch(`https://${GetParentResourceName()}/menuAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: definition.action,
            targetSourceId: activePlayer?.id,
            reason: actionReason.value,
            message: definition.message ? actionReason.value : undefined,
            duration: actionDuration.value,
          }),
        });
      });
      actions.appendChild(button);
    });
};

const showMenu = (payload) => {
  currentMenu = payload || { admin: null, players: [] };
  activePlayer = currentMenu.players?.[0] || null;
  menuTitle.textContent = currentMenu.admin ? `${currentMenu.admin.username} Menu` : 'Admin Menu';
  menuStatus.textContent = '';
  menu.classList.remove('hidden');
  renderPlayers();
  renderActions();
};

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'menu') {
    showMenu(data.menu);
    return;
  }

  if (data.type === 'hideMenu') {
    menu.classList.add('hidden');
    return;
  }

  if (data.type === 'menuActionResult') {
    const result = data.result || {};
    menuStatus.textContent = result.ok ? 'Action completed' : (result.error || 'Action failed');
    menuStatus.className = result.ok ? 'menu-status success' : 'menu-status error';
    if (Array.isArray(result.players)) {
      currentMenu.players = result.players;
      renderPlayers();
    }
    return;
  }

  if (data.type === 'warning' && data.warning) {
    activeActionId = data.warning.actionId;
    reason.textContent = data.warning.reason || 'No reason provided';
    author.textContent = `Issued by ${data.warning.author || 'Portside'}`;
    warning.classList.remove('hidden');
    return;
  }

  if (data.type === 'hideWarning') {
    warning.classList.add('hidden');
    activeActionId = null;
  }
});

acknowledge.addEventListener('click', () => {
  fetch(`https://${GetParentResourceName()}/ackWarning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId: activeActionId }),
  });
});

closeMenu.addEventListener('click', () => {
  fetch(`https://${GetParentResourceName()}/closeMenu`, { method: 'POST' });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menu.classList.contains('hidden')) {
    fetch(`https://${GetParentResourceName()}/closeMenu`, { method: 'POST' });
  }
});
