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
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);

  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Mot de passe").fill(user.password);

  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByRole("button", { name: "Se connecter", exact: true }).click(),
  ]);

  await expect
    .poll(
      () => page.url(),
      {
        timeout: 20_000,
        message: "Login did not navigate away from /login",
      },
    )
    .not.toContain("/login");
}
