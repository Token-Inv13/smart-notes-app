import { expect, test } from "@playwright/test";
import { getE2EUsers, loginViaUi } from "../helpers/auth";
import {
  createInviteViaSettingsUi,
  createWorkspaceFromSidebar,
  getReceivedInvites,
  uniqueWorkspaceName,
} from "../helpers/workspace";
import {
  createFirstTaskOnOnboarding,
  expectOnboardingPage,
  expectViewerBlockedMessage,
} from "../helpers/ui";

async function waitForInviteToken(pageRequest: import("@playwright/test").APIRequestContext, workspaceName: string) {
  await expect
    .poll(
      async () => {
        const invites = await getReceivedInvites(pageRequest);
        const found = invites.find((invite) => invite.workspaceName === workspaceName && typeof invite.token === "string");
        return found?.token ?? null;
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] },
    )
    .not.toBeNull();

  const invites = await getReceivedInvites(pageRequest);
  const found = invites.find((invite) => invite.workspaceName === workspaceName && typeof invite.token === "string");
  return found?.token ?? "";
}

test.describe.configure({ mode: "serial" });

test("e2e_invite_accept_onboarding_activate_editor", async ({ browser }) => {
  const users = getE2EUsers();
  const workspaceName = uniqueWorkspaceName("E2E-editor");

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginViaUi(ownerPage, users.owner, "/dashboard");

  await createWorkspaceFromSidebar(ownerPage, workspaceName);
  await createInviteViaSettingsUi(ownerPage, {
    workspaceName,
    invitedEmail: users.editor.email,
    role: "editor",
  });

  const editorContext = await browser.newContext();
  const editorPage = await editorContext.newPage();
  await loginViaUi(editorPage, users.editor, "/dashboard");

  const inviteToken = await waitForInviteToken(editorPage.request, workspaceName);
  expect(inviteToken).not.toBe("");

  await editorPage.goto(`/invite/${encodeURIComponent(inviteToken)}`);
  await editorPage.getByRole("button", { name: "Accepter et démarrer" }).click();

  await expectOnboardingPage(editorPage);
  await createFirstTaskOnOnboarding(editorPage, `Tache e2e ${Date.now()}`);

  await ownerContext.close();
  await editorContext.close();
});

test("e2e_invite_viewer_permissions_block_write", async ({ browser }) => {
  const users = getE2EUsers();
  const workspaceName = uniqueWorkspaceName("E2E-viewer");

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginViaUi(ownerPage, users.owner, "/dashboard");

  await createWorkspaceFromSidebar(ownerPage, workspaceName);
  await createInviteViaSettingsUi(ownerPage, {
    workspaceName,
    invitedEmail: users.viewer.email,
    role: "viewer",
  });

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await loginViaUi(viewerPage, users.viewer, "/dashboard");

  const inviteToken = await waitForInviteToken(viewerPage.request, workspaceName);
  expect(inviteToken).not.toBe("");

  const activationRequests: string[] = [];
  viewerPage.on("request", (request) => {
    if (request.url().includes("/api/workspace/activate") && request.method() === "POST") {
      activationRequests.push(request.url());
    }
  });

  await viewerPage.goto(`/invite/${encodeURIComponent(inviteToken)}`);
  await viewerPage.getByRole("button", { name: "Accepter et démarrer" }).click();

  await expectOnboardingPage(viewerPage);
  await expectViewerBlockedMessage(viewerPage);

  await expect.poll(() => activationRequests.length, { timeout: 2_000 }).toBe(0);

  await ownerContext.close();
  await viewerContext.close();
});
