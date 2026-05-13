local activeWarning = nil
local menuOpen = false
local frozen = false
local viewIds = false
local spectating = false

RegisterCommand('psa', function()
  TriggerServerEvent('portside_monitor:openMenuRequest')
end, false)

RegisterKeyMapping('psa', 'Open Portside admin menu', 'keyboard', 'F9')

RegisterNetEvent('portside_monitor:openMenu', function(payload)
  menuOpen = true
  SetNuiFocus(true, true)
  SendNUIMessage({
    type = 'menu',
    menu = payload or {},
  })
end)

RegisterNUICallback('closeMenu', function(_data, callback)
  menuOpen = false
  SetNuiFocus(false, false)
  SendNUIMessage({ type = 'hideMenu' })
  callback({ ok = true })
end)

RegisterNUICallback('menuAction', function(data, callback)
  TriggerServerEvent('portside_monitor:menuAction', data or {})
  callback({ ok = true })
end)

RegisterNetEvent('portside_monitor:menuActionResult', function(payload)
  SendNUIMessage({
    type = 'menuActionResult',
    result = payload or {},
  })
end)

RegisterNetEvent('portside_monitor:showWarning', function(payload)
  if type(payload) ~= 'table' or not payload.actionId then
    return
  end

  activeWarning = payload
  SetNuiFocus(true, true)
  SendNUIMessage({
    type = 'warning',
    warning = {
      actionId = payload.actionId,
      author = payload.author or 'Portside',
      reason = payload.reason or 'No reason provided',
    },
  })
end)

RegisterNUICallback('ackWarning', function(data, callback)
  local actionId = data and data.actionId or activeWarning and activeWarning.actionId
  if actionId then
    TriggerServerEvent('portside_monitor:warningAcknowledged', actionId)
  end

  activeWarning = nil
  SetNuiFocus(false, false)
  SendNUIMessage({ type = 'hideWarning' })
  callback({ ok = true })
end)

RegisterNetEvent('portside_monitor:heal', function()
  local ped = PlayerPedId()
  SetEntityHealth(ped, GetEntityMaxHealth(ped))
  SetPedArmour(ped, 100)
end)

RegisterNetEvent('portside_monitor:toggleFreeze', function()
  frozen = not frozen
  FreezeEntityPosition(PlayerPedId(), frozen)
end)

RegisterNetEvent('portside_monitor:teleportToCoords', function(coords)
  if type(coords) ~= 'table' or not coords.x or not coords.y or not coords.z then
    return
  end
  SetEntityCoords(PlayerPedId(), coords.x + 0.0, coords.y + 0.0, coords.z + 0.0, false, false, false, false)
end)

RegisterNetEvent('portside_monitor:spectatePlayer', function(targetSourceId)
  local targetPlayer = GetPlayerFromServerId(tonumber(targetSourceId) or -1)
  if targetPlayer == -1 then
    return
  end

  spectating = not spectating
  NetworkSetInSpectatorMode(spectating, GetPlayerPed(targetPlayer))
end)

RegisterNetEvent('portside_monitor:toggleViewIds', function()
  viewIds = not viewIds
end)

CreateThread(function()
  while true do
    if viewIds then
      for _, player in ipairs(GetActivePlayers()) do
        local ped = GetPlayerPed(player)
        local coords = GetEntityCoords(ped)
        local serverId = GetPlayerServerId(player)
        local onScreen, x, y = World3dToScreen2d(coords.x, coords.y, coords.z + 1.0)
        if onScreen then
          SetTextScale(0.32, 0.32)
          SetTextFont(4)
          SetTextProportional(1)
          SetTextColour(255, 255, 255, 215)
          SetTextCentre(true)
          BeginTextCommandDisplayText('STRING')
          AddTextComponentSubstringPlayerName(('#%s'):format(serverId))
          EndTextCommandDisplayText(x, y)
        end
      end
      Wait(0)
    else
      Wait(500)
    end
  end
end)
