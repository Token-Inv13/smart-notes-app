import { expect, test, type Page } from "@playwright/test";
import { getE2EUsers, loginViaUi } from "../helpers/auth";

function uniqueAgendaTitle(suffix: string) {
  return `E2E Agenda ${suffix} ${Date.now()}`;
}

async function mockGoogleCalendar(page: Page, options?: {
  connected?: boolean;
  events?: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
  }>;
}) {
  const connected = options?.connected ?? true;
  const events = options?.events ?? [];

  await page.route("**/api/google/calendar/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connected,
        primaryCalendarId: connected ? "primary" : null,
      }),
    });
  });

  await page.route("**/api/google/calendar/events?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events }),
    });
  });
}

async function mockGoogleCalendarCreate(page: Page, options?: { status?: number; body?: Record<string, unknown>; onRequest?: (body: unknown) => void | Promise<void> }) {
  await page.route("**/api/google/calendar/events", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }

    const rawBody = request.postData() ?? "{}";
    const parsedBody = JSON.parse(rawBody) as unknown;
    await options?.onRequest?.(parsedBody);

    await route.fulfill({
      status: options?.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(options?.body ?? { created: true, eventId: "gcal_test_id" }),
    });
  });
}

async function mockGoogleCalendarUpdate(page: Page, options?: { status?: number; body?: Record<string, unknown>; onRequest?: (body: unknown) => void | Promise<void> }) {
  await page.route("**/api/google/calendar/events", async (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") {
      await route.fallback();
      return;
    }

    const rawBody = request.postData() ?? "{}";
    const parsedBody = JSON.parse(rawBody) as unknown;
    await options?.onRequest?.(parsedBody);

    await route.fulfill({
      status: options?.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(options?.body ?? { updated: true, eventId: "gcal_test_id" }),
    });
  });
}

async function mockGoogleCalendarDelete(page: Page, options?: { status?: number; body?: Record<string, unknown>; onRequest?: (body: unknown) => void | Promise<void> }) {
  await page.route("**/api/google/calendar/events", async (route) => {
    const request = route.request();
    if (request.method() !== "DELETE") {
      await route.fallback();
      return;
    }

    const rawBody = request.postData() ?? "{}";
    const parsedBody = JSON.parse(rawBody) as unknown;
    await options?.onRequest?.(parsedBody);

    await route.fulfill({
      status: options?.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(options?.body ?? { deleted: true }),
    });
  });
}

async function delayCallable(page: Page, callableName: string, delayMs = 1200) {
  await page.route(`**/${callableName}`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
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

async function createTaskViaStandaloneForm(page: Page, options: {
  title: string;
  startDate: string;
  dueDate: string;
}) {
  await page.goto("/tasks/new");
  await page.locator("#task-new-title").fill(options.title);
  await page.locator("#task-new-start").fill(options.startDate);
  await page.locator("#task-new-due").fill(options.dueDate);
  await page.getByRole("button", { name: "Créer dans l’agenda" }).click();
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

async function addTaskReminderFromDetail(dialog: ReturnType<Page["getByRole"]>, reminderAt: string) {
  await dialog.getByLabel("Date et heure du rappel").fill(reminderAt);
  await dialog.getByRole("button", { name: "Ajouter" }).click();
  await expect(dialog.getByText("Statut: en attente").first()).toBeVisible({ timeout: 15000 });
}

async function clearAgendaMicroGuideFlag(page: Page) {
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sn:onboarding:") && key.endsWith(":tasks_microguide_v1")) {
        window.localStorage.removeItem(key);
      }
    }
  });
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

test("agenda_calendar_hides_planning_mode_label", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await page.goto("/tasks?view=calendar");
  await expect(page.getByText("Liste du jour")).toHaveCount(0);
});

