local VERSION = '0.1.7'
local RESOURCE_NAME = GetCurrentResourceName()
local debugMode = false
local decodePayload
local adminSessions = {}

local function trimTrailingSlash(value)
  return (value:gsub('/+$', ''))
end

local function panelUrl()
  return trimTrailingSlash(GetConvar('portside_panel_url', 'http://127.0.0.1:3000'))
end

local function bridgeToken()
  return GetConvar('portside_monitor_token', '')
end

local function compatCommandsEnabled()
  return GetConvar('portside_monitor_compat_txadmin_commands', 'false') == 'true'
end

local function canUseCommand(source)
  if source == 0 then
    return true
  end

  return IsPlayerAceAllowed(source, 'portside.monitor')
end

local function postToPortside(path, payload, callback)
  local token = bridgeToken()
  if token == '' then
    print('[portside_monitor] portside_monitor_token is not configured')
    if callback then callback(false, 0, 'missing token') end
    return
  end

  PerformHttpRequest(panelUrl() .. path, function(statusCode, responseBody)
    local ok = statusCode >= 200 and statusCode < 300
    if not ok then
      print(('[portside_monitor] bridge post failed: %s (%s)'):format(path, statusCode))
    end
    if callback then callback(ok, statusCode, responseBody) end
  end, 'POST', json.encode(payload), {
    ['Content-Type'] = 'application/json',
    ['x-portside-monitor-token'] = token,
  })
end

local function firstMetadata(resourceName, key)
  local value = GetResourceMetadata(resourceName, key, 0)
  if value and value ~= '' then
    return value
  end
  return nil
end

