import { spawn } from "node:child_process";

const REQUIRED_E2E_ENV = [
  "E2E_BASE_URL",
  "E2E_OWNER_EMAIL",
  "E2E_OWNER_PASSWORD",
  "E2E_EDITOR_EMAIL",
  "E2E_EDITOR_PASSWORD",
  "E2E_VIEWER_EMAIL",
  "E2E_VIEWER_PASSWORD",
];

function findMissingVars() {
  return REQUIRED_E2E_ENV.filter((key) => !process.env[key]?.trim());
}

function findInvalidVars() {
  const invalid = [];

  const emailVars = ["E2E_OWNER_EMAIL", "E2E_EDITOR_EMAIL", "E2E_VIEWER_EMAIL"];
  for (const key of emailVars) {
    const value = process.env[key]?.trim();
    if (!value) continue;

    const lower = value.toLowerCase();
    if (!value.includes("@") || lower.includes("example.com")) {
      invalid.push(`${key} (invalid or placeholder email)`);
    }
  }

  const passwordVars = ["E2E_OWNER_PASSWORD", "E2E_EDITOR_PASSWORD", "E2E_VIEWER_PASSWORD"];
  for (const key of passwordVars) {
    const value = process.env[key]?.trim();
    if (!value) continue;

    const lower = value.toLowerCase();
    if (value.length < 6 || value === "***" || lower === "password") {
      invalid.push(`${key} (too short or placeholder password)`);
    }
  }

  return invalid;
}

function printSkip(reasonLines) {
  console.log("[e2e:skip] Local E2E run skipped. Configure E2E env vars to run Playwright.");
  for (const line of reasonLines) {
    console.log(`[e2e:skip] - ${line}`);
  }
  console.log("[e2e:skip] Required vars:", REQUIRED_E2E_ENV.join(", "));
  console.log("[e2e:skip] See README.md and .env.e2e.example.");
}

function runPlaywright() {
  const playwrightArgs = ["playwright", "test", "-c", "apps/web/e2e/playwright.config.ts", ...process.argv.slice(2)];
  const child = spawn("pnpm", playwrightArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error("[e2e:precheck] Failed to start Playwright:", error);
    process.exit(1);
  });
}

function main() {
  const missing = findMissingVars();
  const invalid = findInvalidVars();

  if (missing.length > 0 || invalid.length > 0) {
    const reasons = [
      ...missing.map((key) => `${key} is missing`),
      ...invalid,
    ];

    printSkip(reasons);
    process.exit(0);
    return;
  }

  runPlaywright();
}

main();
