# Install Docker on Ubuntu 16.04.3 LTS

> **Note:** Ubuntu 16.04 is EOL (End of Life). Consider upgrading to Ubuntu 20.04 or 22.04 for better security and support.

## Prerequisites

```bash
# Update package index
sudo apt-get update

# Install required packages
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg-agent \
    software-properties-common
```

## Step 1: Add Docker's Official GPG Key

```bash
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -

# Verify the key
sudo apt-key fingerprint 0EBFCD88
```

## Step 2: Add Docker Repository

```bash
sudo add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"
```

## Step 3: Install Docker Engine

```bash
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io
```

## Step 4: Verify Docker Installation

```bash
sudo docker --version
sudo docker run hello-world
```

## Step 5: Add User to Docker Group (Optional)

This allows running Docker without `sudo`:

```bash
sudo usermod -aG docker $USER

# Log out and log back in, or run:
newgrp docker

# Verify
docker run hello-world
```

## Step 6: Install Docker Compose

```bash
# Download Docker Compose (v2.24.0 - latest stable for older systems)
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make executable
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker-compose --version
```

## Step 7: Configure Docker to Start on Boot

```bash
sudo systemctl enable docker
sudo systemctl start docker

# Check status
sudo systemctl status docker
```

## Step 8: Configure Docker Daemon (Optional)

Create or edit `/etc/docker/daemon.json`:

```bash
sudo nano /etc/docker/daemon.json
```

Add recommended settings:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
```

Restart Docker:

```bash
sudo systemctl restart docker
```

## Troubleshooting

### Docker daemon not starting

```bash
# Check logs
sudo journalctl -u docker.service

# Check Docker status
sudo systemctl status docker
```

### Permission denied errors

```bash
# Ensure user is in docker group
groups $USER

# If not, add and re-login
sudo usermod -aG docker $USER
```

### Old kernel issues on Ubuntu 16.04

```bash
# Update kernel if needed
sudo apt-get install --install-recommends linux-generic-hwe-16.04
sudo reboot
```

## Uninstall Docker (if needed)

```bash
sudo apt-get purge docker-ce docker-ce-cli containerd.io
sudo rm -rf /var/lib/docker
sudo rm -rf /var/lib/containerd
```

---

## Quick Reference Commands

| Command | Description |
|---------|-------------|
| `docker ps` | List running containers |
| `docker ps -a` | List all containers |
| `docker images` | List images |
| `docker-compose up -d` | Start services in background |
| `docker-compose down` | Stop services |
| `docker-compose logs -f` | Follow logs |
| `docker system prune` | Clean up unused resources |