local function allMetadata(resourceName, key)
  local values = {}
  local count = GetNumResourceMetadata(resourceName, key)
  for index = 0, count - 1 do
    local value = GetResourceMetadata(resourceName, key, index)
    if value and value ~= '' then
      values[#values + 1] = value
    end
  end
  return values
end

local function collectResources()
  local resources = {}
  local count = GetNumResources()

  for index = 0, count - 1 do
    local name = GetResourceByFindIndex(index)
    if name then
      local dependencies = allMetadata(name, 'dependency')
      resources[#resources + 1] = {
        name = name,
        state = GetResourceState(name),
        path = GetResourcePath(name),
        author = firstMetadata(name, 'author'),
        version = firstMetadata(name, 'version'),
        description = firstMetadata(name, 'description'),
        dependencies = dependencies,
        metadata = {
          fxVersion = firstMetadata(name, 'fx_version'),
          game = allMetadata(name, 'game'),
          clientScripts = allMetadata(name, 'client_script'),
          serverScripts = allMetadata(name, 'server_script'),
          sharedScripts = allMetadata(name, 'shared_script'),
        },
      }
    end
  end

  return resources
end

local function collectPlayerIdentifiers(playerId)
  local identifiers = {}
  local count = GetNumPlayerIdentifiers(playerId)
  for index = 0, count - 1 do
    local identifier = GetPlayerIdentifier(playerId, index)
    if identifier and identifier ~= '' then
      identifiers[#identifiers + 1] = identifier
    end
  end
  return identifiers
end

function collectPlayerTokens(playerId)
  local tokens = {}
  local count = GetNumPlayerTokens(playerId)
  for index = 0, count - 1 do
    local token = GetPlayerToken(playerId, index)
    if token and token ~= '' then
      tokens[#tokens + 1] = token
    end
  end
  return tokens
end

local function collectPlayers()
  local players = {}

  for _, playerId in ipairs(GetPlayers()) do
    local numericId = tonumber(playerId)
    players[#players + 1] = {
      id = numericId,
      name = GetPlayerName(playerId) or ('Player ' .. playerId),
      ping = GetPlayerPing(playerId) or 0,
      identifiers = collectPlayerIdentifiers(playerId),
      hwids = collectPlayerTokens(playerId),
      endpoint = GetPlayerEndpoint(playerId),
    }
  end

  return players
end

local function collectMenuPlayers()
  local players = {}
  for _, playerId in ipairs(GetPlayers()) do
    players[#players + 1] = {
      id = tonumber(playerId),
      name = GetPlayerName(playerId) or ('Player ' .. playerId),
      ping = GetPlayerPing(playerId) or 0,
    }
  end
  table.sort(players, function(a, b) return a.id < b.id end)
  return players
end

local function sendHeartbeat()
  postToPortside('/api/monitor/heartbeat', {
    resourceName = RESOURCE_NAME,
    version = VERSION,
    gameName = GetConvar('gamename', 'fivem'),
    serverName = GetConvar('sv_hostname', ''),
    players = #GetPlayers(),
    maxPlayers = GetConvarInt('sv_maxclients', 48),
    debug = debugMode,
  })
end

local function reportResources()
  postToPortside('/api/monitor/resources', {
    resources = collectResources(),
  })
end

local function reportPlayers()
  postToPortside('/api/monitor/players', {
    players = collectPlayers(),
  })
end

local function reportEvent(eventName, payload)
  postToPortside('/api/monitor/events', {
    eventName = eventName,
    payload = payload,
  })
end

local function reportActivity(activityType, message, payload, level, source)
  postToPortside('/api/monitor/activity', {
    type = activityType,
    level = level or 'INFO',
    source = source or 'server',
    message = message,
    payload = payload or {},
  })
end

local function authenticateAdmin(playerId, callback)
  local identifiers = collectPlayerIdentifiers(playerId)
  postToPortside('/api/monitor/admin/auth', {
    sourceId = tonumber(playerId),
    name = GetPlayerName(playerId),
    identifiers = identifiers,
  }, function(ok, statusCode, responseBody)
    if not ok then
      adminSessions[playerId] = nil
      if callback then callback(false, nil, statusCode) end
      return
    end

    local decoded = decodePayload(responseBody)
    if decoded.authorized and decoded.admin then
      adminSessions[playerId] = decoded.admin
      TriggerEvent('txAdmin:events:adminAuth', {
        netid = tonumber(playerId),
        isAdmin = true,
        username = decoded.admin.username,
        permissions = decoded.admin.permissions or {},
      })
      if callback then callback(true, decoded.admin, statusCode) end
      return
    end

    adminSessions[playerId] = nil
    if callback then callback(false, nil, statusCode) end
  end)
end

local function runMenuAction(playerId, payload, callback)
  local admin = adminSessions[playerId]
  if not admin then
    if callback then callback(false, { error = 'Open the Portside menu again to refresh admin auth.' }) end
    return
  end

  local action = payload and payload.action or nil
  local targetSourceId = tonumber(payload and payload.targetSourceId or 0)
  postToPortside('/api/monitor/menu/action', {
    sourceId = tonumber(playerId),
    adminIdentifiers = collectPlayerIdentifiers(playerId),
    action = action,
    targetSourceId = targetSourceId,
    reason = payload and payload.reason or nil,
    duration = payload and payload.duration or nil,
    message = payload and payload.message or nil,
  }, function(ok, _statusCode, responseBody)
    local decoded = decodePayload(responseBody)
    if not ok then
      if callback then callback(false, decoded) end
      return
    end

    if action == 'kick' and targetSourceId and targetSourceId > 0 then
      DropPlayer(targetSourceId, payload.reason or 'Kicked by Portside')
    elseif action == 'ban' and targetSourceId and targetSourceId > 0 then
      DropPlayer(targetSourceId, 'Banned: ' .. (payload.reason or 'Banned by Portside'))
    elseif action == 'warn' and targetSourceId and targetSourceId > 0 then
      TriggerClientEvent('portside_monitor:showWarning', targetSourceId, {
        actionId = decoded.moderationAction and decoded.moderationAction.id or '',
        author = admin.username or 'Portside',
        reason = payload.reason or 'Warned by Portside',
      })
    elseif action == 'direct_message' and targetSourceId and targetSourceId > 0 then
      TriggerClientEvent('chat:addMessage', targetSourceId, {
        color = { 255, 142, 72 },
        multiline = true,
        args = { admin.username or 'Portside', payload.message or '' },
      })
    elseif action == 'heal' and targetSourceId and targetSourceId > 0 then
      TriggerClientEvent('portside_monitor:heal', targetSourceId)
    elseif action == 'freeze' and targetSourceId and targetSourceId > 0 then
      TriggerClientEvent('portside_monitor:toggleFreeze', targetSourceId)
    elseif action == 'teleport' and targetSourceId and targetSourceId > 0 then
      local targetPed = GetPlayerPed(targetSourceId)
      local coords = GetEntityCoords(targetPed)
      TriggerClientEvent('portside_monitor:teleportToCoords', playerId, { x = coords.x, y = coords.y, z = coords.z })
    elseif action == 'spectate' and targetSourceId and targetSourceId > 0 then
      TriggerClientEvent('portside_monitor:spectatePlayer', playerId, targetSourceId)
    elseif action == 'viewids' then
      TriggerClientEvent('portside_monitor:toggleViewIds', playerId)
    end

    if callback then callback(true, decoded) end
  end)
end

local function checkPlayerJoin(playerId, playerName, identifiers, hwids, callback)
  local discordId = nil
  for _, identifier in ipairs(identifiers or {}) do
    if identifier:sub(1, 8) == 'discord:' then
      discordId = identifier:sub(9)
    end
  end

  postToPortside('/api/monitor/player/check-join', {
    sourceId = tonumber(playerId),
    name = playerName,
    identifiers = identifiers,
    hwids = hwids,
    discordId = discordId,
  }, function(ok, statusCode, responseBody)
    if not ok then
      callback(true)
      return
    end

    local decoded = decodePayload(responseBody)
    if decoded.allow == false then
      callback(false, decoded.reason or 'Connection refused by Portside.')
      return
    end

    callback(true)
  end)
end

decodePayload = function(rawPayload)
  if not rawPayload or rawPayload == '' then
    return {}
  end

  local ok, decoded = pcall(json.decode, rawPayload)
  if ok and decoded then
    return decoded
  end

  return { raw = rawPayload }
end

local function relayTxAdminEvent(source, args)
  if not canUseCommand(source) then
    print('[portside_monitor] command denied')
    return
  end

  local eventName = args[1]
  if not eventName or eventName == '' then
    print('usage: psaEvent <eventName> <json>')
    return
  end

  table.remove(args, 1)
  local payload = decodePayload(table.concat(args, ' '))
  TriggerEvent('txAdmin:events:' .. eventName, payload)
  reportEvent('txAdmin:events:' .. eventName, payload)

  if eventName == 'announcement' and payload.message then
    TriggerClientEvent('chat:addMessage', -1, {
      color = { 255, 142, 72 },
      multiline = true,
      args = { payload.author or 'Portside', payload.message },
    })
  elseif eventName == 'playerWarned' and payload.targetNetId and payload.actionId then
    TriggerClientEvent('portside_monitor:showWarning', tonumber(payload.targetNetId), {
      actionId = payload.actionId,
      author = payload.author or 'Portside',
      reason = payload.reason or 'No reason provided',
    })
  elseif eventName == 'playerDirectMessage' and payload.target and payload.message then
    TriggerClientEvent('chat:addMessage', tonumber(payload.target), {
      color = { 255, 142, 72 },
      multiline = true,
      args = { payload.author or 'Portside', payload.message },
    })
  end
end

local function registerBridgeCommand(name, handler)
  RegisterCommand(name, function(source, args)
    handler(source, args)
  end, false)
end

registerBridgeCommand('psaPing', function(source)
  if not canUseCommand(source) then return end
  sendHeartbeat()
  print('[portside_monitor] pong')
end)

registerBridgeCommand('psaReportResources', function(source)
  if not canUseCommand(source) then return end
  reportResources()
  print('[portside_monitor] resource report sent')
end)

registerBridgeCommand('psaEvent', relayTxAdminEvent)

registerBridgeCommand('psaSetDebugMode', function(source, args)
  if not canUseCommand(source) then return end
  debugMode = args[1] == 'true' or args[1] == '1' or args[1] == 'on'
  sendHeartbeat()
  print(('[portside_monitor] debug mode %s'):format(debugMode and 'enabled' or 'disabled'))
end)

local function openAdminMenu(source)
  if source == 0 then
    print('[portside_monitor] /psa can only be used in-game')
    return
  end

  authenticateAdmin(source, function(ok, admin)
    if not ok then
      TriggerClientEvent('chat:addMessage', source, {
        color = { 255, 86, 86 },
        args = { 'Portside', 'No linked Portside admin was found for this player.' },
      })
      return
    end

    TriggerClientEvent('portside_monitor:openMenu', source, {
      admin = admin,
      players = collectMenuPlayers(),
    })
  end)
end

registerBridgeCommand('psa', function(source)
  openAdminMenu(source)
end)

RegisterNetEvent('portside_monitor:openMenuRequest', function()
  openAdminMenu(source)
end)

if compatCommandsEnabled() then
  registerBridgeCommand('txaPing', function(source)
    if not canUseCommand(source) then return end
    sendHeartbeat()
    print('[portside_monitor] pong')
  end)
  registerBridgeCommand('txaReportResources', function(source)
    if not canUseCommand(source) then return end
    reportResources()
    print('[portside_monitor] resource report sent')
  end)
  registerBridgeCommand('txaEvent', relayTxAdminEvent)
  registerBridgeCommand('txaSetDebugMode', function(source, args)
    if not canUseCommand(source) then return end
    debugMode = args[1] == 'true' or args[1] == '1' or args[1] == 'on'
    sendHeartbeat()
  end)
end

AddEventHandler('onResourceStart', function(resourceName)
  if resourceName == RESOURCE_NAME then
    Wait(1000)
    sendHeartbeat()
    reportResources()
    reportPlayers()
  else
    reportActivity('resource.start', ('Resource started: %s'):format(resourceName), { resource = resourceName }, 'INFO', 'resources')
    SetTimeout(1000, reportResources)
  end
end)

AddEventHandler('onResourceStop', function(resourceName)
  if resourceName ~= RESOURCE_NAME then
    reportActivity('resource.stop', ('Resource stopped: %s'):format(resourceName), { resource = resourceName }, 'WARN', 'resources')
    SetTimeout(1000, reportResources)
  end
end)

AddEventHandler('playerJoining', function()
  local playerId = source
  reportActivity('player.join', ('%s joined the server'):format(GetPlayerName(playerId) or ('Player ' .. playerId)), {
    id = tonumber(playerId),
    name = GetPlayerName(playerId),
    identifiers = collectPlayerIdentifiers(playerId),
  }, 'INFO', 'players')
  SetTimeout(1000, reportPlayers)
end)

AddEventHandler('playerConnecting', function(playerName, _setKickReason, deferrals)
  local playerId = source
  deferrals.defer()
  deferrals.update('Checking Portside moderation records...')

  local identifiers = collectPlayerIdentifiers(playerId)
  local hwids = collectPlayerTokens(playerId)

  SetTimeout(0, function()
    checkPlayerJoin(playerId, playerName or GetPlayerName(playerId) or 'Connecting Player', identifiers, hwids, function(allow, reason)
      if allow then
        deferrals.done()
      else
        deferrals.done(reason or 'Connection refused by Portside.')
      end
    end)
  end)
end)

AddEventHandler('playerDropped', function(reason)
  local playerId = source
  reportActivity('player.leave', ('%s left the server: %s'):format(GetPlayerName(playerId) or ('Player ' .. playerId), reason or 'unknown'), {
    id = tonumber(playerId),
    name = GetPlayerName(playerId),
    reason = reason,
  }, 'INFO', 'players')
  reportEvent('playerDropped', {
    id = playerId,
    name = GetPlayerName(playerId),
    reason = reason,
  })
  SetTimeout(1000, reportPlayers)
end)

AddEventHandler('chatMessage', function(source, name, message)
  reportActivity('chat', ('%s: %s'):format(name or ('Player ' .. source), message or ''), {
    id = tonumber(source),
    name = name,
    message = message,
  }, 'INFO', 'chat')
end)

RegisterNetEvent('portside_monitor:warningAcknowledged', function(actionId)
  local playerId = source
  if not actionId or actionId == '' then
    return
  end

  postToPortside('/api/monitor/warnings/' .. actionId .. '/ack', {
    sourceId = tonumber(playerId),
    playerName = GetPlayerName(playerId),
    resourceName = RESOURCE_NAME,
  })
end)

RegisterNetEvent('portside_monitor:menuAction', function(payload)
  local playerId = source
  runMenuAction(playerId, payload or {}, function(ok, result)
    TriggerClientEvent('portside_monitor:menuActionResult', playerId, {
      ok = ok,
      action = payload and payload.action or nil,
      error = result and result.error or nil,
      players = collectMenuPlayers(),
    })
  end)
end)

AddEventHandler('playerDropped', function()
  local playerId = source
  if adminSessions[playerId] then
    TriggerEvent('txAdmin:events:adminAuth', {
      netid = tonumber(playerId),
      isAdmin = false,
      username = adminSessions[playerId].username,
    })
  end
  adminSessions[playerId] = nil
end)

CreateThread(function()
  while true do
    sendHeartbeat()
    reportPlayers()
    Wait(10000)
  end
end)

CreateThread(function()
  while true do
    reportResources()
    Wait(30000)
  end
end)
