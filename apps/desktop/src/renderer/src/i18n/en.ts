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
  "app.tabFiles": "Files",
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
  "app.discoverApps": "Find apps",
  "app.externalBadge": "External",
  "app.externalBadgeHint":
    "This app was running on the server before Plantar. Restoring the previous version becomes available after the first deploy via Plantar.",

  "sidebar.servers": "Servers",
  "sidebar.addServer": "Add server",
  "sidebar.empty":
    "Nothing here yet. Add your first server — you will need the IP and password from your hosting provider.",
  "sidebar.addProject": "Add project",
  "sidebar.search.placeholder": "Search",
  "sidebar.search.empty": "Nothing found",
  "sidebar.collapseProjects": "Collapse projects",
  "sidebar.expandProjects": "Expand projects",
  "sidebar.removeServer": "Remove server",
  "sidebar.removeProject": "Remove project from the list",
  "sidebar.settings": "Settings",
  "sidebar.status.refresh": "Check app statuses",
  "sidebar.status.running": "Running",
  "sidebar.status.stopped": "Not running",
  "sidebar.status.error": "Error — the app is down",
  "sidebar.status.unresponsive": "The site is not responding",
  "sidebar.status.unknown": "Status unknown",
  "sidebar.status.checking": "Checking…",
  "sidebar.status.server.checking": "Checking…",
  "sidebar.status.server.ok": "Server is reachable",
  "sidebar.status.server.unreachable": "No connection to the server",
  "sidebar.status.server.needsPassword": "Status unknown — password required",
  "sidebar.status.checkedAt": "checked {time}",
  "sidebar.deploying.deploy": "Deploy in progress",
  "sidebar.deploying.rollback": "Rolling back to the previous version",

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
  "addServer.fromSshConfig": "Found in this computer's SSH settings",
  "addServer.existingKeyTitle": "Key already set up",
  "addServer.existingKeyDescription":
    "Signing in with an SSH key already works — just point to the key file.",
  "addServer.existingKeyNote":
    "For hosting providers that do not give out a password: the key was added via the hosting panel, and Plantar will sign in with it. No password needed.",
  "addServer.keyFile": "Key file",
  "addServer.pickKeyFile": "Choose file…",
  "addServer.noKeysFound":
    "No ready-made keys were found on this computer — choose the key file manually.",
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
  "deploy.peerConflictHint":
    "You can correct the versions in the project itself. Alternatively, install the dependencies in compatibility mode — after a successful deploy it will be kept for future deploys as well.",
  "deploy.compatRetry": "Try compatibility mode",
  "deploy.updateAndDeploy": "Update and deploy",
  "deploy.notDeployedYet": "Not deployed yet",
  "deploy.rollback": "Restore previous version",
  "deploy.rollingBack": "Restoring…",
  "deploy.rollbackConfirm":
    "Restore the previous version of the app on the server? The current version will be stopped.",
  "deploy.rollbackExternalHint":
    "Restoring the previous version becomes available after the first deploy via Plantar.",
  "deploy.rolledBackAt": "Previous version restored: {url}",
  "deploy.rolledBackDone": "Previous version restored.",
  "deploy.externalHint":
    "This app was imported from the server. Logs and variables already work; after the first deploy Plantar starts keeping versions — restoring the previous version becomes available.",
  "deploy.externalNeedsFolder":
    "To deploy this app, choose the folder with its code on this computer.",
  "deploy.externalRepoBefore": "This app was deployed from the repository",
  "deploy.externalRepoAfter":
    ". Connect it — updates will be pulled from GitHub on every deploy.",
  "deploy.connectRepo": "Connect repository",
  "deploy.connectingRepo": "Connecting…",
  "deploy.pickFolder": "Choose code folder",
  "deploy.lastRunDeploy": "Deploy on {when}",
  "deploy.lastRunRollback": "Version restore on {when}",
  "deploy.lastRunSuccess": "Succeeded",
  "deploy.lastRunError": "Failed",
  "deploy.lastRunInterrupted": "Interrupted",

  "discover.title": "Found on the server",
  "discover.description":
    "Apps running on the server “{server}” that are not in Plantar yet.",
  "discover.hint":
    "The project is added as external: logs and variables work right away, and restoring the previous version appears after the first deploy via Plantar.",
  "discover.scanning": "Looking for running apps on the server…",
  "discover.empty":
    "No new apps found: everything running on the server is already in the list, or the server has no apps started via pm2.",
  "discover.retry": "Search again",
  "discover.statusOnline": "running",
  "discover.statusStopped": "stopped",
  "discover.serverFolder": "Folder on the server",
  "discover.envFiles": "Environment files",
  "discover.repo": "Repository",
  "discover.add": "Add",
  "discover.adding": "Adding…",
  "discover.added": "Added",

  "commits.loading": "Loading commits…",
  "commits.empty": "No commits yet.",
  "commits.branchHint": "Branch {branch}",
  "commits.refresh": "Refresh",
  "commits.badge.onServer": "On the server",
  "commits.badge.deployed": "Deployed",
  "commits.badge.failed": "Deploy failed",
  "commits.badge.notDeployed": "Not deployed",

  "ciSetup.button": "Set up deploy on commit",
  "ciSetup.title": "Deploy on commit",
  "ciSetup.description":
    "Every new commit on the {branch} branch will deploy to “{server}” automatically — even when Plantar is closed.",
  "ciSetup.will1":
    "A separate access key will be created for GitHub — your personal key stays on this computer only.",
  "ciSetup.will2":
    "The key and the server address will be stored in the repository's protected storage (GitHub Secrets).",
  "ciSetup.will3":
    "A commit with the auto-deploy file and the project settings (plantar.json) will be added to the {branch} branch.",
  "ciSetup.secretsNote":
    "The server access credentials will be stored not only on this computer but also on GitHub — without this, GitHub cannot deploy on its own.",
  "ciSetup.loginNeeded": "Sign in to GitHub to set up deploy on commit.",
  "ciSetup.reloginNeeded":
    "One more GitHub permission is required — to change automation files in the repository. Sign in again to grant it.",
  "ciSetup.login": "Sign in with GitHub",
  "ciSetup.relogin": "Sign in again",
  "ciSetup.submit": "Set up",
  "ciSetup.working": "Setting up…",
  "ciSetup.done":
    "Done. Every commit on the {branch} branch will now deploy to the server automatically.",
  "ciSetup.doneHistoryNote":
    "These deploys are run by GitHub, so for now they do not appear in the app's history or commit badges — you can follow them on the Actions page.",
  "ciSetup.openActions": "Open Actions on GitHub",

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

  "files.loading": "Loading the file list…",
  "files.load": "Show files",
  "files.passwordNeeded": "The server password will be needed.",
  "files.refresh": "Refresh",
  "files.refreshTitle": "Reload the files from the server",
  "files.emptyDir": "The folder is empty",
  "files.linkBadge": "link",
  "files.relatedTitle": "Related files",
  "files.relatedConf": "Web server settings",
  "files.relatedAccess": "Request log",
  "files.relatedError": "Error log",
  "files.relatedMissing": "no file yet",
  "files.viewerPlaceholder": "Select a file on the left to view its contents.",
  "files.viewerLoading": "Opening the file…",
  "files.emptyFile": "The file is empty.",
  "files.binaryNotice": "This is not a text file ({size}) — its contents cannot be shown.",
  "files.truncatedNotice": "The file is large ({size}) — showing its end.",
  "files.sizeB": "{value} B",
  "files.sizeKb": "{value} KB",
  "files.sizeMb": "{value} MB",
  "files.sizeGb": "{value} GB",

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
  "history.rollback": "Version restored",

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
  "projectSettings.branch": "Branch",
  "projectSettings.branchChange": "Change",
  "projectSettings.branchHint":
    "Deploys use the selected branch. If deploy on commit is set up, set it up again after changing the branch.",

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

  "appStatus.check": "Check",
  "appStatus.checking": "Checking…",
  "appStatus.processTitle": "App process",
  "appStatus.state.running": "Running",
  "appStatus.state.stopped": "Stopped",
  "appStatus.state.errored": "Error",
  "appStatus.noProcess":
    "The app was not found on the server. It will appear after the first deploy.",
  "appStatus.staticNote":
    "The site is served by the server as static files — it has no separate process or load.",
  "appStatus.since": "Running since",
  "appStatus.restarts": "Restarts",
  "appStatus.restartsHint":
    "Frequent restarts mean the app keeps crashing and starting again. Check the logs.",
  "appStatus.memory": "Memory",
  "appStatus.cpu": "CPU",
  "appStatus.mb": "{mb} MB",
  "appStatus.trafficTitle": "Visits",
  "appStatus.trafficHint": "From the server log — roughly the last two weeks",
  "appStatus.requests": "Requests",
  "appStatus.visitors": "Visitors",
  "appStatus.errors": "App errors",
  "appStatus.byDay": "By day",
  "appStatus.byHour": "By time of day",
  "appStatus.topPaths": "Popular pages",
  "appStatus.trafficEmpty":
    "No visits recorded yet. They will appear once people start opening the site.",
  "appStatus.trafficNoLog":
    "The app does not have its own visit log yet, so site visits are not shown here. The log will appear after the first deploy through Plantar.",
  "appStatus.needGoaccess":
    "To see visits, install the “Visit statistics” tool on the server screen.",
  "appStatus.openServer": "Open the server screen",
  "appStatus.loadTitle": "App load",
  "appStatus.loadNeedSetup":
    "Enable load collection to see the hourly and daily history here: how much CPU and memory the app uses and how actively it writes to the logs.",
  "appStatus.loadEnable": "Enable charts",
  "appStatus.loadCollecting":
    "Data is being collected. The first points will appear in a minute or two.",
  "appStatus.loadCpuHint": "100% is one CPU core",
  "appStatus.logsTitle": "Logs over the day",
  "appStatus.logsHint": "Each bar is one hour",
  "appStatus.logsEmpty": "No log entries in the last day.",

  "monitoring.title": "Monitoring",
  "monitoring.description":
    "Optional tools. They are installed on the server and use its resources, so they are enabled on demand.",
  "monitoring.check": "Check",
  "monitoring.goaccessName": "Visit statistics (GoAccess)",
  "monitoring.goaccessDescription":
    "Counts visits from the server logs — charts on the “Status” tab of each app. Runs only during a check and uses almost no resources.",
  "monitoring.netdataName": "Server load (Netdata)",
  "monitoring.netdataDescription":
    "Records CPU and memory load around the clock — a chart will appear on this page. Runs in the background all the time and takes roughly 30–100 MB of server memory.",
  "monitoring.install": "Install",
  "monitoring.installing": "Installing…",
  "monitoring.installed": "Installed",
  "monitoring.start": "Start",
  "monitoring.loadTitle": "Server load",
  "monitoring.hour": "Hour",
  "monitoring.day": "Day",
  "monitoring.cpuChart": "CPU, %",
  "monitoring.cpuSeries": "Load",
  "monitoring.ramChart": "Memory, MB",
  "monitoring.ramSeries": "Used",
  "monitoring.ramSummary": "{used} of {total} MB used",
  "monitoring.otherSeries": "Other",
  "monitoring.breakdownHint":
    "“Other” is everything else on the server: the system, services, and static sites.",
  "monitoring.diskChart": "Disk, GB",
  "monitoring.diskSeries": "Used",
  "monitoring.diskSummary": "{used} of {total} GB used",
  "monitoring.gb": "{gb} GB",
  "monitoring.appMetricsName": "App load",
  "monitoring.appMetricsDescription":
    "CPU and memory history for each app — charts on the “Status” tab. Uses Netdata; samples are taken once a minute.",

  "appMetrics.dialogTitle": "Enable load charts?",
  "appMetrics.dialogDescription":
    "Collecting the history uses server resources, so it is only enabled manually.",
  "appMetrics.dialogBody":
    "The free Netdata program will be installed on the server — it keeps the load history. Once a minute it will record how much CPU and memory each app uses and how many entries appear in its logs.",
  "appMetrics.dialogCost":
    "Netdata takes roughly 30–100 MB of server memory. If it is already installed, only the per-app data collection will be added.",
  "appMetrics.enable": "Enable",
  "appMetrics.enabling": "Enabling…",
  "appMetrics.enabled": "Enabled",

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
