# Ricky RMS on PiCam

Ricky RMS is a structured personnel database and PAB dashboard. It is designed for the existing `picam` host: Debian 12, ARM64 Raspberry Pi 4, Docker, and the SSD-backed `/mnt/ssd` storage. The RMS should not replace the existing Caddy/Cloudflare stack; it should be added as a private application behind the existing reverse-proxy controls.

The candidate release is staged at `/mnt/ssd/services/bcso-ricky` on PiCam. The existing `/mnt/ssd/containers` directory is root-owned, so this separate service directory is the safe staging location unless the host administrator later chooses a root-managed Compose location.

## What is deployed

- `bcso-personnel-bot`: Discord intake, approvals, role gates, and notifications.
- `ricky-rms`: authenticated web dashboard and RMS API.
- `data/rms.sqlite`: structured RMS database on the persistent SSD-backed data mount.
- `data/pab.sqlite`: existing Ricky v1 ledger retained during migration and rollback.

The two services use separate database files. The RMS does not mutate Discord roles merely because a database record changes.

## First deployment

1. Copy the repository to a PiCam application directory under the existing SSD-backed container tree.
2. Keep the existing bot environment protected. Add these values to the protected `.env`:

```text
RMS_GUILD_ID=<BCSO guild ID>
RMS_DISCORD_CLIENT_ID=<Discord application client ID>
RMS_DISCORD_CLIENT_SECRET=<Discord OAuth client secret>
RMS_DISCORD_BOT_TOKEN=<same protected bot token used for guild membership verification>
RMS_DISCORD_REDIRECT_URI=https://rms.<approved-domain>/auth/callback
RMS_SESSION_SECRET=<long random value>
RMS_BIND=0.0.0.0
RMS_PORT=8788
RMS_DATA_PATH=/app/data/rms.sqlite
RMS_ENABLED=true
RMS_ADMIN_ROLE_IDS=<server-admin role IDs, comma separated>
RMS_DEV_LOGIN=false
```

3. Add the exact redirect URI to the Discord application's OAuth2 settings. Use the existing PiCam Caddy/Cloudflare route; do not expose the Node port directly to the Internet.
   The staged Compose service joins the existing `the57-web` Docker network. The corresponding Caddy site block should be reviewed and then added to the host configuration:

```caddyfile
http://rms.the57consulting.com {
    reverse_proxy ricky-rms:8788
}
```

   Reload Caddy only after the RMS container is healthy and the DNS/Cloudflare route has been verified.
4. Run the existing bot only first and verify `/pab-health`.
5. Run the idempotent migration before opening the dashboard:

```bash
node scripts/migrate-pab-to-rms.mjs
```

6. Start the RMS profile:

```bash
docker compose --profile rms up -d --build ricky-rms
```

7. Verify locally from the host or through the approved private route:

```bash
curl -fsS http://127.0.0.1:8788/api/health
```

## Account and access model

RMS accounts are individual Discord identities. There are no shared passwords. On every login Ricky verifies that the Discord identity is currently a member of the configured guild, derives access from current Discord roles, and records the login.

- `member`: own profile and own finalized records only.
- `pab`: member search, personnel timelines, and PAB approval queue.
- `command`: PAB access plus command audit trail and final approval visibility.
- `admin`: operational administration and audit access.

Every login, search, profile view, approval-queue view, and audit view is recorded. Future record writes and Discord approvals will write the same audit trail.

## Rollback and backups

Do not delete `data/pab.sqlite` during the RMS pilot. The existing PiCam backup job should include the RMS data directory, and a SQLite-consistent backup should be taken before migrations or schema upgrades. Stop `ricky-rms` before copying `rms.sqlite` for a manual rollback backup.

The first release is intentionally read/search oriented. Discord remains the controlled write path until RMS record writes and approval state are validated in the sandbox.