test("agenda_calendar_hides_header_filter_but_keeps_search", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await page.goto("/tasks?view=calendar");
  await expect(page.getByRole("button", { name: "Ouvrir la recherche" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvrir les filtres" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Filtres(?: \(\d+\))?$/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Créer" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Aujourd’hui" })).toBeVisible();
});

test("agenda_calendar_keeps_create_button_visible_on_mobile", async ({ page }) => {
  const users = getE2EUsers();
  await page.setViewportSize({ width: 390, height: 844 });
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await page.goto("/tasks?view=calendar");
  await expect(page.getByRole("button", { name: "Créer" })).toBeVisible();
});

test("agenda_microguide_hides_immediately_and_stays_hidden_after_revisit", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=list");

  await clearAgendaMicroGuideFlag(page);
  await page.goto("/tasks?view=list");

  const guide = page.getByText("Ajoute un titre simple, puis un rappel si besoin. Tu peux épingler l’essentiel en favori ⭐.");
  await expect(guide).toBeVisible();

  await page.getByRole("button", { name: "Compris" }).click();
  await expect(guide).toBeHidden();

  await page.goto("/tasks?view=list");
  await expect(guide).toBeHidden();
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

test("agenda_google_calendar_toggle_hides_and_shows_google_events", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/dashboard");

  const googleTitle = uniqueAgendaTitle("googleOnly");
  await mockGoogleCalendar(page, {
    connected: true,
    events: [
      {
        id: "google-e2e-1",
        title: googleTitle,
        start: "2026-03-24T09:00:00.000Z",
        end: "2026-03-24T10:00:00.000Z",
        allDay: false,
      },
    ],
  });

  await page.goto("/tasks?view=calendar");
  await expect(page.getByRole("button", { name: "Google Calendar" })).toBeVisible();
  await expect(page.getByText(googleTitle).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Google Calendar" }).click();
  await expect(page.getByText(googleTitle).first()).toBeHidden();

  await page.getByRole("button", { name: "Google Calendar" }).click();
  await expect(page.getByText(googleTitle).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_google_calendar_empty_message_only_shows_after_successful_empty_fetch", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/dashboard");

  await mockGoogleCalendar(page, {
    connected: true,
    events: [],
  });

  await page.goto("/tasks?view=calendar");
  const emptyGoogleMessage = page.getByText("Google Calendar est connecté, mais aucun événement n’existe sur la plage affichée.");
  await expect(emptyGoogleMessage).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Google Calendar" }).click();
  await expect(emptyGoogleMessage).toBeHidden();
});

test("agenda_existing_task_filter_still_hides_local_tasks_with_google_toggle_present", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const localTitle = uniqueAgendaTitle("filterLocal");
  await createTaskFromCalendar(page, localTitle);

  await mockGoogleCalendar(page, {
    connected: true,
    events: [
      {
        id: "google-e2e-2",
        title: uniqueAgendaTitle("googleFilter"),
        start: "2026-03-24T11:00:00.000Z",
        end: "2026-03-24T12:00:00.000Z",
        allDay: false,
      },
    ],
  });

  await page.goto("/tasks?view=calendar");
  await expect(page.getByText(localTitle).first()).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Tâches" }).click();
  await expect(page.getByText(localTitle).first()).toBeHidden();
});

test("agenda_creation_attempts_google_event_creation_after_local_create", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  let googleCreatePayload: unknown = null;
  await mockGoogleCalendarCreate(page, {
    onRequest: (body) => {
      googleCreatePayload = body;
    },
  });

  const title = uniqueAgendaTitle("googleCreate");
  await createTaskFromCalendar(page, title);

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
  await expect.poll(() => googleCreatePayload).not.toBeNull();
  await expect
    .poll(() => (googleCreatePayload as { title?: string } | null)?.title ?? null)
    .toBe(title);
  await expect
    .poll(() => (googleCreatePayload as { taskId?: string } | null)?.taskId ?? null)
    .not.toBeNull();
  await expect
    .poll(() => (googleCreatePayload as { allDay?: boolean } | null)?.allDay ?? null)
    .toBe(true);
});

test("agenda_creation_keeps_tasknote_task_when_google_create_fails", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    status: 500,
    body: { created: false },
  });

  const title = uniqueAgendaTitle("googleFail");
  await createTaskFromCalendar(page, title);

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar.")).toBeVisible();
});

test("agenda_update_attempts_google_patch_for_linked_task", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-linked-1" },
  });

  let googleUpdatePayload: unknown = null;
  await mockGoogleCalendarUpdate(page, {
    onRequest: (body) => {
      googleUpdatePayload = body;
    },
  });

  const title = uniqueAgendaTitle("googlePatch");
  await createTaskFromCalendar(page, title);

  await page.getByText(title).first().click();
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel("Titre").fill(`${title} updated`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editDialog).toBeHidden();

  await expect.poll(() => googleUpdatePayload).not.toBeNull();
  await expect
    .poll(() => (googleUpdatePayload as { googleEventId?: string } | null)?.googleEventId ?? null)
    .toBe("gcal-linked-1");
  await expect
    .poll(() => (googleUpdatePayload as { title?: string } | null)?.title ?? null)
    .toContain("updated");
});

