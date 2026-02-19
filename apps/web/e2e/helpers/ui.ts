import { expect, type Page } from "@playwright/test";

export async function expectOnboardingPage(page: Page): Promise<void> {
  await expect
    .poll(() => page.url(), {
      timeout: 20_000,
      message: "Expected navigation to /workspace/onboarding",
    })
    .toContain("/workspace/onboarding");

  await expect(page.getByRole("heading", { name: /Bienvenue dans/i })).toBeVisible();
}

export async function expectViewerBlockedMessage(page: Page): Promise<void> {
  await expect(page.getByText("Demandez un rôle éditeur pour créer du contenu.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Créer la tâche" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Créer la note" })).toBeDisabled();
}

export async function createFirstTaskOnOnboarding(page: Page, title: string): Promise<void> {
  const input = page.getByPlaceholder("Ex: Préparer la réunion d’équipe");
  await input.fill(title);

  const activationResponse = page.waitForResponse((response) => {
    return response.url().includes("/api/workspace/activate") && response.request().method() === "POST";
  });

  await page.getByRole("button", { name: "Créer la tâche" }).click();

  const response = await activationResponse;
  expect(response.status()).toBe(200);

  await expect
    .poll(() => page.url(), { timeout: 20_000 })
    .toContain("/dashboard");
}

export async function openWeeklySummaryAndClose(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Résumé stratégique de la semaine" })).toBeVisible();
  await page.getByRole("button", { name: "Voir le résumé" }).click();
  await expect(page.getByRole("heading", { name: /Résumé stratégique —/ })).toBeVisible();
  await page.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("heading", { name: /Résumé stratégique —/ })).toBeHidden();
}
