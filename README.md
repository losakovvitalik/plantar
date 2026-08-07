# Plantar

A desktop application for quickly deploying React, Next.js and Node.js apps to Ubuntu servers.

Aimed first and foremost at non-programmers. A user with any level of computer skills should be able to deploy an application without manually connecting to a server and running commands.

## Installation

Ready-made builds can be downloaded from the [latest release](https://github.com/losakovvitalik/plantar/releases/latest) page:

- **macOS** — the `.dmg` file (`arm64` for Apple Silicon, `x64` for Intel).
- **Windows** — the `.exe` file.
- **Linux** — the `.AppImage` file.

The builds are not code-signed yet, so the operating system will be suspicious of the app on first launch:

- **macOS**: the system shows an "App 'Plantar' is damaged" dialog — the file is actually fine, macOS just doesn't recognize the publisher. Drag Plantar into the Applications folder, then open the Terminal app (find it via Spotlight search — the magnifying glass in the top-right corner of the screen), paste the line below and press Enter:

  ```
  xattr -cr /Applications/Plantar.app
  ```

  After that Plantar opens like a regular application. This needs to be done once after installing or updating.
- **Windows**: in the "Windows protected your PC" dialog click "More info", then "Run anyway".

## Main scenario

1. Connect to a server over SSH.
2. Prepare the server: check the OS, resources, access and dependencies.
3. Deploy a React, Next.js, Node.js application or a Telegram bot.
4. Show logs. The deploy process should be transparent.
5. Run again without breaking anything. Idempotency matters.
6. Fail clearly and show what went wrong.

## Principles

- Local-first: all operations run on the user's computer.
- No external backend service for deployment.
- SSH credentials and env variables must not leave the user's device. The single deliberate exception is "Deploy on commit": it creates a dedicated deploy key (not the user's personal key), and that key together with the server address is stored in GitHub Secrets — otherwise GitHub Actions could not deploy without the app.
- The user should see which actions are executed on the server.
- The GUI must not contain deploy logic, only call the shared core.

## MVP

Historical note: this was the scope of the first version. Today Plantar deploys static sites, Node.js and Next.js applications and Telegram bots (`static | node | next | bot`) — see [docs/features.md](docs/features.md) for the current feature set.

- Ubuntu 22.04 / 24.04.
- React applications.
- Node.js.
- pnpm.
- pm2.
- nginx.
- Let's Encrypt.

## Architecture

Two independent parts: CLI (`apps/cli`) and GUI (`apps/desktop`).

This simplifies development and testing. The CLI will be usable on its own if someone doesn't want to use the UI. But the CLI's primary job is to serve the desktop application.

The shared deploy logic lives in separate packages:

```text
packages/
  core/     # deploy engine
  ssh/      # SSH connection and file transfer
  config/   # plantar.json schema and project detection
  storage/  # local data: servers, projects, history, settings
  i18n/     # translation helper for Node code
  mcp/      # MCP server exposing Plantar to AI assistants
```

## Stack

- TypeScript.
- Node.js.
- commander.
- ssh2.
- zod.
- JSON files for local storage.

## Roadmap

- Connect to a server over SSH.
- Check the OS and basic server information.
- Install Node.js, pnpm, pm2, nginx and certbot.
- Deploy a React application.
- Configure nginx.
- Issue an SSL certificate.
- View logs.
- Redeploy without breaking the existing configuration.
- Local storage: project config (`plantar.json`), deploy history, logs.
- Server and key storage: secrets are encrypted via the system keychain (`safeStorage`); when the keychain is unavailable, the key is stored in a file restricted to the current user (mode `0600`) instead.
- Desktop GUI.

## Status

The project is at an early stage of development. For now, don't use it on production servers without manually reviewing the commands it runs.

## License

The project is distributed under the [MIT](LICENSE) license.
