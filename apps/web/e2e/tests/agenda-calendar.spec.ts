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

async function openTaskCreateDialogFromPicker(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("button", { name: "Créer" }).click();
  await page.getByRole("button", { name: "Nouvelle tâche" }).click();

  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();
  return dialog;
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

async function convertCalendarTaskToTimed(page: Page, title: string, startTime: string, endTime: string) {
  await page.getByText(title).first().click();
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Toute la journée")).toBeChecked();

  await editDialog.getByLabel("Toute la journée").uncheck();
  const startInput = editDialog.getByLabel("Date de début");
  const endInput = editDialog.getByLabel("Date de fin / échéance");

  const startValue = await startInput.inputValue();
  const [startDate] = startValue.split("T");
  await startInput.fill(`${startDate}T${startTime}`);
  await endInput.fill(`${startDate}T${endTime}`);

  await editDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editDialog).toBeHidden();
}

async function openTaskDetailFromList(page: Page, title: string) {
  await page.goto("/tasks?view=list");
  await page.locator("li", { hasText: title }).first().click();
  const dialog = page.getByRole("dialog", { name: "Détail de l’élément d’agenda" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function enterTaskDetailEditMode(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("button", { name: "Actions" }).click();
  await dialog.getByRole("menuitem", { name: "Modifier" }).click();
}

test("agenda_create_via_plus_uses_modal_start_date_and_creates_task", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("plus");
  await createTaskViaPlus(page, title);

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_create_via_plus_outside_tasks_redirects_to_tasks_modal", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/dashboard");

  const dialog = await openTaskCreateDialogFromPicker(page, "/dashboard");
  await expect(page).toHaveURL(/\/tasks\?/);
  await expect(dialog.locator("#task-new-start")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
});

test("agenda_shortcut_t_opens_unified_task_creation_flow", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/dashboard");

  await page.goto("/dashboard");
  await page.keyboard.press("t");

  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\?/);
  await expect(dialog.locator("#task-new-start")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
});

test("agenda_query_create_opens_unified_modal_with_start_date_prefill", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=list");

  await page.goto("/tasks?view=list&create=1&startDate=2026-03-24");

  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#task-new-start")).toHaveValue("2026-03-24");
});

test("agenda_list_empty_state_opens_unified_task_creation_flow", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=list&workspaceId=__e2e_missing_workspace__");

  await page.goto("/tasks?view=list&workspaceId=__e2e_missing_workspace__");
  await page.getByRole("button", { name: "Créer une tâche" }).click();

  const dialog = page.getByRole("dialog", { name: "Nouvel élément d’agenda" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#task-new-start")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
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

test("agenda_detail_timed_task_preserves_start_time_after_save", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("detailTimed");
  await createTaskFromCalendar(page, title);
  await convertCalendarTaskToTimed(page, title, "08:00", "09:00");

  const detailDialog = await openTaskDetailFromList(page, title);
  await expect(detailDialog.getByText("Date de début:").first()).toContainText("08:00");
  await expect(detailDialog.getByText("Date de fin / échéance:").first()).toContainText("09:00");

  await enterTaskDetailEditMode(detailDialog);
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  const startInput = editDialog.getByLabel("Date de début");
  const endInput = editDialog.getByLabel("Date de fin / échéance");
  await expect(startInput).toHaveAttribute("type", "datetime-local");
  await expect(startInput).toHaveValue(/T08:00$/);
  await expect(endInput).toHaveValue(/T09:00$/);

  await editDialog.locator("#task-modal-title").fill(`${title} edited`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("dialog", { name: "Détail de l’élément d’agenda" })).toBeVisible();

  await page.getByRole("button", { name: "Fermer" }).click();

  const reopenedDetailDialog = await openTaskDetailFromList(page, `${title} edited`);
  await enterTaskDetailEditMode(reopenedDetailDialog);
  const reopenedEditDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(reopenedEditDialog.getByLabel("Date de début")).toHaveValue(/T08:00$/);
});

test("agenda_detail_timed_task_blocks_when_end_is_not_after_start", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("detailBlock");
  await createTaskFromCalendar(page, title);
  await convertCalendarTaskToTimed(page, title, "10:00", "11:00");

  const detailDialog = await openTaskDetailFromList(page, title);
  await enterTaskDetailEditMode(detailDialog);

  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  const startInput = editDialog.getByLabel("Date de début");
  const endInput = editDialog.getByLabel("Date de fin / échéance");
  const startValue = await startInput.inputValue();
  await endInput.fill(startValue);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();

  await expect(editDialog.getByText("La fin doit être après le début.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Modifier l’élément d’agenda" })).toBeVisible();
});

test("agenda_detail_all_day_task_keeps_date_only_start_field", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("detailAllDay");
  await createTaskFromCalendar(page, title);

  const detailDialog = await openTaskDetailFromList(page, title);
  await expect(detailDialog.getByText("Date de début:").first()).not.toContainText(":");
  await expect(detailDialog.getByText("Date de fin / échéance:").first()).not.toContainText(":");

  await enterTaskDetailEditMode(detailDialog);
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog.getByLabel("Date de début")).toHaveAttribute("type", "date");
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
