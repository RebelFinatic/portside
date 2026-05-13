# Portside

Portside is an open-source operations panel for FiveM servers. It gives server owners and staff a clean web interface for monitoring server health, managing players, controlling resources, editing configuration files, inspecting database tables, and working with live console output.

## Features

- **Real-time analytics**: Monitor CPU, RAM, player counts, and server activity.
- **Player management**: View online players, inspect identifiers, kick, ban, and manage staff workflows.
- **Moderation history**: Store player records, sessions, bans, warnings, direct messages, notes, and ban templates in Portside's internal database.
- **In-game admin menu**: Open a permission-aware Portside menu in FiveM for core moderation actions.
- **Whitelist controls**: Approve identifiers, review requests, and optionally block unapproved joins through the monitor bridge.
- **Discord status embed**: Optionally run a Discord bot that keeps a server status message updated.
- **Live console**: Read server output and execute console/RCON-style commands from the panel.
- **Durable logs**: Persist admin, FXServer/RCON, and server activity logs under Portside's data path.
- **Optional managed FXServer mode**: Start, stop, restart, supervise crashes, and schedule restarts when Portside is explicitly configured to own the FXServer process.
- **Resource manager**: Start, stop, restart, search, and inspect FiveM resources.
- **Portside monitor bridge**: Optional bundled FiveM resource reports stopped resources, manifest metadata, player snapshots, and txAdmin-compatible events.
- **Configuration editor**: Edit the active FiveM `server.cfg` with basic syntax highlighting.
- **Database tools**: Browse MySQL/MariaDB tables and run quick administrative queries.
- **Role-based access**: Manage roles and permissions for safer staff access.

## Tech Stack

- React, TypeScript, Vite, and Tailwind CSS
- Express server API
- MySQL/MariaDB support via `mysql2`
- JWT-backed sessions
- SQLite internal data store for Portside admins, roles, sessions, and audit logs
- Optional FiveM monitor resource under `resources/portside_monitor`
- Optional Discord bot support via `discord.js`
- Rotating file logs under `PORTSIDE_DATA_PATH/logs`
- Password hashing with `bcrypt`

## Setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env`.
3. Generate a secure `JWT_SECRET`.
4. Configure `PORTSIDE_DATA_PATH` if you do not want Portside's internal SQLite database under `.portside/`.
5. Configure `FIVEM_SERVER_URL`.
6. Set `FIVEM_SERVER_CFG_PATH` to the absolute path of your FiveM `server.cfg`.
7. To enable live commands, add `set rcon_password "a_strong_password"` in your FiveM `server.cfg`, then set the same value as `FIVEM_RCON_PASSWORD` in `.env`.
8. To enable the monitor bridge, generate `PORTSIDE_MONITOR_TOKEN`, copy `resources/portside_monitor` into your FXServer resources folder, and add the FiveM convars documented below.
9. Leave `PORTSIDE_FXSERVER_MODE` as `external` unless you want Portside to launch and supervise FXServer.
10. Start development with `pnpm dev`.
11. Open the panel and complete first-run setup to create the owner admin.

## First-run Setup

Portside no longer ships with a demo production login. On a fresh install, the panel redirects to first-run setup and creates an owner admin in Portside's internal SQLite database. The owner role receives `all_permissions` and cannot be deleted or demoted from the owner role.

The internal database is stored at:

```env
PORTSIDE_DATA_PATH=".portside"
```

This database is for Portside's own admins, roles, sessions, auth attempts, admin action logs, player records, sessions, notes, ban templates, and moderation actions. It is separate from the MySQL/MariaDB game database used by the Database Explorer.

## FiveM Integration

Portside reads live server metadata from FiveM's built-in JSON endpoints:

- `FIVEM_SERVER_URL/info.json`
- `FIVEM_SERVER_URL/dynamic.json`
- `FIVEM_SERVER_URL/players.json`

RCON is required for commands that change server state, including console commands, resource start/stop/restart, and player kicks. FXServer RCON uses UDP on the game port. For a local server, a typical `.env` looks like:

```env
FIVEM_SERVER_URL="http://127.0.0.1:30120"
FIVEM_SERVER_CFG_PATH="C:/path/to/txData/default/server.cfg"
FIVEM_RCON_PASSWORD="your_fivem_rcon_password"
```

The settings page reads and writes the file configured by `FIVEM_SERVER_CFG_PATH`. Use an absolute path and make sure the process running Portside has permission to modify that file.

The RCON host and port default to the host and port from `FIVEM_SERVER_URL`. Use `FIVEM_RCON_HOST` and `FIVEM_RCON_PORT` only if your RCON endpoint differs.

FiveM does not provide one universal vanilla ban command. If your framework exposes a ban command, configure `FIVEM_RCON_BAN_COMMAND` with tokens such as `{id}`, `{reason}`, and `{duration}`.

