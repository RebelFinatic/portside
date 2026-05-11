# Portside

Portside is an open-source operations panel for FiveM servers. It gives server owners and staff a clean web interface for monitoring server health, managing players, controlling resources, editing configuration files, inspecting database tables, and working with live console output.

## Features

- **Real-time analytics**: Monitor CPU, RAM, player counts, and server activity.
- **Player management**: View online players, inspect identifiers, kick, ban, and manage staff workflows.
- **Live console**: Read server output and execute console/RCON-style commands from the panel.
- **Resource manager**: Start, stop, restart, search, and inspect FiveM resources.
- **Configuration editor**: Edit server config files with basic syntax highlighting for `.cfg`, Lua, JSON, HTML, CSS, and JavaScript.
- **Database tools**: Browse MySQL/MariaDB tables and run quick administrative queries.
- **Role-based access**: Manage roles and permissions for safer staff access.

## Tech Stack

- React, TypeScript, Vite, and Tailwind CSS
- Express server API
- MySQL/MariaDB support via `mysql2`
- JWT authentication
- Password hashing with `bcrypt`

## Setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env`.
3. Configure database settings.
4. Configure `FIVEM_SERVER_URL`.
5. Generate a secure `JWT_SECRET`.
6. To enable live commands, add `set rcon_password "a_strong_password"` in your FiveM `server.cfg`, then set the same value as `FIVEM_RCON_PASSWORD` in `.env`.
7. Start development with `pnpm dev`.

## FiveM Integration

Portside reads live server metadata from FiveM's built-in JSON endpoints:

- `FIVEM_SERVER_URL/info.json`
- `FIVEM_SERVER_URL/dynamic.json`
- `FIVEM_SERVER_URL/players.json`

RCON is required for commands that change server state, including console commands, resource start/stop/restart, and player kicks. FXServer RCON uses UDP on the game port. For a local server, a typical `.env` looks like:

```env
FIVEM_SERVER_URL="http://127.0.0.1:30120"
FIVEM_RCON_PASSWORD="your_fivem_rcon_password"
```

The RCON host and port default to the host and port from `FIVEM_SERVER_URL`. Use `FIVEM_RCON_HOST` and `FIVEM_RCON_PORT` only if your RCON endpoint differs.

FiveM does not provide one universal vanilla ban command. If your framework exposes a ban command, configure `FIVEM_RCON_BAN_COMMAND` with tokens such as `{id}`, `{reason}`, and `{duration}`.

## Scripts

- `pnpm dev`: Run the local development server.
- `pnpm build`: Create a production build.
- `pnpm start`: Run the server entrypoint.
- `pnpm preview`: Preview the Vite production build.
- `pnpm lint`: Run TypeScript validation with `tsc --noEmit`.

## Security

- **JWT authentication** protects authenticated routes.
- **Password hashing** uses `bcrypt`.
- **Role-based permissions** limit access to server-altering actions.
- **RCON credentials** enable live server commands and should be treated as production secrets.
- **Environment variables** should be stored in `.env` and never committed.

## Contributing

Use `pnpm` for project commands. After code changes or new features, run `pnpm lint` before committing. Keep this README updated when setup, usage, features, or security behavior changes.
