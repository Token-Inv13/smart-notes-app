import { expect, test, type Page } from "@playwright/test";
import { getE2EUsers, loginViaUi } from "../helpers/auth";

function uniqueAgendaTitle(suffix: string) {
  return `E2E Agenda ${suffix} ${Date.now()}`;
}

async function createTaskViaPlus(page: Page, title: string) {
  await page.goto("/tasks?view=calendar");
  await page.getByRole("button", { name: "Créer" }).click();
  await page.getByRole("button", { name: "Nouvelle tâche" }).click();

  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();

  const startInput = dialog.locator("#task-new-start");
  await expect(startInput).toHaveValue(/\d{4}-\d{2}-\d{2}/);

  await dialog.locator("#task-new-title").fill(title);
  await dialog.getByRole("button", { name: "Créer dans l’agenda" }).click();
  await expect(dialog).toBeHidden();
}

async function createTaskFromCalendar(page: Page, title: string) {
  await page.goto("/tasks?view=calendar");
  await expect(page.getByText("Raccourcis: N (nouvel élément)")).toBeVisible();
  await page.getByRole("button", { name: "Mois" }).click();
  await page.locator(".fc-daygrid-day").nth(8).click();
  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Titre").fill(title);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();
}

test("agenda_create_via_plus_uses_modal_start_date_and_creates_task", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("plus");
  await createTaskViaPlus(page, title);

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

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

  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();
  const title = uniqueAgendaTitle("allday");
  await dialog.getByLabel("Titre").fill(title);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();

  await page.getByText(title).first().click();
  await expect(page.getByRole("dialog", { name: "Modifier l’élément d’agenda" })).toBeVisible();
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog.getByLabel("Toute la journée")).toBeChecked();
});

test("agenda_can_convert_all_day_to_timed", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await page.goto("/tasks?view=calendar");
  await page.getByRole("button", { name: "Mois" }).click();
  await page.locator(".fc-daygrid-day").nth(12).click();

  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();
  const title = uniqueAgendaTitle("allDayToTimed");
  await dialog.getByLabel("Titre").fill(title);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toBeHidden();

  await page.getByText(title).first().click();
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Toute la journée")).toBeChecked();

  await editDialog.getByLabel("Toute la journée").uncheck();
  const startInput = editDialog.getByLabel("Date de début");
  const endInput = editDialog.getByLabel("Date de fin / échéance");
  await expect(startInput).toHaveAttribute("type", "datetime-local");
  await endInput.fill((await startInput.inputValue()).replace("T00:00", "T09:00"));
  await startInput.fill((await startInput.inputValue()).replace("T00:00", "T08:00"));

  await editDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editDialog).toBeHidden();

  await page.getByText(title).first().click();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Toute la journée")).not.toBeChecked();
});

test("agenda_detail_modal_has_consistent_accessible_name", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("detail");
  await createTaskViaPlus(page, title);

  await page.goto("/tasks?view=list");
  await page.locator("li", { hasText: title }).first().click();

  const dialog = page.getByRole("dialog", { name: "Détail de l’élément d’agenda" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(title).first()).toBeVisible();
});
