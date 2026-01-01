# Quick Start Guide

## To Fix the Connection Error:

1. **Open a terminal/command prompt** in the project folder

2. **Install dependencies** (if you haven't already):
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```

4. **You should see**:
   ```
   Connected to PostgreSQL database
   Database tables initialized successfully
   Server running on http://localhost:3000
   ```

5. **Keep the terminal open** - the server must stay running for the website to work

6. **Open your browser** and go to:
   - `http://localhost:3000/register.html` to register
   - `http://localhost:3000/login.html` to login

## Troubleshooting:

- **"Cannot find module 'pg'"**: Run `npm install` again
- **"Port 3000 already in use"**: Another program is using port 3000. Close it or change PORT in server.js
- **Database connection errors**: Check your internet connection (cloud database requires internet)
- **Still getting connection error**: Make sure the server terminal shows "Server running on http://localhost:3000"

## Important:
The server MUST be running for registration, login, and vouches to work!
