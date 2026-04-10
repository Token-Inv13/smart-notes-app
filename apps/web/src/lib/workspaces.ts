import type { WorkspaceDoc } from "@/types/firestore";
import { normalizeDisplayText } from "@/lib/normalizeText";

export type FlattenedWorkspaceItem = {
  workspace: WorkspaceDoc;
  depth: number;
  pathLabel: string;
  ancestorIds: string[];
};

function compareWorkspaces(a: WorkspaceDoc, b: WorkspaceDoc) {
  const ao = typeof a.order === "number" ? a.order : null;
  const bo = typeof b.order === "number" ? b.order : null;

  if (ao !== null && bo !== null && ao !== bo) return ao - bo;
  if (ao !== null && bo === null) return -1;
  if (ao === null && bo !== null) return 1;

  return normalizeDisplayText(a.name || "").localeCompare(normalizeDisplayText(b.name || ""), "fr");
}

function getWorkspaceId(workspace: WorkspaceDoc): string | null {
  return typeof workspace.id === "string" && workspace.id.trim() ? workspace.id : null;
}

function buildWorkspaceById(workspaces: WorkspaceDoc[]) {
  const byId = new Map<string, WorkspaceDoc>();
  if (!Array.isArray(workspaces)) return byId;

  for (const workspace of workspaces) {
    if (!workspace) continue;
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
  if (!Array.isArray(workspaces)) return [];
  return workspaces.slice().sort(compareWorkspaces);
}

export function flattenWorkspaces(workspaces: WorkspaceDoc[]): FlattenedWorkspaceItem[] {
  if (!Array.isArray(workspaces)) return [];
  const byId = buildWorkspaceById(workspaces);
  const childrenByParent = new Map<string | null, WorkspaceDoc[]>();

  const pushChild = (parentId: string | null, workspace: WorkspaceDoc) => {
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(workspace);
    childrenByParent.set(parentId, bucket);
  };

  for (const workspace of workspaces) {
    if (!workspace) continue;
    pushChild(getResolvedParentId(workspace, byId), workspace);
  }

  for (const [parentId, items] of childrenByParent) {
    childrenByParent.set(parentId, items.slice().sort(compareWorkspaces));
  }

  const flattened: FlattenedWorkspaceItem[] = [];
  const visited = new Set<string>();

  const visit = (workspace: WorkspaceDoc, depth: number, ancestors: string[], ancestorIds: string[]) => {
    const workspaceId = getWorkspaceId(workspace);
    if (workspaceId && visited.has(workspaceId)) return;
    if (workspaceId) visited.add(workspaceId);

    const safeName = normalizeDisplayText(workspace.name) || "Dossier";
) {
  if (!workspaceId || !targetParentId) return false;
  if (workspaceId === targetParentId) return false;

  const currentParentId = getWorkspaceResolvedParentId(workspaces, workspaceId);
  if (currentParentId === targetParentId) return false;

  const descendantIds = getWorkspaceSelfAndDescendantIds(workspaces, workspaceId);
  if (descendantIds?.has(targetParentId)) return false;

  return true;
}

export function getWorkspaceOptionLabel(workspace: WorkspaceDoc, labels?: Map<string, string>) {
  const workspaceId = getWorkspaceId(workspace);
  if (workspaceId && labels?.has(workspaceId)) {
    return normalizeDisplayText(labels.get(workspaceId) ?? workspace.name);
  }
  return normalizeDisplayText(workspace.name);
}

export function getRootWorkspaceOptions(workspaces: WorkspaceDoc[]) {
  const byId = buildWorkspaceById(workspaces);
  return sortWorkspaces(workspaces).filter((workspace) => getResolvedParentId(workspace, byId) === null);
}
