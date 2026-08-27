# Ricky Bot — Continuity and Succession Plan

This plan is for continuity if the current owner/operator becomes unavailable, including death or permanent loss of access. It is written so a designated successor can keep Ricky Bot running without putting personnel data or credentials in the public repository.

## What is transferable

- **Source:** the public GitHub repository, [union95bb2/bcso-ricky-personnel-bot](https://github.com/union95bb2/bcso-ricky-personnel-bot).
- **Runtime:** the PiCam host at `/mnt/ssd/services/bcso-personnel-bot`, managed with Docker Compose.
- **Private state:** `data/pab.sqlite`, `data/rms.sqlite` (when RMS is enabled), `data/runtime-config.json`, and encrypted backups. These are not in GitHub.
- **Discord application:** the Ricky Bot application, bot token, client secret, OAuth redirect settings, and the Discord server ownership/account relationship.
- **Optional infrastructure:** PiCam SSH access, reverse proxy/DNS/Cloudflare access for RMS, and any external Google Sheet credentials.

## Important ownership limitation

An Administrator role does **not** transfer Discord server ownership. Discord ownership can only be transferred by the current server owner through Discord's server settings/account process. The sandbox's live-style `IAA Director` role grants full sandbox administration for testing; it is not a legal or technical substitute for ownership transfer and must never be copied into the live server without an explicit owner decision.

## Before an emergency

1. Name at least two successors and record their Discord IDs, GitHub accounts, and contact methods in the private continuity record.
2. Give successors access to the approved password manager vault containing the Discord application, PiCam SSH key, deployment secrets, Cloudflare/DNS account (if RMS is public), and backup encryption key. Never put these values in GitHub, Discord, or this document.
3. Add successors as GitHub maintainers with the minimum repository access needed. Keep the repository public, but keep `.env`, SQLite files, OAuth secrets, and bot tokens private.
4. Maintain encrypted, tested backups of `data/`, the protected runtime configuration, and the deployment notes. Keep at least one backup off the PiCam.
5. Review the designated successors at least quarterly and remove access when a person leaves the project.

## Successor takeover procedure

1. **Secure the accounts.** Take control of the designated password-manager entry, GitHub repository, Discord application, PiCam, and any DNS/proxy account. Do not reuse the prior owner's personal password.
2. **Transfer Discord ownership.** The current Discord owner transfers the sandbox/live server to the designated successor through Discord. If the owner is deceased or inaccessible, use Discord's current support/account-recovery process; an Administrator role alone cannot complete this step.
3. **Rotate credentials.** Regenerate the Discord bot token and client secret, rotate OAuth/session secrets, revoke the prior owner's access, and update only the protected host `.env` files. Do not paste secrets into tickets or Discord.
4. **Recover the host.** If the PiCam is healthy, verify the service directory and backups. If it is not, clone the public repository onto a replacement host, restore the encrypted `data/` backup, recreate the protected `.env`, and start with `docker compose up -d --build`.
5. **Run release gates.** Run `npm ci`, `npm run preflight:deploy`, `/setup-status`, and `/pab-health`. Resolve every failed channel, permission, role-hierarchy, OAuth, or backup check before allowing staff use.
6. **Verify the records path.** Run one harmless sandbox training record, one approval preview, one correction lookup, and one `/export-audit` backup. Confirm that records, audit events, and direct links are durable after a container restart.
7. **Re-establish the staff roster.** Confirm PAB, Command, and successor access from current Discord roles. Review the sandbox `IAA Director` assignments and remove any person who is no longer authorized.
8. **Document the handoff.** Record the date, successor, rotated credential identifiers (not secret values), restored backup, test results, and any unresolved risks in the private operations log.

## Data and privacy rules

Ricky Bot's public source is not the personnel database. Discord channels, the PiCam SQLite files, runtime routing overrides, and encrypted backups contain operational or personnel information and must remain access-controlled. Do not upload them to the public repository or attach them to a public Discord channel. Use `/export-audit` only for an approved private backup/review and follow the server's retention policy.

## If the PiCam is lost

The public source can be restored, but the service cannot be reconstructed from GitHub alone: the successor also needs the protected `.env`, Discord application credentials, the latest encrypted `data/` backup, and any RMS reverse-proxy/OAuth configuration. If no usable backup exists, start the bot in a new sandbox, rotate all credentials, and treat historical local receipts as unavailable rather than fabricating records.

## Review cadence

The owner or PAB administrator should test restore and succession access at least quarterly, after any Discord role/channel redesign, and after every major Ricky Bot release. A successful test is one in which a successor can operate the sandbox without the original owner's personal account or undocumented knowledge.
