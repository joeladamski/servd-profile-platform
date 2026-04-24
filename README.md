# Servd.Pro Profile Platform (Compose + Traefik + Node + Postgres)

This repository contains a minimal, beginner-friendly profile platform stack:

- **Traefik v2.11** reverse proxy with Let's Encrypt
- **Node.js + Express** application
- **Postgres 16 Alpine** database

It routes:

- `https://get.servd.pro` -> app
- `https://traefik.servd.pro` -> Traefik dashboard

## Architecture

- **traefik** handles HTTPS termination and routing using Docker labels.
- **app** serves signup/login, dashboard editing, and public profile pages.
- **db** stores users, sessions, profiles, and links.
- **uploads/** stores processed avatar images.
- **letsencrypt/acme.json** stores ACME certificates.

## File structure

```text
.
├── docker-compose.yml
├── .env.example
├── README.md
├── letsencrypt/
│   └── .gitkeep
├── uploads/
│   └── .gitkeep
└── app/
    ├── .dockerignore
    ├── Dockerfile
    ├── package.json
    └── server.js
```

## Prerequisites

- Docker + Docker Compose plugin installed on your VPS
- DNS records configured:
  - `get.servd.pro` -> your VPS public IP
  - `traefik.servd.pro` -> your VPS public IP
- Ports **80** and **443** open to the internet

## Setup

1. Copy environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and set strong values for:

- `POSTGRES_PASSWORD`
- `SESSION_SECRET`

3. Prepare ACME storage file (required for Traefik):

```bash
mkdir -p letsencrypt
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json
```

> `letsencrypt/acme.json` must exist and be `chmod 600` on the server.

4. Start the stack:

```bash
docker compose up -d --build
```

5. Check logs if needed:

```bash
docker compose logs -f traefik
docker compose logs -f app
```

## App behavior

- **Auth**: signup/login with username + password
- **Session store**: Postgres-backed sessions
- **Dashboard**:
  - edit display name and bio
  - upload avatar image (JPG, PNG, WEBP)
  - avatar is resized/cropped square and saved as WEBP
  - manage links via simple `Label | URL` lines
- **Public profile**: `/u/:username`
  - large centered avatar (~220px)
  - display name, username, bio
  - stacked links
  - dark/gold premium style

## Notes

- Traefik dashboard is only exposed through HTTPS host routing (`traefik.servd.pro`) and **not** via public port `8080`.
- Postgres data is persisted in named volume `postgres_data`.
- Uploaded images are persisted using bind mount `./uploads:/app/uploads`.

## Validation commands

You can run these checks:

```bash
node --check app/server.js
docker compose config
```

If both commands pass, syntax and Compose config are valid.
