import { expect, test, type Page } from "@playwright/test";
import { getE2EUsers, loginViaUi } from "../helpers/auth";

function uniqueAgendaTitle(suffix: string) {
  return `E2E Agenda ${suffix} ${Date.now()}`;
}

async function createTaskFromCalendar(page: Page, title: string) {
  await page.goto("/tasks?view=calendar");
  await expect(page.getByText("Raccourcis: N (nouvel élément)")).toBeVisible();

  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Éditeur agenda" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Titre").fill(title);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();
}

test("agenda_create_from_calendar_renders_event", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("calendar");
  await createTaskFromCalendar(page, title);

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_favorite_shows_in_dashboard_favoris", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("fav");
  await createTaskFromCalendar(page, title);

  await page.goto("/tasks?view=list");
  const card = page.locator("li", { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 15000 });

  const favButton = card.getByRole("button", { name: /Ajouter aux favoris|Retirer des favoris/ }).first();
  await favButton.click();

  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Favoris agenda/ }).click();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_uses_overridden_user_timezone", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __SMARTNOTES_TEST_TIMEZONE__?: string }).__SMARTNOTES_TEST_TIMEZONE__ = "America/New_York";
  });

  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await expect(page.locator(".agenda-premium-calendar")).toHaveAttribute("data-user-timezone", "America/New_York");
});

test("agenda_all_day_event_stays_all_day_after_save", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await page.goto("/tasks?view=calendar");
  await page.getByRole("button", { name: "Mois" }).click();
  await page.locator(".fc-daygrid-day").nth(10).click();

  const dialog = page.getByRole("dialog", { name: "Éditeur agenda" });
  await expect(dialog).toBeVisible();
  const title = uniqueAgendaTitle("allday");
  await dialog.getByLabel("Titre").fill(title);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();

  await page.getByText(title).first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Toute la journée")).toBeChecked();
});

test("agenda_can_convert_all_day_to_timed", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await page.goto("/tasks?view=calendar");
  await page.getByRole("button", { name: "Mois" }).click();
  await page.locator(".fc-daygrid-day").nth(12).click();

  const dialog = page.getByRole("dialog", { name: "Éditeur agenda" });
  await expect(dialog).toBeVisible();
  const title = uniqueAgendaTitle("allDayToTimed");
  await dialog.getByLabel("Titre").fill(title);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();

  await page.getByText(title).first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Toute la journée")).toBeChecked();

  await dialog.getByLabel("Toute la journée").uncheck();
  const startInput = dialog.getByLabel("Début");
  const endInput = dialog.getByLabel("Fin");
  await expect(startInput).toHaveAttribute("type", "datetime-local");
  await endInput.fill((await startInput.inputValue()).replace("T00:00", "T09:00"));
  await startInput.fill((await startInput.inputValue()).replace("T00:00", "T08:00"));

  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();

  await page.getByText(title).first().click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Toute la journée")).not.toBeChecked();
});
