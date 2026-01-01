# AtlasMarket - Setup Instructions

## Installation

1. Install Node.js (v14 or higher) from https://nodejs.org/

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000`

## Features

- User registration and authentication
- Account panel with user information
- Vouches system (requires login)
- Persistent database (SQLite)
- Session management

## Database

The server uses a PostgreSQL database (Tiger Cloud/TimescaleDB). The connection details are stored in `database/tiger-cloud-db-28077-credentials.txt`.

The database contains:
- `users` table - User accounts
- `vouches` table - User vouches/reviews

Tables will be created automatically when you first run the server.

## API Endpoints

- `POST /api/register` - Register new user
- `POST /api/login` - Login user
- `POST /api/logout` - Logout user
- `GET /api/session` - Check current session
- `GET /api/user` - Get current user info
- `POST /api/vouches` - Create a vouch (requires auth)
- `GET /api/vouches` - Get all vouches
- `GET /api/vouches/my` - Get user's vouches (requires auth)
- `DELETE /api/vouches/:id` - Delete a vouch (requires auth)

## Notes

- Make sure the server is running before accessing pages that require authentication
- The database file is stored in the project root as `database.db`
- Session secret should be changed in production
