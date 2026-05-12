local activeWarning = nil

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

