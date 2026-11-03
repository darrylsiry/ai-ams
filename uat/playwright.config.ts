import { defineConfig } from "@playwright/test";

// Driven by scripts/uat.sh, which sets these. Never point UAT_MODE=sandbox at production: the sandbox
// suite writes (clients, policies, receipts, statements, settings).
//   UAT_MODE      sandbox | readonly
//   UAT_BASE_URL  e.g. http://127.0.0.1:3950 or https://siryous-ams.fly.dev
//   UAT_USER / UAT_PASS   the login a read-only pass uses (HTTP Basic, never the sign-in form)
//   UAT_PASS_NAME a label for the result files (sandbox, canary, prod)
const mode = process.env.UAT_MODE ?? "readonly";
const baseURL = process.env.UAT_BASE_URL ?? "http://127.0.0.1:3950";
const name = process.env.UAT_PASS_NAME ?? mode;
// One tag per run, so record names are unique; workers inherit it, including after a failure restarts one.
process.env.UAT_TAG ??= Date.now().toString(36).slice(-6);
const isProd = !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseURL);

if (mode === "sandbox" && isProd) {
  throw new Error(`Refusing to run the sandbox (writing) suite against ${baseURL}: it only runs against a local sandbox.`);
}

export default defineConfig({
  testDir: mode === "sandbox" ? "tests/sandbox" : "tests/readonly",
  outputDir: `.work/artifacts-${name}`,
  fullyParallel: false,
  workers: 1,                       // flows build on each other's records, in file order
  retries: isProd ? 1 : 0,          // the live site may be waking a stopped Fly machine
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: `.work/results-${name}.json` }],
  ],
  use: {
    baseURL,
    headless: true,
    serviceWorkers: "block",        // nothing may bypass the write guard's network interception
    screenshot: "only-on-failure",
    trace: isProd ? "off" : "retain-on-failure",   // a trace records request headers, so never one with the live login
    acceptDownloads: true,
    timezoneId: "America/New_York",
    actionTimeout: 30_000,
  },
});
