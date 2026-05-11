# Portside

Portside is an open-source operations panel for FiveM servers. It gives server owners and staff a clean web interface for monitoring server health, managing players, controlling resources, editing configuration files, inspecting database tables, and working with live console output.

## Features

- **Real-time analytics**: Monitor CPU, RAM, player counts, and server activity.
- **Player management**: View online players, inspect identifiers, kick, ban, and manage staff workflows.
- **Moderation history**: Store player records, sessions, bans, warnings, notes, and ban templates in Portside's internal database.
- **Live console**: Read server output and execute console/RCON-style commands from the panel.
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
9. Start development with `pnpm dev`.
10. Open the panel and complete first-run setup to create the owner admin.

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

The optional `resources/portside_monitor` bridge closes gaps in FiveM's read-only JSON endpoints. It reports all resources, including stopped resources, resource paths, manifest metadata, player snapshots, player hardware tokens, and bridge events. Portside continues to work without it by falling back to FiveM JSON endpoints, RCON, or mock data in local demo mode.

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

The resource exposes server commands for bridge operations:

- `psaPing`: send an immediate heartbeat.
- `psaReportResources`: send a resource manifest/state snapshot.
- `psaEvent <eventName> <json>`: relay a Portside-originated txAdmin-compatible event.
- `psaSetDebugMode true|false`: update replicated debug status in the heartbeat.

txAdmin-style command aliases (`txaPing`, `txaEvent`, `txaReportResources`, `txaSetDebugMode`) are disabled by default to avoid conflicts with real txAdmin. Enable them only when needed:

```cfg
set portside_monitor_compat_txadmin_commands "true"
```

The monitor uses `x-portside-monitor-token` for HTTP bridge authentication. Treat this token like a password: do not expose it to clients, log it, or commit it.

### Moderation Database

Portside keeps a self-contained player and moderation database in SQLite. The monitor resource feeds player identifiers, hardware tokens, and session snapshots into that database as players connect and disconnect.

Current moderation features include:

- Durable player profiles with identifiers, recent names, online source ID, session history, and last seen timestamps.
- Internal bans with optional expiration, revocation, and txAdmin-compatible `playerBanned` event relay.
- Join blocking for active Portside bans when the monitor resource is installed and `PORTSIDE_MONITOR_TOKEN` is configured.
- Warnings, notes, and kick history written to moderation actions.
- Ban templates for reusable ban reasons and durations.

Framework ban commands are optional compatibility side effects for online bans. Portside's internal moderation records are the source of truth for join blocking. If the monitor cannot reach Portside during a join check, the resource allows the join to avoid accidentally locking out a live server.

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
- **Admin action logs** record successful sensitive actions and denied permission attempts.
- **RCON credentials** enable live server commands and should be treated as production secrets.
- **Monitor tokens** authenticate the FiveM resource bridge and should be treated as production secrets.
- **Environment variables** should be stored in `.env` and never committed.
- **Debug mode** (`DEBUG=true` / `VITE_DEBUG=true`) bypasses real auth and grants all permissions. Use it only for local demos.

Never commit `FIVEM_RCON_PASSWORD`, `JWT_SECRET`, `PORTSIDE_MONITOR_TOKEN`, database passwords, or future integration tokens. Keep RCON and monitor bridge traffic on localhost or a private network where possible.

## Contributing

Use `pnpm` for project commands. After code changes or new features, run `pnpm lint` before committing. Keep this README updated when setup, usage, features, or security behavior changes.
