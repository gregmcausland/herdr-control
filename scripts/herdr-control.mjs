#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const unitDirectory = join(homedir(), ".config/systemd/user");
const unitPath = join(unitDirectory, "herdr-control.service");
const configDirectory = join(homedir(), ".config/herdr-control");
const environmentPath = join(configDirectory, "environment");
const statePath = process.env.HERDR_CONTROL_STATE
  ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "herdr-control/control.db");
const legacyHostsPath = join(projectRoot, "src/client/hosts.json");

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}

async function main(command) {
  switch (command) {
    case "install":
      await install();
      break;
    case "status":
      systemctl(["status", "herdr-control.service", "--no-pager"], false);
      break;
    case "logs":
      run("journalctl", ["--user", "-u", "herdr-control.service", "-f"], { inherit: true });
      break;
    case "start":
    case "stop":
    case "restart":
      systemctl([command, "herdr-control.service"]);
      break;
    case "update":
      await update();
      break;
    case "remove":
      remove();
      break;
    default:
      usage();
      process.exitCode = command ? 1 : 0;
  }
}

async function install() {
  verifyLinuxUserService();
  run("npm", ["ci"], { cwd: projectRoot, inherit: true });
  validateMigrationWhenPresent();
  run("npm", ["run", "build"], { cwd: projectRoot, inherit: true });
  await backupStateWhenPresent();

  mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  if (!existsSync(environmentPath)) {
    const inherited = existsSync(unitPath) ? environmentFromUnit(readFileSync(unitPath, "utf8")) : {};
    const herdrBinary = process.env.HERDR_CONTROL_BIN ?? inherited.HERDR_CONTROL_BIN ?? findExecutable("herdr");
    const values = {
      ...inherited,
      HERDR_CONTROL_BIN: herdrBinary,
      HERDR_CONTROL_LEGACY_HOSTS: existsSync(legacyHostsPath) ? legacyHostsPath : undefined,
    };
    writeFileSync(environmentPath, environmentFile(values), { mode: 0o600 });
  }
  chmodSync(environmentPath, 0o600);

  installSystemdUnit();
  systemctl(["enable", "herdr-control.service"]);
  systemctl(["restart", "herdr-control.service"]);
  console.log(`Installed Herdr Control from ${projectRoot}`);
  console.log(`Configuration: ${environmentPath}`);
  console.log(`State retained at: ${statePath}`);
}

async function update() {
  verifyLinuxUserService();
  if (!existsSync(join(projectRoot, ".git"))) {
    throw new Error("This installation is not a Git checkout and cannot update itself");
  }
  const dirty = run("git", ["status", "--porcelain"], { cwd: projectRoot }).stdout.trim();
  if (dirty) throw new Error("Refusing to update a checkout with uncommitted changes");

  await backupStateWhenPresent();
  run("git", ["pull", "--ff-only"], { cwd: projectRoot, inherit: true });
  run("npm", ["ci"], { cwd: projectRoot, inherit: true });
  validateMigrationWhenPresent();
  run("npm", ["run", "build"], { cwd: projectRoot, inherit: true });
  installSystemdUnit();
  systemctl(["restart", "herdr-control.service"]);
  systemctl(["status", "herdr-control.service", "--no-pager"], false);
}

function remove() {
  verifyLinuxUserService();
  systemctl(["disable", "--now", "herdr-control.service"], false);
  if (existsSync(unitPath)) {
    copyFileSync(unitPath, `${unitPath}.removed-${timestamp()}`);
    unlinkSync(unitPath);
  }
  systemctl(["daemon-reload"]);
  console.log("Removed the Herdr Control user service.");
  console.log(`Configuration remains at: ${environmentPath}`);
  console.log(`State remains at: ${statePath}`);
}

