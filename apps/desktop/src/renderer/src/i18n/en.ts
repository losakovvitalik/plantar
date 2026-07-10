import type { MessageKey } from "./ru";

export const en: Record<MessageKey, string> = {
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.close": "Close",
  "common.connect": "Connect",
  "common.connecting": "Connecting…",
  "common.back": "Back",
  "common.next": "Next",
  "common.loading": "Loading…",

  "app.unexpectedError": "Unexpected error: {message}",
  "app.settingsFromConfig":
    "Settings were loaded from plantar.json in the project folder.",
  "app.frameworkDetected": "Framework detected: {framework}. ",
  "app.settingsAutoDetected": "Settings were detected automatically. ",
  "app.checkAndAdd": "Review the values carefully and add the project.",
  "app.confirmRemoveServer":
    "Remove server “{name}” and its projects from the list?",
  "app.tabDeploy": "Deploy",
  "app.tabEnv": "Variables",
  "app.tabStatus": "Status",
  "app.tabLogs": "Logs",
  "app.tabHistory": "History",
  "app.tabCommits": "Commits",
  "app.projectSettings": "Project settings",
  "app.serverHint":
    "This is a server. Add a project via “+” in the list on the left to deploy.",
  "app.emptyAddServer": "Add your first server",
  "app.emptySelect": "Select a server or project",
  "app.emptyAddServerHint":
    "You will need an IP address and a password — your hosting provider gives you both. Plantar sets up everything else.",
  "app.emptySelectHint": "Your servers and their projects are on the left.",
  "app.settingsSaved":
    "Settings saved. They will apply to the app on the next deploy.",
  "app.newProject": "New project",
  "app.addProject": "Add project",

  "sidebar.servers": "Servers",
  "sidebar.addServer": "Add server",
  "sidebar.empty":
    "Nothing here yet. Add your first server — you will need the IP and password from your hosting provider.",
  "sidebar.addProject": "Add project",
  "sidebar.removeServer": "Remove server",
  "sidebar.removeProject": "Remove project from the list",
  "sidebar.settings": "Settings",

  "addServer.title": "Add server",
  "addServer.description":
    "You will need the server address and login credentials — your hosting provider gives you these.",
  "addServer.host": "Address (IP)",
  "addServer.port": "Port",
  "addServer.user": "User",
  "addServer.name": "Name (optional)",
  "addServer.namePlaceholder": "My server",
  "addServer.authMethod": "Login method",
  "addServer.keyTitle": "SSH key",
  "addServer.keyDescription":
    "Plantar will create a key and set it up on the server for you. Recommended.",
  "addServer.passwordTitle": "Password",
  "addServer.passwordDescription":
    "No key. The password will be requested on every connection.",
  "addServer.keyNote":
    "The password is needed once — to install the key on the server. Plantar does not store it.",
  "addServer.passwordNote":
    "The password is not stored anywhere. You will have to enter it on every connection to the server.",
  "addServer.serverPasswordOnce": "Server password (needed once)",
  "addServer.serverPassword": "Server password",
  "addServer.submit": "Add server",

  "deploy.running": "Deploying…",
  "deploy.start": "Deploy",
  "deploy.viaIp": "on IP",
  "deploy.noDomain": ", no domain",
  "deploy.showCommands": "Show commands",
  "deploy.deployedAt": "App deployed: {url}",
  "deploy.botDeployed": "Bot deployed and running.",
  "deploy.terminalEmpty": "Every deploy step will show up here.",
  "deploy.showMoreError": "Show more",
  "deploy.hideError": "Collapse",
  "deploy.copyError": "Copy",
  "deploy.errorCopied": "Copied",
  "deploy.updateAndDeploy": "Update and deploy",
  "deploy.notDeployedYet": "Not deployed yet",

  "commits.loading": "Loading commits…",
  "commits.empty": "No commits yet.",
  "commits.branchHint": "Branch {branch}",
  "commits.refresh": "Refresh",
  "commits.badge.onServer": "On the server",
  "commits.badge.deployed": "Deployed",
  "commits.badge.failed": "Deploy failed",
  "commits.badge.notDeployed": "Not deployed",

  "addProjectDialog.title": "New project",
  "addProjectDialog.description": "Where should the project code come from?",
  "addProjectDialog.gitDescription": "Paste a link to a GitHub repository.",
  "addProjectDialog.localTitle": "Folder on this computer",
  "addProjectDialog.localHint": "Pick a project folder on this computer.",
  "addProjectDialog.gitTitle": "GitHub repository",
  "addProjectDialog.gitHint": "Download the project from a repository link.",
  "addProjectDialog.repoUrl": "Repository link",
  "addProjectDialog.privateHint":
    "For private repositories, sign in to GitHub in settings first.",
  "addProjectDialog.branch": "Branch",
  "addProjectDialog.clone": "Download and continue",
  "addProjectDialog.cloning": "Downloading…",

  "github.loginTitle": "Sign in with GitHub",
  "github.loginDescription": "Confirm the sign-in on the GitHub website.",
  "github.enterCode": "Enter this code on the GitHub page that opened:",
  "github.openGithub": "Open GitHub again",
  "github.waiting": "Waiting for confirmation…",

  "env.banner":
    "Variables are stored on the server and apply on the next deploy: for React and Next.js at build time, while Node.js apps and bots receive a .env file next to the app. Plantar manages NODE_ENV automatically — you do not need to add it here. Local .env files from the project folder are never uploaded to the server.",
  "env.confirmDiscard": "Unsaved changes will be lost. Continue?",
  "env.loading": "Loading variables from the server…",
  "env.load": "Load variables",
  "env.passwordNeeded": "The server password will be required.",
  "env.emptyTitle": "No variables yet",
  "env.emptyHint":
    "Environment variables — such as an API address or a bot token — are stored on the server and apply on deploy.",
  "env.importHint":
    "Local files were found in the project folder — you can import their variables:",
  "env.refreshTitle": "Reload variables from the server",
  "env.refresh": "Refresh",
  "env.hideAll": "Hide all",
  "env.showAll": "Show all",
  "env.keyPlaceholder": "VARIABLE_NAME",
  "env.valuePlaceholder": "value",
  "env.hideValue": "Hide value",
  "env.showValue": "Show value",
  "env.removeVar": "Remove variable",
  "env.addVar": "Add variable",
  "env.savedFlash": "Saved ✓ — applies on the next deploy",
  "env.unsaved": "not saved",
  "env.noVarsInFile": "No variables in {file}.",

  "history.loadLogError": "Failed to open the log: {error}",
  "history.readingLog": "Reading the log…",
  "history.loading": "Loading history…",
  "history.emptyTitle": "No deploys yet",
  "history.emptyHint":
    "Every deploy attempt of this project will appear here — with its status, time and full log.",
  "history.duration": "in {duration}",
  "history.seconds": "{seconds} s",
  "history.minutesSeconds": "{minutes} min {seconds} s",
  "history.openSite": "Open site",

  "logs.sourceApp": "App",
  "logs.channelOutput": "Output",
  "logs.channelErrors": "Errors",
  "logs.channelRequests": "Requests",
  "logs.filterAll": "All",
  "logs.resume": "Resume",
  "logs.pause": "Pause",
  "logs.clear": "Clear",
  "logs.connectHint":
    "Live logs from the server — no terminal needed. The server password will be required.",
  "logs.reconnect": "Reconnect",
  "logs.disconnected": "The connection to the server was lost.",
  "logs.streamConnected": "Stream connected — new entries will appear here.",
  "logs.terminalEmpty": "Live logs will appear here.",
  "logs.statusPaused": "paused",
  "logs.statusLive": "live",
  "logs.statusConnecting": "connecting…",
  "logs.statusEnded": "disconnected",
  "logs.statusIdle": "not connected",

  "password.title": "Password for “{name}”",
  "password.description":
    "This server was added without a key, so the password is required on every connection.",

  "projectSettings.typeStaticLabel": "React",
  "projectSettings.typeStaticHint": "Static site: React, Vite and others",
  "projectSettings.typeNodeLabel": "Node.js",
  "projectSettings.typeNodeHint": "Server app: Express and others",
  "projectSettings.typeNextLabel": "Next.js",
  "projectSettings.typeNextHint": "Next.js with server build and runtime",
  "projectSettings.typeBotLabel": "Telegram bot",
  "projectSettings.typeBotHint": "Long-polling bot: grammY, aiogram and others",
  "projectSettings.nameError":
    "Name: only lowercase latin letters, digits and hyphens.",
  "projectSettings.portError": "Port: an integer from 1 to 65535.",
  "projectSettings.type": "Project type",
  "projectSettings.name": "Name",
  "projectSettings.nameHint":
    "Lowercase latin letters, digits and hyphens. This will be the name of the site folder on the server.",
  "projectSettings.domain": "Domain",
  "projectSettings.domainPlaceholder": "app.example.com",
  "projectSettings.domainHint":
    "With a domain the site gets an HTTPS certificate automatically. If left empty, the site opens by the server IP.",
  "projectSettings.runtime": "Runtime",
  "projectSettings.packageManager": "Package manager",
  "projectSettings.buildDir": "Build folder",
  "projectSettings.port": "Port",
  "projectSettings.portPlaceholder": "automatic",
  "projectSettings.buildCommand": "Build command",
  "projectSettings.buildCommandHint":
    "Runs in the project folder before deploy. Any command with flags works here, for example",
  "projectSettings.startCommand": "Start command",
  "projectSettings.botStartHint":
    "This is how the bot starts on the server (via pm2). The token and other secrets are set on the Variables tab.",
  "projectSettings.nodeStartHintBefore":
    "This is how the app starts on the server (via pm2). The port is passed to the app in the",
  "projectSettings.nodeStartHintAfter":
    " variable; if the Port field is empty, a free port is picked on the first deploy.",
  "projectSettings.deploy": "Deploy",
  "projectSettings.subdir": "Project folder in the repository",
  "projectSettings.subdirRoot": "Repository root",
  "projectSettings.subdirPick": "Choose folder",
  "projectSettings.subdirHint":
    "Set a folder if the project is not at the repository root (for example, in a monorepo). Defaults to the root.",

  "removeProject.title": "Remove project “{name}”?",
  "removeProject.description":
    "The local project folder will stay in place either way.",
  "removeProject.fromList": "Remove from the list",
  "removeProject.fromListHint":
    " — the project disappears from Plantar but keeps running on the server.",
  "removeProject.fromServer": "Delete from the server",
  "removeProject.fromServerHint":
    " — stops the process, removes it from autostart and deletes the project files from the server (for sites, the nginx config too).",
  "removeProject.removing": "Deleting…",

  "status.checking": "Checking…",
  "status.check": "Check server",
  "status.supported": "supported",
  "status.unsupported": "not supported",
  "status.cpu": "CPU: {count}",
  "status.ram": "RAM: {mb} MB",
  "status.disk": "Disk: {gb} GB free",
  "status.tools": "Tools",
  "status.notInstalled": "not installed",

  "settings.title": "Settings",
  "settings.description": "Global Plantar settings",
  "settings.language": "Interface language",
  "settings.logCopies": "Keep copies of server logs",
  "settings.logCopiesHint":
    "Every time you view logs, the latest version is saved to this computer — it stays available even if the server stops responding.",
  "settings.notifySuccess": "Notify about successful deploys",
  "settings.notifySuccessHint":
    "A system notification when a deploy finishes successfully. Error notifications always arrive.",
  "settings.leEmail": "Email for SSL certificates",
  "settings.leEmailHint":
    "Let's Encrypt will email you if certificate auto-renewal goes wrong. Applies on the next deploy with a domain. Can be left empty.",

  "settings.github": "GitHub account",
  "settings.githubHint": "Sign in to deploy private repositories from a link.",
  "settings.githubConnected": "Connected as @{login}.",
  "settings.githubConnect": "Sign in with GitHub",
  "settings.githubSignOut": "Sign out",
};
