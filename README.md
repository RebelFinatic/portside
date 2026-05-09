# Portside

An elegant, real-time web panel for comprehensive FiveM server management.

## Features

- **Real-Time Analytics**: Monitor CPU, RAM, and active players in real-time.
- **Player Management**: Monitor online players, kick, ban, and view roles.
- **Live Console**: View the standard output of your FiveM node server and execute RCON/Server console commands safely.
- **Resource Manager**: Start, stop, and restart FiveM resources through an intuitive UI.
- **Database Management**: Integrated simple MySQL / MariaDB browser for rapid queries.

## Setup

1. Rename `.env.example` to `.env`.
2. Configure **Database** properties.
3. Configure **FIVEM_SERVER_URL**.
4. Generate a secure `JWT_SECRET`.
5. Run the server using `npm run dev` or build it via `npm run build` and `npm start`.

## Security Measures

- **JWT Authentication**: Secure token-based session validation.
- **Secure Hashing**: Passwords stored via `bcrypt`.
- **Role-Based Views**: The API relies on role validation before processing server-altering states.
