import { expect, test } from "@playwright/test";
import { getE2EUsers, loginViaUi } from "../helpers/auth";
import {
  aliasEmail,
  createWorkspaceFromSidebar,
  sendInviteViaApi,
  uniqueWorkspaceName,
} from "../helpers/workspace";
import { openWeeklySummaryAndClose } from "../helpers/ui";

test.describe.configure({ mode: "serial" });

test("e2e_rate_limit_invites_basic", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/dashboard");

  const workspaceName = uniqueWorkspaceName("E2E-rate-limit");
  const workspaceId = await createWorkspaceFromSidebar(page, workspaceName);

  const responses: Array<{ status: number; error: string | null }> = [];
  for (let i = 0; i < 7; i += 1) {
    const invitedEmail = aliasEmail(users.editor.email, `rate${i}`);
    responses.push(
      await sendInviteViaApi(page.request, {
        workspaceId,
        email: invitedEmail,
        role: "editor",
      }),
    );
  }

  const tooMany = responses.filter((entry) => entry.status === 429);
  expect(tooMany.length).toBeGreaterThan(0);
  expect(tooMany.some((entry) => entry.error === "Trop d’invitations envoyées. Réessayez plus tard.")).toBeTruthy();
});

test("e2e_google_status_non404_on_app_host", async ({ request }) => {
  const response = await request.get("/api/google/calendar/status");
  expect([200, 401, 403, 429]).toContain(response.status());
  expect(response.status()).not.toBe(404);
  expect(response.status()).not.toBe(500);
});

test("e2e_weekly_summary_renders", async ({ page }) => {
  const users = getE2EUsers();
  await loginViaUi(page, users.owner, "/dashboard");

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Résumé stratégique de la semaine" })).toBeVisible();

  await openWeeklySummaryAndClose(page);
});