test("agenda_update_skips_google_patch_when_task_has_no_google_event_id", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  let patchCalls = 0;
  await mockGoogleCalendarUpdate(page, {
    onRequest: () => {
      patchCalls += 1;
    },
  });

  const title = uniqueAgendaTitle("noGoogleId");
  await createTaskFromCalendar(page, title);

  await page.getByText(title).first().click();
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel("Titre").fill(`${title} local only`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editDialog).toBeHidden();

  await expect.poll(() => patchCalls).toBe(0);
});

test("agenda_update_keeps_local_change_when_google_patch_fails", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-linked-2" },
  });
  await mockGoogleCalendarUpdate(page, {
    status: 500,
    body: { updated: false },
  });

  const title = uniqueAgendaTitle("googlePatchFail");
  await createTaskFromCalendar(page, title);

  await page.getByText(title).first().click();
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel("Titre").fill(`${title} kept`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editDialog).toBeHidden();

  await expect(page.getByText(`${title} kept`).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("La mise à jour Google Calendar a échoué.")).toBeVisible();
});

test("agenda_update_recreates_google_event_when_remote_event_is_missing", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-linked-recreate-1" },
  });

  let googleUpdatePayload: unknown = null;
  await mockGoogleCalendarUpdate(page, {
    status: 200,
    body: { updated: true, recreated: true, eventId: "gcal-linked-recreate-2" },
    onRequest: (body) => {
      googleUpdatePayload = body;
    },
  });

  const title = uniqueAgendaTitle("googlePatchRecreate");
  await createTaskFromCalendar(page, title);

  await page.getByText(title).first().click();
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel("Titre").fill(`${title} recreated`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(editDialog).toBeHidden();

  await expect.poll(() => googleUpdatePayload).not.toBeNull();
  await expect(page.getByText("Événement Google recréé après divergence détectée.")).toBeVisible();
});

test("agenda_detail_update_attempts_google_patch_for_linked_task", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-detail-1" },
  });

  let googleUpdatePayload: unknown = null;
  await mockGoogleCalendarUpdate(page, {
    onRequest: (body) => {
      googleUpdatePayload = body;
    },
  });

  const title = uniqueAgendaTitle("detailGooglePatch");
  await createTaskFromCalendar(page, title);

  const detailDialog = await openTaskDetailFromList(page, title);
  await enterTaskDetailEditMode(detailDialog);
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await editDialog.locator("#task-modal-title").fill(`${title} modal`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();

  await expect
    .poll(() => (googleUpdatePayload as { googleEventId?: string } | null)?.googleEventId ?? null)
    .toBe("gcal-detail-1");
  await expect
    .poll(() => (googleUpdatePayload as { title?: string } | null)?.title ?? null)
    .toContain("modal");
});

