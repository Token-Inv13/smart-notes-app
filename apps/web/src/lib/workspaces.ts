import type { WorkspaceDoc } from "@/types/firestore";

export type FlattenedWorkspaceItem = {
  workspace: WorkspaceDoc;
  depth: number;
  pathLabel: string;
};

function compareWorkspaces(a: WorkspaceDoc, b: WorkspaceDoc) {
  const ao = typeof a.order === "number" ? a.order : null;
  const bo = typeof b.order === "number" ? b.order : null;

  if (ao !== null && bo !== null && ao !== bo) return ao - bo;
  if (ao !== null && bo === null) return -1;
  if (ao === null && bo !== null) return 1;

  return (a.name || "").localeCompare(b.name || "", "fr");
}

function getWorkspaceId(workspace: WorkspaceDoc): string | null {
  return typeof workspace.id === "string" && workspace.id.trim() ? workspace.id : null;
}

function buildWorkspaceById(workspaces: WorkspaceDoc[]) {
  const byId = new Map<string, WorkspaceDoc>();

  for (const workspace of workspaces) {
    const id = getWorkspaceId(workspace);
    if (!id) continue;
    byId.set(id, workspace);
  }

  return byId;
}

function getResolvedParentId(workspace: WorkspaceDoc, byId: Map<string, WorkspaceDoc>): string | null {
  const workspaceId = getWorkspaceId(workspace);
  const parentId = typeof workspace.parentId === "string" && workspace.parentId.trim() ? workspace.parentId.trim() : null;

  if (!parentId) return null;
  if (!workspaceId) return null;
  if (parentId === workspaceId) return null;
  if (!byId.has(parentId)) return null;

  return parentId;
}

export function sortWorkspaces(workspaces: WorkspaceDoc[]) {
  return workspaces.slice().sort(compareWorkspaces);
}

export function flattenWorkspaces(workspaces: WorkspaceDoc[]): FlattenedWorkspaceItem[] {
  const byId = buildWorkspaceById(workspaces);
  const childrenByParent = new Map<string | null, WorkspaceDoc[]>();

  const pushChild = (parentId: string | null, workspace: WorkspaceDoc) => {
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(workspace);
    childrenByParent.set(parentId, bucket);
  };

  for (const workspace of workspaces) {
    pushChild(getResolvedParentId(workspace, byId), workspace);
  }

  for (const [parentId, items] of childrenByParent) {
    childrenByParent.set(parentId, items.slice().sort(compareWorkspaces));
  }

  const flattened: FlattenedWorkspaceItem[] = [];
  const visited = new Set<string>();

  const visit = (workspace: WorkspaceDoc, depth: number, ancestors: string[]) => {
    const workspaceId = getWorkspaceId(workspace);
    if (workspaceId && visited.has(workspaceId)) return;
    if (workspaceId) visited.add(workspaceId);

    const safeName = workspace.name || "Dossier";
    const pathLabel = [...ancestors, safeName].join(" / ");

    flattened.push({
      workspace,
      depth,
      pathLabel,
    });

    const children = childrenByParent.get(workspaceId) ?? [];
    for (const child of children) {
      visit(child, depth + 1, [...ancestors, safeName]);
    }
  };

  for (const rootWorkspace of childrenByParent.get(null) ?? []) {
    visit(rootWorkspace, 0, []);
  }

  for (const workspace of sortWorkspaces(workspaces)) {
    const workspaceId = getWorkspaceId(workspace);
    if (!workspaceId || !visited.has(workspaceId)) {
      visit(workspace, 0, []);
    }
  }

  return flattened;
}

export function buildWorkspacePathLabelMap(workspaces: WorkspaceDoc[]) {
  const labels = new Map<string, string>();

  for (const item of flattenWorkspaces(workspaces)) {
    const workspaceId = getWorkspaceId(item.workspace);
    if (!workspaceId) continue;
    labels.set(workspaceId, item.pathLabel);
  }

  return labels;
}

export function getWorkspaceOptionLabel(workspace: WorkspaceDoc, labels?: Map<string, string>) {
  const workspaceId = getWorkspaceId(workspace);
  if (workspaceId && labels?.has(workspaceId)) {
    return labels.get(workspaceId) ?? workspace.name;
  }
  return workspace.name;
}

export function getRootWorkspaceOptions(workspaces: WorkspaceDoc[]) {
  const byId = buildWorkspaceById(workspaces);
  return sortWorkspaces(workspaces).filter((workspace) => getResolvedParentId(workspace, byId) === null);
}
