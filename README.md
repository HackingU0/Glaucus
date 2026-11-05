# Glaucus

An engineering notebook tool for FTC teams: record in Discord or on the web, AI organizes it into drafts, and team members review and archive them. See [docs/design.md](docs/design.md) for the design.

## Deploying to a VPS

Requirements: a VPS with Docker installed (2 GB+ RAM recommended; builds are relatively memory-intensive), a domain, and a Discord application.

1. **Domain**: Point the domain's A record to the VPS. Open ports 80 and 443 (TCP), and 443 (UDP, optional) in the firewall.
2. **Discord**: On the application page in the [Developer Portal](https://discord.com/developers/applications):
   - OAuth2 → Redirects: add `https://your-domain/auth/callback`.
   - Bot → enable Message Content Intent.
   - Invite the bot to the server and give its role Manage Threads. The settings page checks these and provides an invite link.
3. **Code**: For a private repository, first add a read-only Deploy key on GitHub, then:

   ```bash
   git clone git@github.com:HackingU0/Glaucus.git
   ```

   ```bash
   cd Glaucus && echo "DOMAIN=your-domain" > .env
   ```

4. **Start**:

   ```bash
   docker compose up -d --build
   ```

5. **Setup**: Retrieve the setup token, open `https://your-domain`, and fill in the page. The token changes on every restart.

   ```bash
   docker compose logs app
   ```

Only one instance can run with the same bot token; otherwise every command will be responded to twice. Stop local services before deploying.

## Routine Maintenance

Update:

```bash
git pull && docker compose up -d --build
```

View logs:

```bash
docker compose logs -f app
```

Change settings: edit `settings.json` in the `glaucus-data` volume and restart, or delete it and go through the setup page again (everyone will need to log in again).

All data and keys are in the `glaucus-data` volume. `docker compose down -v` also deletes the volume; do not run it in production.

## Local Development

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev
```

Set `DEV_LOGIN=1` in `.env` to use a test account and sample data without Discord. Tests and type checks:

```bash
npm test
```

```bash
npm run check
```