test("agenda_detail_update_keeps_local_change_when_google_patch_fails", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-detail-2" },
  });
  await mockGoogleCalendarUpdate(page, {
    status: 500,
    body: { updated: false },
  });

  const title = uniqueAgendaTitle("detailGoogleFail");
  await createTaskFromCalendar(page, title);

  const detailDialog = await openTaskDetailFromList(page, title);
  await enterTaskDetailEditMode(detailDialog);
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await editDialog.locator("#task-modal-title").fill(`${title} kept`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByRole("dialog", { name: "Détail de l’élément d’agenda" })).toBeVisible();
  await page.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByText(`${title} kept`).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_detail_update_returns_to_view_without_waiting_for_reminder_resync", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  const title = uniqueAgendaTitle("detailReminderResync");
  await createTaskFromCalendar(page, title);
  await convertCalendarTaskToTimed(page, title, "08:00", "09:00");

  const detailDialog = await openTaskDetailFromList(page, title);
  await addTaskReminderFromDetail(detailDialog, "2026-03-24T08:30");

  await enterTaskDetailEditMode(detailDialog);
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await editDialog.locator("#task-modal-title").fill(`${title} fast`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByRole("dialog", { name: "Détail de l’élément d’agenda" })).toBeVisible();
  await expect(page.getByText(`${title} fast`).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_task_create_form_attempts_google_create_and_persists_link", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks/new");

  let googleCreatePayload: unknown = null;
  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-form-1" },
    onRequest: (body) => {
      googleCreatePayload = body;
    },
  });

  let googleUpdatePayload: unknown = null;
  await mockGoogleCalendarUpdate(page, {
    onRequest: (body) => {
      googleUpdatePayload = body;
    },
  });

  const title = uniqueAgendaTitle("formGoogleCreate");
  await createTaskViaStandaloneForm(page, {
    title,
    startDate: "2026-03-24",
    dueDate: "2026-03-25T00:00",
  });

  await expect(page.getByText("Élément ajouté à l’agenda.")).toBeVisible();
  await expect
    .poll(() => (googleCreatePayload as { title?: string } | null)?.title ?? null)
    .toBe(title);

  const detailDialog = await openTaskDetailFromList(page, title);
  await enterTaskDetailEditMode(detailDialog);
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await editDialog.locator("#task-modal-title").fill(`${title} linked`);
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();

  await expect
    .poll(() => (googleUpdatePayload as { googleEventId?: string } | null)?.googleEventId ?? null)
    .toBe("gcal-form-1");
});

test("agenda_task_create_form_keeps_local_task_when_google_create_fails", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks/new");

  await mockGoogleCalendarCreate(page, {
    status: 500,
    body: { created: false },
  });

  const title = uniqueAgendaTitle("formGoogleFail");
  await createTaskViaStandaloneForm(page, {
    title,
    startDate: "2026-03-24",
    dueDate: "2026-03-25T00:00",
  });

  await expect(page.getByText("Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar.")).toBeVisible();
  await page.goto("/tasks?view=list");
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_task_create_form_shows_explicit_message_when_google_create_returns_created_false", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks/new");

  await mockGoogleCalendarCreate(page, {
    status: 200,
    body: { created: false, eventId: null },
  });

  const title = uniqueAgendaTitle("formGoogleCreatedFalse");
  await createTaskViaStandaloneForm(page, {
    title,
    startDate: "2026-03-24",
    dueDate: "2026-03-25T00:00",
  });

  await expect(page.getByText("Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar.")).toBeVisible();
  await page.goto("/tasks?view=list");
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_task_create_form_without_complete_window_shows_google_skip_message_and_skips_create", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks/new");

  await mockGoogleCalendar(page, { connected: true, events: [] });

  let googleCreateCalls = 0;
  await mockGoogleCalendarCreate(page, {
    onRequest: () => {
      googleCreateCalls += 1;
    },
  });

  const title = uniqueAgendaTitle("formNoWindow");
  await page.goto("/tasks/new");
  await page.locator("#task-new-title").fill(title);
  await page.locator("#task-new-start").fill("2026-03-24");
  await page.getByRole("button", { name: "Créer dans l’agenda" }).click();

  await expect(page.getByText("Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar faute de plage horaire complète.")).toBeVisible();
  await expect.poll(() => googleCreateCalls).toBe(0);
  await page.goto("/tasks?view=list");
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_create_modal_shows_pending_feedback_before_close", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");
  await delayCallable(page, "createTaskWithPlanGuard");

  const dialog = await openTaskCreateDialogFromPicker(page, "/tasks?view=calendar");
  const title = uniqueAgendaTitle("pending");
  await dialog.locator("#task-new-title").fill(title);
  await dialog.getByRole("button", { name: "Créer dans l’agenda" }).click();

  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("button", { name: "Création de l’agenda…" })).toBeDisabled();
  await expect(dialog.getByText("Enregistrement de l’élément d’agenda…")).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 15000 });
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("note_create_modal_creates_note_and_closes", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/notes?create=1");

  await page.goto("/notes?create=1");
  const dialog = page.getByRole("dialog", { name: "Nouvelle note" });
  await expect(dialog).toBeVisible();

  const title = `E2E Note ${Date.now()}`;
  await dialog.locator("#note-title").fill(title);
  await dialog.getByRole("button", { name: "Créer la note" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("note_create_modal_shows_pending_feedback_before_close", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/notes?create=1");
  await delayCallable(page, "createNoteWithPlanGuard");

  await page.goto("/notes?create=1");
  const dialog = page.getByRole("dialog", { name: "Nouvelle note" });
  await expect(dialog).toBeVisible();

  const title = `E2E Note Pending ${Date.now()}`;
  await dialog.locator("#note-title").fill(title);
  await dialog.getByRole("button", { name: "Créer la note" }).click();

  await expect(dialog.locator("[aria-busy='true']")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Création de la note…" })).toBeDisabled();
  await expect(dialog.getByText("Enregistrement de la note…")).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 15000 });
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});

test("agenda_detail_update_without_complete_window_shows_google_skip_message_and_skips_patch", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendar(page, { connected: true, events: [] });
  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-detail-no-window" },
  });

  let googleUpdateCalls = 0;
  await mockGoogleCalendarUpdate(page, {
    onRequest: () => {
      googleUpdateCalls += 1;
    },
  });

  const title = uniqueAgendaTitle("detailNoWindow");
  await createTaskFromCalendar(page, title);
  await convertCalendarTaskToTimed(page, title, "10:00", "11:00");

  const detailDialog = await openTaskDetailFromList(page, title);
  await enterTaskDetailEditMode(detailDialog);
  const editDialog = page.getByRole("dialog", { name: "Modifier l’élément d’agenda" });
  await editDialog.getByLabel("Date de fin / échéance").fill("");
  await editDialog.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Élément enregistré dans TaskNote, mais non synchronisé avec Google Calendar faute de plage horaire complète.")).toBeVisible();
  await expect.poll(() => googleUpdateCalls).toBe(0);
});

