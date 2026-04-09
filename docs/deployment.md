# Deployment Guide

How to run Claude Code Server in production.

## Table of Contents

- [Quick Production Start](#quick-production-start)
- [PM2 Daemon Mode](#pm2-daemon-mode)
- [Foreground Mode](#foreground-mode)
- [PM2 Configuration](#pm2-configuration)
- [Reverse Proxy](#reverse-proxy)
- [Docker](#docker)
- [Environment Variables](#environment-variables)
- [Monitoring & Logs](#monitoring--logs)
- [Data Backup](#data-backup)
- [Security Considerations](#security-considerations)

---

## Quick Production Start

```bash
# One-command setup + start
./setup.sh --prod
```

This will:
1. Install all dependencies
2. Build the React client into static files (`client/dist/`)
3. Start the server as a PM2 daemon

The server is now running at **http://localhost:3001** (or your configured `PORT`).

---

## PM2 Daemon Mode

PM2 keeps the server running in the background with auto-restart and log management.

### Start

```bash
# Via setup script
./setup.sh --prod

# Or via npm
npm start
```

### Manage

```bash
npm run status     # Check if the server is running
npm run logs       # View live logs (Ctrl+C to exit)
npm stop           # Stop the server
npm restart        # Rebuild client + restart server
```

### Direct PM2 Commands

```bash
pm2 list                           # List all PM2 processes
pm2 describe claude-code-server    # Detailed status
pm2 logs claude-code-server        # Stream logs
pm2 restart claude-code-server     # Restart without rebuild
pm2 stop claude-code-server        # Stop
pm2 delete claude-code-server      # Remove from PM2
```

### Auto-start on Boot

To survive system reboots:

```bash
pm2 startup    # Follow the printed instructions (may need sudo)
pm2 save       # Save the current process list
```

---

## Foreground Mode

If you don't want PM2 (e.g., in Docker, or for debugging):

```bash
./setup.sh --prod --fg
```

This builds the client and runs the server in the foreground. The process stays attached to your terminal — press `Ctrl+C` to stop.

Or manually:

```bash
npm run build:client
cd server && npx tsx src/index.ts
```

---

## PM2 Configuration

The PM2 config is in `ecosystem.config.cjs`:

```javascript
{
  name: 'claude-code-server',
  cwd: './server',
  script: 'node_modules/.bin/tsx',
  args: 'src/index.ts',
  env: {
    PORT: 3001,
    NODE_ENV: 'production',
  },
  autorestart: true,
  max_restarts: 10,
  restart_delay: 2000,        // 2s between restarts
  max_memory_restart: '2G',   // Restart if memory exceeds 2 GB
  kill_timeout: 10000,        // 10s graceful shutdown window
  error_file: './logs/error.log',
  out_file: './logs/out.log',
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
}
```

### Customizing

Edit `ecosystem.config.cjs` to change:
- **Port:** Change `env.PORT`
- **Memory limit:** Adjust `max_memory_restart`
- **Log location:** Change `error_file` and `out_file`
- **Restart behavior:** Adjust `max_restarts` and `restart_delay`

Environment variables from your shell (like `ANTHROPIC_API_KEY`) are automatically inherited.

---

## Reverse Proxy

In production, you'll typically put a reverse proxy (Nginx, Caddy, etc.) in front of the server for TLS, domain routing, and additional security.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name claude.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # REST API and static files
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket: control channel
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;   # Keep WS alive for 24h
        proxy_send_timeout 86400s;
    }

    # WebSocket: terminal
    location /terminal {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

**Important:** Both `/ws` and `/terminal` are WebSocket endpoints — make sure your proxy is configured to handle the `Upgrade` header for both.

### Caddy

```
claude.example.com {
    reverse_proxy localhost:3001
}
```

Caddy automatically handles WebSocket upgrades and TLS.

---

## Docker

### Dockerfile

```dockerfile
FROM node:20-slim

# Install build tools for node-pty
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./
COPY server/package.json server/
COPY client/package.json client/

# Install dependencies
RUN npm install
RUN cd server && npm install
RUN cd client && npm install

# Copy source
COPY . .

# Build client
RUN cd client && npx vite build

EXPOSE 3001

# Run in foreground (no PM2 in Docker)
CMD ["node", "--import", "tsx", "server/src/index.ts"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  claude-code-server:
    build: .
    ports:
      - "3001:3001"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - PORT=3001
    volumes:
      - ./projects:/app/projects    # Persist project data
    restart: unless-stopped
```

### Run

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

> **Note:** Use foreground mode in Docker (no PM2). Docker's own restart policy handles process management.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Custom API endpoint |
| `PORT` | `3001` | Server port |
| `PROJECTS_ROOT` | `./projects` | Project data directory |
| `SHELL` | `/bin/bash` | Shell for terminal PTY |
| `NODE_ENV` | — | Set to `production` by PM2 config |

### Using .env

Place a `.env` file in the project root:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx
PORT=3001
```

The setup script sources this file automatically. For PM2, environment variables from your shell are inherited.

---

## Monitoring & Logs

### PM2 Logs

```bash
npm run logs                          # Live stream
pm2 logs claude-code-server --lines 100  # Last 100 lines
```

Log files are at:
- `logs/out.log` — stdout
- `logs/error.log` — stderr

### PM2 Monitoring

```bash
pm2 monit              # Real-time CPU/memory dashboard
npm run status         # Process status snapshot
```

### Health Check

A simple way to check if the server is responding:

```bash
curl -s http://localhost:3001/api/projects | head -c 100
```

If it returns JSON, the server is healthy.

---

## Data Backup

### What to Back Up

| Path | Contents | Priority |
|------|----------|----------|
| `projects/.state.json` | All projects, jobs, and recent logs | **High** — this is the main state file |
| `projects/<name>/` | Project working directories (Claude's code) | **High** — actual project files |
| `.env` | API key and config | Medium |
| `ecosystem.config.cjs` | PM2 config (if customized) | Low |

### Backup Strategy

```bash
# Simple backup
tar czf backup-$(date +%Y%m%d).tar.gz projects/ .env

# Restore
tar xzf backup-20240101.tar.gz
```

### State File

`projects/.state.json` is written atomically (via temp file + rename). It's safe to copy at any time, though you may get a slightly stale snapshot if a job is actively running. For a consistent backup, stop the server first:

```bash
npm stop
cp -r projects/ /backup/projects/
npm start
```

---

## Security Considerations

> **Claude Code Server has no built-in authentication.** It's designed for trusted networks (localhost, VPN, or behind an authenticating reverse proxy).

### Recommendations

1. **Do not expose directly to the internet.** Always put it behind a reverse proxy with authentication.

2. **Use a reverse proxy for auth.** Options:
   - Nginx with HTTP Basic Auth
   - Caddy with `basicauth`
   - OAuth2 Proxy for SSO integration
   - Cloudflare Access or similar zero-trust solutions

3. **Restrict network access.** Bind to localhost only by modifying the server to listen on `127.0.0.1` instead of `0.0.0.0`, then proxy from your web server.

4. **Keep your API key secure.** Use `.env` files (add `.env` to `.gitignore`) or environment variables — never commit API keys.

5. **CORS is wide open.** The server uses `cors()` with no restrictions. In production behind a proxy, the proxy handles origin control.

6. **File access is scoped.** The file browser and memory editor have path traversal guards — files must resolve inside the project root or `~/.claude/`.

7. **Claude has full tool access.** The Claude agent can run Bash commands, read/write files, and access the network within its project directory. Treat it like a developer with shell access.
