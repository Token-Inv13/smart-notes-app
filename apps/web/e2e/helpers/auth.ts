import { expect, type Page } from "@playwright/test";

export type E2EUser = {
  email: string;
  password: string;
};

export type E2EUsers = {
  owner: E2EUser;
  editor: E2EUser;
  viewer: E2EUser;
};

const LOGIN_TIMEOUT_MS =
  process.env.E2E_LOGIN_TIMEOUT_MS && Number.isFinite(Number(process.env.E2E_LOGIN_TIMEOUT_MS))
    ? Math.max(5_000, Math.trunc(Number(process.env.E2E_LOGIN_TIMEOUT_MS)))
    : process.env.CI === "true"
      ? 45_000
      : 20_000;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getE2EUsers(): E2EUsers {
  return {
    owner: {
      email: requiredEnv("E2E_OWNER_EMAIL"),
      password: requiredEnv("E2E_OWNER_PASSWORD"),
    },
    editor: {
      email: requiredEnv("E2E_EDITOR_EMAIL"),
      password: requiredEnv("E2E_EDITOR_PASSWORD"),
    },
    viewer: {
      email: requiredEnv("E2E_VIEWER_EMAIL"),
      password: requiredEnv("E2E_VIEWER_PASSWORD"),
    },
  };
}

export async function loginViaUi(page: Page, user: E2EUser, nextPath = "/dashboard"): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`, { waitUntil: "domcontentloaded" });

  if (!page.url().includes("/login")) {
    return;
  }

  const emailInput = page.locator("#email");
  const passwordInput = page.locator("#password");
  const feedbackMessage = page.locator("p[aria-live='polite']").first();

  await expect(emailInput).toBeVisible({ timeout: LOGIN_TIMEOUT_MS });
  await expect(passwordInput).toBeVisible({ timeout: LOGIN_TIMEOUT_MS });

  await emailInput.fill(user.email);
  await passwordInput.fill(user.password);

  await page.getByRole("button", { name: "Se connecter", exact: true }).click();

  await Promise.race([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: LOGIN_TIMEOUT_MS }),
    feedbackMessage.waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS }),
  ]).catch(() => undefined);

  if (page.url().includes("/login")) {
    const uiError = (await feedbackMessage.textContent().catch(() => ""))?.trim() || null;
    throw new Error(
      uiError
        ? `Login did not navigate away from /login. UI message: ${uiError}`
        : "Login did not navigate away from /login.",
    );
  }

  await expect
    .poll(
      () => page.url(),
      {
        timeout: LOGIN_TIMEOUT_MS,
        message: "Login did not navigate away from /login",
      },
    )
    .not.toContain("/login");
}
