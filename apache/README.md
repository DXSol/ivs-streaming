# Apache2 Configuration for IVS Live Streaming

## Prerequisites

Enable required Apache modules:

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite headers ssl deflate
sudo systemctl restart apache2
```

## Installation Steps

### 1. Copy frontend files to web directory

```bash
sudo mkdir -p /var/www/ivs-streaming
sudo cp -r www/* /var/www/ivs-streaming/www/
sudo chown -R www-data:www-data /var/www/ivs-streaming
```

### 2. Copy Apache configuration

```bash
# Frontend configuration (includes API proxy)
sudo cp apache/frontend.conf /etc/apache2/sites-available/ivs-streaming.conf

# Enable the site
sudo a2ensite ivs-streaming.conf
```

### 3. Obtain SSL certificates (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d events.edifyplus.com
```

### 4. Start the backend

```bash
cd /var/www/ivs-streaming/backend
npm install --production
npm run build

# Using PM2 (recommended)
pm2 start dist/server.js --name ivs-backend
pm2 save
pm2 startup
```

### 5. Restart Apache

```bash
sudo systemctl restart apache2
```

## Configuration Files

| File | Purpose |
|------|---------|
| `frontend.conf` | Main config - serves frontend + proxies /api to backend |
| `backend.conf` | Optional - only if backend needs separate subdomain |

## Architecture

```
Internet
    │
    ▼
Apache2 (80/443)
    │
    ├── Static files (/var/www/ivs-streaming/www)
    │   └── Angular SPA with fallback to index.html
    │
    └── /api/* → Proxy to localhost:5050
                    │
                    ▼
              Node.js Backend
                    │
                    ▼
              PostgreSQL (5432)
```

## Environment Variables for Backend

Create `/var/www/ivs-streaming/backend/.env`:

```env
PORT=5050
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_NAME=ivs_live

# JWT
JWT_SECRET=your_jwt_secret_min_32_chars
JWT_ISSUER=ivs-live-streaming

# AWS
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# IVS Playback Authorization
IVS_PLAYBACK_KEY_PAIR_ID=your_key_pair_id
IVS_PLAYBACK_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----
your_private_key_here
-----END EC PRIVATE KEY-----"
```

## Troubleshooting

### Check Apache status
```bash
sudo systemctl status apache2
sudo apache2ctl configtest
```

### Check logs
```bash
tail -f /var/log/apache2/ivs-streaming-error.log
tail -f /var/log/apache2/ivs-streaming-access.log
```

### Check backend status
```bash
pm2 status
pm2 logs ivs-backend
```
