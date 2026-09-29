import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const productionOrigin = "https://pip-card-scout.vercel.app";
const runtimeFiles = [
  "manifest.json",
  "config.js",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "content.js",
  "content.css",
];
const runtimeSources = Object.fromEntries(await Promise.all(runtimeFiles.map(async (file) => [
  file,
  await readFile(new URL(`../extension/${file}`, import.meta.url), "utf8"),
])));
const manifest = JSON.parse(runtimeSources["manifest.json"]);
const content = runtimeSources["content.js"];
const background = runtimeSources["background.js"];
const popup = runtimeSources["popup.js"];

test("the production manifest injects only after an explicit user gesture", () => {
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions, ["storage", "activeTab", "scripting"]);
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.deepEqual(manifest.host_permissions, [`${productionOrigin}/*`]);
  assert.match(manifest.content_security_policy.extension_pages, new RegExp(`connect-src ${productionOrigin.replaceAll(".", "\\.")}(?:;|$)`));
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ["content.css"],
    matches: ["https://*/*"],
  }]);
});

test("the shipped runtime is production-only", () => {
  const shippedText = Object.entries(runtimeSources).map(([file, source]) => `${file}\n${source}`).join("\n");
  assert.match(runtimeSources["config.js"], /apiBaseUrl:\s*"https:\/\/pip-card-scout\.vercel\.app"/);
  assert.doesNotMatch(shippedText, /\blocalhost\b|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i);
  assert.doesNotMatch(shippedText, /\bdemo\b/i);
});

test("the content script does not leak decisions into the merchant page", () => {
  assert.doesNotMatch(content, /localStorage/);
  assert.doesNotMatch(content, /CustomEvent/);
  assert.doesNotMatch(content, /data-pip-card-number/);
  assert.doesNotMatch(content, /pip:activate/);
  assert.doesNotMatch(content, /lastFour|accessToken|refreshToken/);
});

test("the shipped extension contains no card credential fields or synthetic PANs", () => {
  const shippedCode = `${content}\n${background}\n${popup}`;
  assert.doesNotMatch(shippedCode, /["'](?:cvc|cvv|pan|expiry|cardNumber)["']\s*:/i);
  assert.doesNotMatch(shippedCode, /9900\s+\d{4}/);
});
