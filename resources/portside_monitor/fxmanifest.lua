fx_version 'cerulean'
game { 'gta5', 'rdr3' }

author 'Portside'
description 'Portside monitor bridge for resource reports, player snapshots, and txAdmin-compatible events.'
version '0.1.1'

lua54 'yes'

server_scripts {
  'server/main.lua'
}

client_scripts {
  'client/main.lua'
}

ui_page 'nui/index.html'

files {
  'nui/index.html',
  'nui/style.css',
  'nui/app.js'
}
