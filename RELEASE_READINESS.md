# Ricky release-readiness gate

The command matrix is a verification step, not the first place to discover whether the bot is deployable. A release is **blocked** until every gate below is green.

## 1. Candidate configuration

On the intended bot host, keep the real `.env` outside Git and run:

```sh
npm ci
npm run preflight:deploy
```

The deploy preflight checks that credentials are present without printing them, the credentials file is private, every configured guild/channel/role ID has the right shape, the rank map is valid and non-empty, the award allow-list is present, and no Ricky container is already running on the cutover host. Set `DEPLOY_SSH_HOST` and `DEPLOY_SSH_DIR` when the check must inspect the remote host that will run the bot; set `DEPLOY_EXPECT_REMOTE_CHECK=true` to make that remote inspection mandatory. A failure is a no-go; it does not attempt to repair settings. `ALLOW_RUNNING_CONTAINER=true` is reserved for an explicitly approved non-cutover diagnostic and must not be used for a release.

For the sandbox, use the protected token/client credentials with the committed demo configuration:

```sh
npm run preflight:demo
```

The same composition is available to the deployment gate when credentials and
guild settings are kept in separate protected files:

```sh
DEPLOY_CONFIG_ENV_FILE=.env.demo.example npm run preflight:deploy
```

## 2. Startup gate

Ricky now refuses to serve commands unless its configured guild is reachable and all of the following pass at startup:

- required configuration keys and Discord ID formats;
- View Channel, Send Messages, Embed Links, Read Message History, Manage Roles, and Attach Files;
- every destination channel is in the configured guild and reachable with the required permissions;
- every activity source is in the configured guild and viewable;
- the existing `Personnel Administration Bureau` and `BCSO | Command Staff` authorization roles exist and are configured;
- every configured rank and allow-listed role exists and is manageable by Ricky's actual highest assigned role.
- all expected guild slash commands are registered before Ricky announces readiness.

The process exits with a redacted reason list instead of coming online partially configured. `/setup-status` and `/pab-health` remain read-only runtime checks for drift after startup.

## 3. Single-instance protection

Ricky creates a lock beside `PAB_DATA_PATH`; a second process using the same data volume exits before connecting to Discord. Docker also uses a fixed `container_name`, so Compose cannot intentionally run two local replicas under the same service name. The deploy preflight and cutover operator must still stop any old instance on another host: Discord does not expose a reliable “other host is running this token” API.

Before a cutover:

```sh
docker compose down
npm run preflight:deploy
docker compose up -d --build
docker compose logs -f --tail=100
```

Do not proceed until the log says **Startup readiness gate passed**.

## 4. Discord verification

After startup, a server administrator runs `/setup-status` and `/pab-health` and resolves every failed item. The bot must be above every configured rank/qualification role it may manage. PAB and Command members are intentionally not managed by Ricky; a target member at or above Ricky's highest role is refused at preview/approval time.

Run the sandbox command matrix from `COMMAND_TEST_REPORT.md` with harmless test roles and members. Confirm that each role-changing workflow has an approval step and that the published record, audit receipt, and destination channel are correct. Only then register/cut over to the live guild.

## No-go conditions

- any missing or malformed protected configuration;
- startup gate failure or any failed `/pab-health` item;
- more than one active instance for the token/guild;
- a bot role below a rank or allow-listed role;
- a role-changing command that can post or mutate without the expected human approval;
- an unreviewed change to the public repository or deployment image.