### Portside Monitor Resource

The optional `resources/portside_monitor` bridge closes gaps in FiveM's read-only JSON endpoints. It reports all resources, including stopped resources, resource paths, manifest metadata, player snapshots, player hardware tokens, in-game warning notifications, direct messages, the in-game admin menu, server activity logs, and bridge events. Portside continues to work without it by falling back to FiveM JSON endpoints, RCON, or mock data in local demo mode.

1. Copy `resources/portside_monitor` into your FXServer resources folder.
2. Add these lines to `server.cfg`:

```cfg
set portside_panel_url "http://127.0.0.1:3000"
set portside_monitor_token "use_the_same_value_as_PORTSIDE_MONITOR_TOKEN"
ensure portside_monitor
```

3. Set the matching token in Portside's `.env`:

```env
PORTSIDE_MONITOR_TOKEN="use_the_same_value_as_portside_monitor_token"
```

Restart or reinstall the resource after updating it so the client script, NUI warning modal, and in-game admin menu are loaded by FXServer.

The resource exposes server commands for bridge operations:

- `psaPing`: send an immediate heartbeat.
- `psa`: open the in-game Portside admin menu for linked admins. The default key mapping is `F9`.
- `psaReportResources`: send a resource manifest/state snapshot.
- `psaEvent <eventName> <json>`: relay a Portside-originated txAdmin-compatible event.
- `psaSetDebugMode true|false`: update replicated debug status in the heartbeat.

txAdmin-style command aliases (`txaPing`, `txaEvent`, `txaReportResources`, `txaSetDebugMode`) are disabled by default to avoid conflicts with real txAdmin. Enable them only when needed:

```cfg
set portside_monitor_compat_txadmin_commands "true"
```

The monitor uses `x-portside-monitor-token` for HTTP bridge authentication. Treat this token like a password: do not expose it to clients, log it, or commit it.

### In-Game Admin Menu

The monitor resource includes a minimal Portside admin menu. Link a Portside admin to their FiveM identifiers from Role Management, then use `/psa` or the `F9` keybind in-game. Portside matches the player's identifiers against the linked admin record and sends only that admin's effective permissions to the menu.

The menu currently supports player search/list selection plus permission-gated actions for kick, ban, warn, direct message, heal, freeze, go-to teleport, spectate, and view IDs. Moderation actions still write to Portside's durable moderation history and admin action logs. Server-side permission checks happen on every menu action, so client-side menu visibility is only a convenience.

### Moderation Database

Portside keeps a self-contained player and moderation database in SQLite. The monitor resource feeds player identifiers, hardware tokens, and session snapshots into that database as players connect and disconnect.

Current moderation features include:

- Durable player profiles with identifiers, recent names, online source ID, session history, and last seen timestamps.
- Internal bans with optional expiration, revocation, and txAdmin-compatible `playerBanned` event relay.
- Join blocking for active Portside bans when the monitor resource is installed and `PORTSIDE_MONITOR_TOKEN` is configured.
- Warnings with in-game acknowledgment tracking when the monitor resource is installed.
- Direct messages, notes, individual kicks, and kick-all batches written to moderation history.
- Ban templates for reusable ban reasons and durations.

Framework ban commands are optional compatibility side effects for online bans. Portside's internal moderation records are the source of truth for join blocking. If the monitor cannot reach Portside during a join check, the resource allows the join to avoid accidentally locking out a live server.

### Whitelist

Portside can keep a durable whitelist in its internal SQLite database. Entries can approve a FiveM identifier, Discord ID, or known Portside player record. Staff with `players.whitelist` can manage entries and review pending requests from the Whitelist page.

Whitelist enforcement is opt-in:

```env
PORTSIDE_WHITELIST_MODE="disabled"
```

Supported modes are:

- `disabled`: joins are never blocked by the whitelist.
- `dry-run`: unapproved joins are allowed but logged as would-be denied decisions.
- `enforced`: unapproved joins are denied by the monitor join-check route.

Active bans still take priority over whitelist approvals. The monitor resource must be installed and `PORTSIDE_MONITOR_TOKEN` must be configured for join blocking to work.

### Discord Status

Set `PORTSIDE_DISCORD_BOT_TOKEN` in `.env` to enable the Discord bot foundation. The bot token is read from the environment only and is never stored in SQLite or sent to the browser. Non-secret settings such as guild ID, status channel ID, status message ID, and update interval can be configured from the Whitelist page or via these defaults:

```env
PORTSIDE_DISCORD_BOT_TOKEN=""
PORTSIDE_DISCORD_GUILD_ID=""
PORTSIDE_DISCORD_STATUS_CHANNEL_ID=""
PORTSIDE_DISCORD_STATUS_MESSAGE_ID=""
PORTSIDE_DISCORD_STATUS_INTERVAL_SECONDS="60"
```

