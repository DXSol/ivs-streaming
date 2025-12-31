# Install Let's Encrypt SSL with Apache on Ubuntu 16.04.3 LTS

> **Note:** Ubuntu 16.04 is EOL. The Certbot PPA may have limited support. Consider upgrading to Ubuntu 20.04+.

## Prerequisites

- Apache2 installed and running
- Domain pointing to your server's IP
- Ports 80 and 443 open in firewall/security group

```bash
# Verify Apache is running
sudo systemctl status apache2

# Verify domain resolves to your server
dig +short events.edifyplus.com
```

## Step 1: Add Certbot PPA Repository

```bash
sudo apt-get update
sudo apt-get install -y software-properties-common
sudo add-apt-repository ppa:certbot/certbot
sudo apt-get update
```

## Step 2: Install Certbot for Apache

```bash
sudo apt-get install -y python-certbot-apache
```

## Step 3: Obtain SSL Certificate

### Option A: Automatic (Recommended)

Certbot will automatically configure Apache:

```bash
sudo certbot --apache -d events.edifyplus.com
```

Follow the prompts:
1. Enter email address for renewal notifications
2. Agree to Terms of Service
3. Choose whether to redirect HTTP to HTTPS (recommended: Yes)

### Option B: Certificate Only (Manual Configuration)

If you prefer to configure Apache manually:

```bash
sudo certbot certonly --apache -d events.edifyplus.com
```

Certificates will be saved to:
- Certificate: `/etc/letsencrypt/live/events.edifyplus.com/fullchain.pem`
- Private Key: `/etc/letsencrypt/live/events.edifyplus.com/privkey.pem`

## Step 4: Verify SSL Configuration

```bash
# Test Apache configuration
sudo apache2ctl configtest

# Restart Apache
sudo systemctl restart apache2

# Test HTTPS
curl -I https://events.edifyplus.com
```

## Step 5: Configure Auto-Renewal

Let's Encrypt certificates expire every 90 days. Set up automatic renewal:

```bash
# Test renewal (dry run)
sudo certbot renew --dry-run
```

### Add Cron Job for Auto-Renewal

```bash
sudo crontab -e
```

Add this line (runs twice daily):

```
0 0,12 * * * certbot renew --quiet --post-hook "systemctl reload apache2"
```

### Or use Systemd Timer (Alternative)

```bash
# Check if timer exists
sudo systemctl list-timers | grep certbot

# Enable timer if not active
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

## Step 6: Verify Certificate

```bash
# Check certificate details
sudo certbot certificates

# Check expiry date
echo | openssl s_client -servername events.edifyplus.com -connect events.edifyplus.com:443 2>/dev/null | openssl x509 -noout -dates
```

## Apache SSL Configuration

If you used `certonly`, add this to your Apache virtual host:

```apache
<VirtualHost *:443>
    ServerName events.edifyplus.com
    DocumentRoot /var/www/ivs-streaming/www

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/events.edifyplus.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/events.edifyplus.com/privkey.pem

    # Modern SSL configuration
    SSLProtocol all -SSLv2 -SSLv3 -TLSv1 -TLSv1.1
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    SSLHonorCipherOrder off

    # ... rest of your configuration
</VirtualHost>
```

Enable SSL module and restart:

```bash
sudo a2enmod ssl
sudo systemctl restart apache2
```

## Multiple Domains

To add multiple domains to one certificate:

```bash
sudo certbot --apache -d events.edifyplus.com -d www.events.edifyplus.com
```

## Troubleshooting

### Challenge failed

```bash
# Ensure port 80 is open
sudo ufw allow 80
sudo ufw allow 443

# Check Apache is serving the domain
curl http://events.edifyplus.com
```

### Certificate not found

```bash
# List all certificates
sudo certbot certificates

# Check directory
ls -la /etc/letsencrypt/live/
```

### Renewal failed

```bash
# Check renewal configuration
cat /etc/letsencrypt/renewal/events.edifyplus.com.conf

# Force renewal
sudo certbot renew --force-renewal
```

### Apache won't start after SSL config

```bash
# Check syntax
sudo apache2ctl configtest

# Check error log
sudo tail -50 /var/log/apache2/error.log
```

## Revoke and Delete Certificate (if needed)

```bash
sudo certbot revoke --cert-path /etc/letsencrypt/live/events.edifyplus.com/cert.pem
sudo certbot delete --cert-name events.edifyplus.com
```

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `sudo certbot --apache -d domain.com` | Get certificate and auto-configure |
| `sudo certbot certonly --apache -d domain.com` | Get certificate only |
| `sudo certbot renew` | Renew all certificates |
| `sudo certbot renew --dry-run` | Test renewal |
| `sudo certbot certificates` | List all certificates |
| `sudo certbot delete --cert-name domain.com` | Delete a certificate |

## Security Headers (Recommended)

Add to your Apache config for better security:

```apache
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
Header always set X-Content-Type-Options "nosniff"
Header always set X-Frame-Options "SAMEORIGIN"
Header always set X-XSS-Protection "1; mode=block"
```

Enable headers module:

```bash
sudo a2enmod headers
sudo systemctl restart apache2
```
