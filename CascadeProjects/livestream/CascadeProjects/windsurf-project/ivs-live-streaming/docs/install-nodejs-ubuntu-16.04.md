# Install Node.js on Ubuntu 16.04.3 LTS

This project requires **Node.js 18.x LTS** or higher for the backend.

> **Note:** Ubuntu 16.04 is EOL. Node.js 18+ requires glibc 2.28+, which Ubuntu 16.04 doesn't have natively. We'll use NVM (Node Version Manager) for installation.

## Prerequisites

```bash
sudo apt-get update
sudo apt-get install -y curl build-essential
```

## Option 1: Using NVM (Recommended)

NVM allows you to install and manage multiple Node.js versions.

### Step 1: Install NVM

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

### Step 2: Load NVM

```bash
# Add to your shell profile
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Or simply restart your terminal
source ~/.bashrc
```

### Step 3: Install Node.js 18 LTS

```bash
nvm install 18
nvm use 18
nvm alias default 18
```

### Step 4: Verify Installation

```bash
node --version   # Should show v18.x.x
npm --version    # Should show 9.x.x or higher
```

## Option 2: Using NodeSource Repository

### Step 1: Add NodeSource Repository

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
```

### Step 2: Install Node.js

```bash
sudo apt-get install -y nodejs
```

### Step 3: Verify Installation

```bash
node --version
npm --version
```

## Install PM2 (Process Manager)

PM2 keeps your Node.js application running and restarts it on crashes.

```bash
npm install -g pm2
```

### PM2 Commands

```bash
# Start application
pm2 start dist/server.js --name ivs-backend

# View running processes
pm2 list

# View logs
pm2 logs ivs-backend

# Restart application
pm2 restart ivs-backend

# Stop application
pm2 stop ivs-backend

# Delete from PM2
pm2 delete ivs-backend

# Save current process list
pm2 save

# Setup startup script (run on boot)
pm2 startup
```

## Backend Deployment Steps

### Step 1: Clone/Copy Backend Files

```bash
sudo mkdir -p /data/www/ivs-streaming/backend
cd /data/www/ivs-streaming/backend

# Copy your backend files here
```

### Step 2: Install Dependencies

```bash
npm install --production
```

### Step 3: Build TypeScript

```bash
npm run build
```

### Step 4: Configure Environment

```bash
cp .env.example .env
nano .env
# Edit with your production values
```

### Step 5: Start with PM2

```bash
pm2 start dist/server.js --name ivs-backend
pm2 save
pm2 startup
```

## Troubleshooting

### Node.js version not found

```bash
# List available versions
nvm ls-remote --lts

# Install specific version
nvm install 18.19.0
```

### Permission errors with npm global packages

```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### glibc version issues on Ubuntu 16.04

If you encounter glibc errors with Node.js 18+, you have two options:

**Option A:** Use Node.js 16 (older but compatible)
```bash
nvm install 16
nvm use 16
```

**Option B:** Use Docker (recommended for production)
```bash
# The backend Dockerfile uses Node.js 20 in a container
cd /data/www/ivs-streaming/backend
docker-compose up -d
```

### Check if Node.js is running

```bash
pm2 status
pm2 logs ivs-backend --lines 50
```

### Memory issues

```bash
# Increase Node.js memory limit
pm2 start dist/server.js --name ivs-backend --node-args="--max-old-space-size=512"
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `node --version` | Check Node.js version |
| `npm --version` | Check npm version |
| `nvm ls` | List installed Node.js versions |
| `nvm use 18` | Switch to Node.js 18 |
| `pm2 list` | List running processes |
| `pm2 logs` | View application logs |
| `pm2 restart all` | Restart all applications |

## Required Node.js Version

This project requires:
- **Node.js:** 18.x LTS or higher
- **npm:** 9.x or higher

The backend uses:
- Express.js 4.x
- TypeScript
- AWS SDK v3
- PostgreSQL client (pg)