function validateMigrationWhenPresent() {
  if (!existsSync(statePath) || !existsSync(legacyHostsPath)) return;
  run("npm", ["run", "validate:host-migration", "--", statePath, legacyHostsPath], {
    cwd: projectRoot,
    inherit: true,
  });
}

async function backupStateWhenPresent() {
  if (!existsSync(statePath)) return;
  const database = new DatabaseSync(statePath, { readOnly: true });
  const destination = `${statePath}.backup-${timestamp()}`;
  await backup(database, destination).finally(() => {
    database.close();
  });
  console.log(`Backed up Control state to ${destination}`);
}

/** Reconciles the installed unit on both fresh installs and updates. */
function installSystemdUnit() {
  mkdirSync(unitDirectory, { recursive: true });
  const previousUnit = existsSync(unitPath) ? readFileSync(unitPath) : undefined;
  if (previousUnit) copyFileSync(unitPath, `${unitPath}.backup-${timestamp()}`);
  try {
    writeFileSync(unitPath, systemdUnit({
      projectRoot,
      nodePath: process.execPath,
      environmentPath,
    }));
    run("systemd-analyze", ["--user", "verify", unitPath]);
    systemctl(["daemon-reload"]);
  } catch (error) {
    if (previousUnit) writeFileSync(unitPath, previousUnit);
    else if (existsSync(unitPath)) unlinkSync(unitPath);
    systemctl(["daemon-reload"], false);
    systemctl(["restart", "herdr-control.service"], false);
    throw error;
  }
}

export function systemdUnit({ projectRoot, nodePath, environmentPath }) {
  return `[Unit]
Description=Herdr Control browser bridge
# Control reconnects when Herdr becomes available. Ordering this unit after an
# externally managed Herdr service can create a default.target startup cycle.

[Service]
Type=simple
WorkingDirectory=${escapeSystemdPath(projectRoot)}
Environment=NODE_ENV=production
EnvironmentFile=-${escapeSystemdPath(environmentPath)}
ExecStart=${quoteSystemd(nodePath)} ${quoteSystemd(join(projectRoot, "dist/server/server/index.js"))}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

export function environmentFromUnit(unit) {
  const values = {};
  for (const line of unit.split(/\r?\n/)) {
    const match = /^Environment=(?:"([^"]*)"|(.*))$/.exec(line.trim());
    const assignment = match?.[1] ?? match?.[2];
    if (!assignment?.startsWith("HERDR_CONTROL_")) continue;
    const separator = assignment.indexOf("=");
    if (separator < 1) continue;
    values[assignment.slice(0, separator)] = assignment.slice(separator + 1);
  }
  return values;
}

export function environmentFile(values) {
  return Object.entries(values)
    .filter(([, value]) => value)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, value]) => `${key}=${quoteEnvironment(value)}`)
    .join("\n") + "\n";
}

function quoteSystemd(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function escapeSystemdPath(value) {
  return value.replaceAll("%", "%%").replace(/[\\\s]/g, (character) => (
    `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`
  ));
}

function quoteEnvironment(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function findExecutable(name) {
  const result = run("sh", ["-lc", `command -v ${name}`]);
  const path = result.stdout.trim();
  if (!path) throw new Error(`${name} was not found in PATH`);
  return path;
}

function verifyLinuxUserService() {
  if (process.platform !== "linux") throw new Error("Managed installation currently supports Linux user services");
  run("systemctl", ["--user", "show-environment"]);
}

function systemctl(args, required = true) {
  return run("systemctl", ["--user", ...args], { inherit: true, required });
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if ((options.required ?? true) && result.status !== 0) {
    throw new Error(`${program} ${args.join(" ")} failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function usage() {
  console.log(`Usage: npm run control -- <command>

Commands:
  install   Build and install the user service
  status    Show service status
  logs      Follow service logs
  start     Start the service
  stop      Stop the service
  restart   Restart the service
  update    Back up state, update the checkout, build, and restart
  remove    Remove the user service but preserve configuration and state`);
}
