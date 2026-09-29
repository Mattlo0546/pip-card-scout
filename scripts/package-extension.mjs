import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_ROOT = join(PROJECT_ROOT, "extension");
const DIST_ROOT = join(PROJECT_ROOT, "dist");
const PRODUCTION_ORIGIN = "https://pip-card-scout.vercel.app";
const REPRODUCIBLE_TIMESTAMP = new Date("2020-01-01T00:00:00.000Z");

// This is the complete release payload. Documentation, source artwork, and any
// future development-only files remain outside the archive unless reviewed and
// explicitly added here.
const RUNTIME_FILES = Object.freeze([
  "manifest.json",
  "config.js",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "content.js",
  "content.css",
  "assets/icon-16.png",
  "assets/icon-32.png",
  "assets/icon-48.png",
  "assets/icon-128.png",
]);

const JAVASCRIPT_FILES = RUNTIME_FILES.filter((file) => file.endsWith(".js"));
const TEXT_FILES = RUNTIME_FILES.filter((file) => /\.(?:css|html|js|json)$/.test(file));

function fail(message) {
  throw new Error(`Extension release validation failed: ${message}`);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
}

async function readJson(relativePath) {
  const source = await readFile(join(PROJECT_ROOT, relativePath), "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

async function validateRelease() {
  const [packageJson, manifest, configSource, popupHtml] = await Promise.all([
    readJson("package.json"),
    readJson("extension/manifest.json"),
    readFile(join(EXTENSION_ROOT, "config.js"), "utf8"),
    readFile(join(EXTENSION_ROOT, "popup.html"), "utf8"),
  ]);

  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(manifest.version || ""))) {
    fail("manifest.json must contain a Chrome-compatible numeric version");
  }
  if (manifest.version !== packageJson.version) {
    fail(`manifest version ${manifest.version} does not match package version ${packageJson.version}`);
  }
  if (manifest.manifest_version !== 3) fail("only Manifest V3 releases are supported");
  if (manifest.content_scripts !== undefined) fail("content scripts must be injected only after a user gesture");

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const expectedPermissions = ["storage", "activeTab", "scripting"];
  if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions)) {
    fail(`permissions must be exactly ${expectedPermissions.join(", ")}`);
  }
  if (permissions.includes("tabs")) fail("the broad tabs permission is not allowed");

  const expectedHosts = [`${PRODUCTION_ORIGIN}/*`];
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) {
    fail(`host_permissions must contain only ${expectedHosts[0]}`);
  }

  const expectedWebResources = [{ resources: ["content.css"], matches: ["https://*/*"] }];
  if (JSON.stringify(manifest.web_accessible_resources) !== JSON.stringify(expectedWebResources)) {
    fail("content.css must be the only web-accessible resource and must be limited to HTTPS pages");
  }

  const manifestFiles = new Set([
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
    ...expectedWebResources.flatMap((entry) => entry.resources),
  ].filter(Boolean));
  for (const relativePath of manifestFiles) {
    if (!RUNTIME_FILES.includes(relativePath)) {
      fail(`manifest.json references a file outside the release allow-list: ${relativePath}`);
    }
  }

  const extensionCsp = manifest.content_security_policy?.extension_pages;
  const connectDirectives = typeof extensionCsp === "string"
    ? extensionCsp.split(";").map((directive) => directive.trim()).filter((directive) => directive.startsWith("connect-src"))
    : [];
  if (JSON.stringify(connectDirectives) !== JSON.stringify([`connect-src ${PRODUCTION_ORIGIN}`])) {
    fail("the extension CSP must contain exactly one production API connection target");
  }

  if (!configSource.includes(`apiBaseUrl: "${PRODUCTION_ORIGIN}"`)) {
    fail("config.js must point at the production API");
  }
  const configuredUrls = [...configSource.matchAll(/apiBaseUrl\s*:\s*["']([^"']+)["']/g)].map((match) => match[1]);
  if (configuredUrls.length !== 1 || configuredUrls[0] !== PRODUCTION_ORIGIN) {
    fail("config.js must contain exactly one production API base URL");
  }

  const popupScripts = [...popupHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  if (
    popupScripts.length !== 1 ||
    !/^\s*src=["']popup\.js["']\s*$/.test(popupScripts[0][1]) ||
    popupScripts[0][2].trim() !== ""
  ) {
    fail("popup.html must load only the packaged popup.js file and contain no inline script");
  }

  const runtimeText = (await Promise.all(
    TEXT_FILES.map(async (relativePath) => `${relativePath}\n${await readFile(join(EXTENSION_ROOT, relativePath), "utf8")}`),
  )).join("\n");
  if (/\blocalhost\b|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(runtimeText)) {
    fail("the release payload contains a local-development host");
  }
  if (/\bdemo\b/i.test(runtimeText)) {
    fail("the release payload contains prototype-only copy or identifiers");
  }
  if (/SUPABASE_SERVICE_ROLE_KEY|VERCEL_TOKEN|BEGIN (?:RSA |EC )?PRIVATE KEY/i.test(runtimeText)) {
    fail("the release payload contains a server credential marker");
  }

  for (const relativePath of RUNTIME_FILES) {
    const details = await stat(join(EXTENSION_ROOT, relativePath)).catch(() => null);
    if (!details?.isFile()) fail(`missing allow-listed runtime file: ${relativePath}`);
  }

  for (const relativePath of JAVASCRIPT_FILES) {
    run(process.execPath, ["--check", join(EXTENSION_ROOT, relativePath)]);
  }

  return manifest.version;
}

async function copyDeterministicPayload(stagingRoot) {
  for (const relativePath of RUNTIME_FILES) {
    const source = join(EXTENSION_ROOT, relativePath);
    const destination = join(stagingRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, 0o644);
    await utimes(destination, REPRODUCIBLE_TIMESTAMP, REPRODUCIBLE_TIMESTAMP);
  }
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function main() {
  const version = await validateRelease();
  const archiveName = `pip-card-scout-${version}.zip`;
  const archivePath = join(DIST_ROOT, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const stagingRoot = await mkdtemp(join(tmpdir(), "pip-card-scout-extension-"));

  try {
    await copyDeterministicPayload(stagingRoot);
    await mkdir(DIST_ROOT, { recursive: true });
    await Promise.all([
      rm(archivePath, { force: true }),
      rm(checksumPath, { force: true }),
    ]);

    run("zip", ["-X", "-q", archivePath, ...RUNTIME_FILES], {
      cwd: stagingRoot,
      env: { ...process.env, TZ: "UTC" },
    });

    const archivedFiles = run("unzip", ["-Z1", archivePath])
      .split(/\r?\n/)
      .filter(Boolean);
    if (JSON.stringify(archivedFiles) !== JSON.stringify(RUNTIME_FILES)) {
      fail(`archive contents differ from the allow-list: ${archivedFiles.join(", ")}`);
    }
    if (archivedFiles[0] !== "manifest.json") fail("manifest.json must be at the archive root");

    const digest = await sha256(archivePath);
    await writeFile(checksumPath, `${digest}  ${archiveName}\n`, "utf8");
    const { size } = await stat(archivePath);

    process.stdout.write(`Created dist/${archiveName} (${size} bytes)\n`);
    process.stdout.write(`SHA-256 ${digest}\n`);
    process.stdout.write(`Checksum dist/${archiveName}.sha256\n`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

await main();