The status embed reports lifecycle state, players/max, monitor state, Portside uptime, and next scheduled restart. If no message ID is configured, Portside sends a new message and stores the created message ID in its internal settings.

## Logs, Console, And Metrics

Portside writes durable operational logs to `PORTSIDE_DATA_PATH/logs`:

- `admin/`: Portside admin and authentication events, alongside structured SQLite admin action logs.
- `fxserver/`: RCON commands, command output, and command failures. In external FiveM mode this is not full stdout/stderr; managed FXServer streaming will be added with process control.
- `server/`: monitor-reported server activity such as joins, leaves, chat, and resource start/stop events.

The Logs page can search recent entries and download daily log files. `PORTSIDE_LOG_RETENTION_DAYS` controls simple cleanup of old log files and defaults to 14 days.

Dashboard CPU and memory values are sampled from the Portside Node process and host instead of generated demo numbers. The host status endpoint is available at `/host/status` and requires `PORTSIDE_HOST_API_TOKEN` or the compatibility alias `TXHOST_API_TOKEN` via `x-portside-envtoken`, `x-txadmin-envtoken`, or `?token=`.

## Managed FXServer Mode

Portside defaults to `PORTSIDE_FXSERVER_MODE="external"`. In external mode, the panel can read FiveM JSON endpoints, use RCON, receive monitor events, and schedule metadata, but it cannot start or stop the FXServer process.

To let Portside manage FXServer, opt in explicitly:

```env
PORTSIDE_FXSERVER_MODE="managed"
PORTSIDE_FXSERVER_BINARY="C:/path/to/FXServer.exe"
PORTSIDE_FXSERVER_CWD="C:/path/to/server-data"
PORTSIDE_FXSERVER_ARGS="+exec server.cfg"
PORTSIDE_FXSERVER_RESTART_ON_CRASH="false"
PORTSIDE_FXSERVER_STOP_TIMEOUT_MS="10000"
```

If `PORTSIDE_FXSERVER_CWD` or `PORTSIDE_FXSERVER_ARGS` are empty, Portside derives them from `FIVEM_SERVER_CFG_PATH`. For example, `FIVEM_SERVER_CFG_PATH="C:/txData/default/server.cfg"` makes managed mode run from `C:/txData/default` with `+exec server.cfg`. This prevents FXServer from looking for `server.cfg` beside `FXServer.exe`.

Managed mode streams FXServer stdout and stderr into durable `fxserver` logs. Dashboard users with `control.server` can start, stop, restart, create daily restart schedules, and skip the next scheduled occurrence. Stop and restart actions require a reason and are written to admin action logs.

Scheduled restarts emit txAdmin-compatible monitor events: `serverShuttingDown`, `scheduledRestart`, and `scheduledRestartSkipped`. If Portside is in external mode, lifecycle API calls return a managed-mode-required error instead of trying to control a process it does not own.

## Scripts

- `pnpm dev`: Run the local development server.
- `pnpm build`: Create a production build.
- `pnpm start`: Run the server entrypoint.
- `pnpm preview`: Preview the Vite production build.
- `pnpm lint`: Run TypeScript validation with `tsc --noEmit`.

## Security

- **JWT-backed sessions** protect authenticated routes and can be revoked on logout.
- **Password hashing** uses `bcrypt` for stored admin credentials.
- **Role-based permissions** use txAdmin-compatible permission names such as `all_permissions`, `console.write`, `players.kick`, `players.ban`, `commands.resources`, `server.cfg.editor`, and `manage.admins`.
- **Admin action logs** record successful sensitive actions and denied permission attempts, with durable log files for operational review.
- **RCON credentials** enable live server commands and should be treated as production secrets.
- **Monitor tokens** authenticate the FiveM resource bridge and should be treated as production secrets.
- **Discord bot tokens** are environment-only secrets. Do not store them in SQLite, paste them into the UI, or commit them.
- **Managed process controls** are powerful. Only grant `control.server` to trusted admins and configure managed mode with a dedicated server-data directory.
- **Environment variables** should be stored in `.env` and never committed.
- **Debug mode** (`DEBUG=true` / `VITE_DEBUG=true`) bypasses real auth and grants all permissions. Use it only for local demos.

Never commit `FIVEM_RCON_PASSWORD`, `JWT_SECRET`, `PORTSIDE_MONITOR_TOKEN`, `PORTSIDE_HOST_API_TOKEN`, database passwords, or future integration tokens. Keep RCON and monitor bridge traffic on localhost or a private network where possible.

## Contributing

Use `pnpm` for project commands. After code changes or new features, run `pnpm lint` before committing. Keep this README updated when setup, usage, features, or security behavior changes.
