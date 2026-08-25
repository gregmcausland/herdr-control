#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const requestedVersion = argument("--version") ?? packageJson.version;
const outputDirectory = resolve(projectRoot, argument("--output") ?? "artifacts");

if (requestedVersion !== packageJson.version) {
  throw new Error(`Release version ${requestedVersion} does not match package version ${packageJson.version}`);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
  throw new Error(`Invalid release version: ${requestedVersion}`);
}

const baseName = `herdr-control-${requestedVersion}`;
const temporaryDirectory = mkdtempSync(join(tmpdir(), "herdr-control-release-"));
const stagedProject = join(temporaryDirectory, baseName);
const sourceArchive = join(temporaryDirectory, "source.tar");
const archivePath = join(outputDirectory, `${baseName}.tar.gz`);

try {
  mkdirSync(stagedProject, { recursive: true });
  run("git", ["archive", "--format=tar", "--output", sourceArchive, "HEAD"]);
  run("tar", ["-xf", sourceArchive, "-C", stagedProject]);
  cpSync(join(projectRoot, "dist"), join(stagedProject, "dist"), { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  run("tar", ["-czf", archivePath, "-C", temporaryDirectory, baseName]);

  const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  const checksumPath = `${archivePath}.sha256`;
  writeFileSync(checksumPath, `${digest}  ${basename(archivePath)}\n`);
  console.log(archivePath);
  console.log(checksumPath);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(program, args) {
  const result = spawnSync(program, args, { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} failed`);
}