test("agenda_delete_attempts_google_delete_for_linked_task", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-delete-1" },
  });

  let googleDeletePayload: unknown = null;
  await mockGoogleCalendarDelete(page, {
    onRequest: (body) => {
      googleDeletePayload = body;
    },
  });

  const title = uniqueAgendaTitle("googleDelete");
  await createTaskFromCalendar(page, title);

  const detailDialog = await openTaskDetailFromList(page, title);
  await detailDialog.getByRole("button", { name: "Actions" }).click();
  await detailDialog.getByRole("menuitem", { name: "Supprimer" }).click();
  await detailDialog.getByRole("button", { name: "Supprimer définitivement" }).click();

  await expect(detailDialog).toBeHidden();
  await expect.poll(() => googleDeletePayload).not.toBeNull();
  await expect
    .poll(() => (googleDeletePayload as { taskId?: string } | null)?.taskId ?? null)
    .not.toBeNull();
  await expect
    .poll(() => (googleDeletePayload as { googleEventId?: string } | null)?.googleEventId ?? null)
    .toBe("gcal-delete-1");
});

test("agenda_delete_skips_google_delete_when_task_has_no_google_event_id", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  let deleteCalls = 0;
  await mockGoogleCalendarDelete(page, {
    onRequest: () => {
      deleteCalls += 1;
    },
  });

  const title = uniqueAgendaTitle("noGoogleDeleteId");
  await createTaskFromCalendar(page, title);

  const detailDialog = await openTaskDetailFromList(page, title);
  await detailDialog.getByRole("button", { name: "Actions" }).click();
  await detailDialog.getByRole("menuitem", { name: "Supprimer" }).click();
  await detailDialog.getByRole("button", { name: "Supprimer définitivement" }).click();

  await expect(detailDialog).toBeHidden();
  await expect.poll(() => deleteCalls).toBe(0);
});

test("agenda_delete_blocks_local_delete_when_google_delete_fails", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/tasks?view=calendar");

  await mockGoogleCalendarCreate(page, {
    body: { created: true, eventId: "gcal-delete-2" },
  });
  await mockGoogleCalendarDelete(page, {
    status: 500,
    body: { deleted: false },
  });

  const title = uniqueAgendaTitle("googleDeleteFail");
  await createTaskFromCalendar(page, title);

  const detailDialog = await openTaskDetailFromList(page, title);
  await detailDialog.getByRole("button", { name: "Actions" }).click();
  await detailDialog.getByRole("menuitem", { name: "Supprimer" }).click();
  await detailDialog.getByRole("button", { name: "Supprimer définitivement" }).click();

  await expect(detailDialog).toBeVisible();
  await expect(page.getByText("La suppression Google Calendar a échoué.")).toBeVisible();
  await page.goto("/tasks?view=list");
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
});
