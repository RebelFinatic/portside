fx_version 'cerulean'
game { 'gta5', 'rdr3' }

author 'Portside'
description 'Portside monitor bridge for resource reports, player snapshots, and txAdmin-compatible events.'
version '0.1.0'

server_only 'yes'
lua54 'yes'

server_scripts {
  'server/main.lua'
}
