import { expect, type APIRequestContext, type Page } from "@playwright/test";

export type PendingInvitation = {
  id: string;
  workspaceId: string;
  workspaceName?: string | null;
  role: "viewer" | "editor";
  token?: string;
};

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function uniqueWorkspaceName(prefix = "E2E"): string {
  return `${prefix}-${Date.now()}-${randomSuffix()}`;
}

export function aliasEmail(baseEmail: string, tag: string): string {
  const [localRaw, domain] = baseEmail.split("@");
  if (!localRaw || !domain) return `${tag}-${Date.now()}@example.com`;
  const local = localRaw.split("+")[0] ?? localRaw;
  return `${local}+${tag}-${Date.now()}-${randomSuffix()}@${domain}`;
}

export async function createWorkspaceFromSidebar(page: Page, workspaceName: string): Promise<string> {
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Ouvrir les paramètres" })).toBeVisible();

  const workspaceInput = page.getByLabel("Nom du nouveau dossier");
  await workspaceInput.fill(workspaceName);

  await Promise.all([
    page.waitForURL(/workspaceId=/, { timeout: 20_000 }),
    page.getByRole("button", { name: "Créer", exact: true }).click(),
  ]);

  await expect(page.getByText(workspaceName, { exact: true })).toBeVisible({ timeout: 10_000 });

  const url = new URL(page.url());
  const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
  expect(workspaceId, "workspaceId should be present after workspace creation").not.toBe("");
  return workspaceId;
}

export async function openSettingsCollaboration(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Collaboration workspace" })).toBeVisible();
}

export async function createInviteViaSettingsUi(page: Page, params: {
  workspaceName: string;
  invitedEmail: string;
  role: "viewer" | "editor";
}): Promise<void> {
  await openSettingsCollaboration(page);

  const workspaceSelect = page.locator("#inviteWorkspaceId");
  await workspaceSelect.selectOption({ label: params.workspaceName });

  await page.locator("#inviteEmail").fill(params.invitedEmail);
  await page.getByLabel("Rôle de l'invitation").selectOption(params.role);

  const responsePromise = page.waitForResponse((response) => {
    return response.url().includes("/api/workspace/invite") && response.request().method() === "POST";
  });

  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), "invite API status should be 200").toBe(200);

  await expect(page.getByText("Invitation créée.")).toBeVisible({ timeout: 10_000 });
}

export async function getReceivedInvites(request: APIRequestContext): Promise<PendingInvitation[]> {
  const response = await request.get("/api/workspace/invite?scope=received");
  expect(response.status(), "received invites endpoint should return 200").toBe(200);

  const payload = (await response.json()) as { invitations?: PendingInvitation[] };
  return Array.isArray(payload.invitations) ? payload.invitations : [];
}

export async function sendInviteViaApi(request: APIRequestContext, body: {
  workspaceId: string;
  email: string;
  role: "viewer" | "editor";
}): Promise<{ status: number; error: string | null }> {
  const response = await request.post("/api/workspace/invite", { data: body });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return {
    status: response.status(),
    error: typeof payload.error === "string" ? payload.error : null,
  };
}
