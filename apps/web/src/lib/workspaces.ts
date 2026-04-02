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

  const visit = (workspace: WorkspaceDoc, depth: number, ancestors: string[], ancestorIds: string[]) => {
    const workspaceId = getWorkspaceId(workspace);
    if (workspaceId && visited.has(workspaceId)) return;
    if (workspaceId) visited.add(workspaceId);

    const safeName = normalizeDisplayText(workspace.name) || "Dossier";
    const pathLabel = [...ancestors, safeName].join(" / ");

    flattened.push({
      workspace,
      depth,
      pathLabel,
      ancestorIds,
    });

    const children = childrenByParent.get(workspaceId) ?? [];
    for (const child of children) {
      visit(child, depth + 1, [...ancestors, safeName], workspaceId ? [...ancestorIds, workspaceId] : ancestorIds);
    }
  };

  for (const rootWorkspace of childrenByParent.get(null) ?? []) {
    visit(rootWorkspace, 0, [], []);
  }

  for (const workspace of sortWorkspaces(workspaces)) {
    const workspaceId = getWorkspaceId(workspace);
    if (!workspaceId || !visited.has(workspaceId)) {
      visit(workspace, 0, [], []);
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

export function buildWorkspaceDescendantIdsMap(workspaces: WorkspaceDoc[]) {
  const items = flattenWorkspaces(workspaces);
  const descendantIdsById = new Map<string, Set<string>>();

  for (const item of items) {
    const workspaceId = getWorkspaceId(item.workspace);
    if (!workspaceId) continue;
    descendantIdsById.set(workspaceId, new Set([workspaceId]));
  }

  for (const item of items) {
    const workspaceId = getWorkspaceId(item.workspace);
    if (!workspaceId) continue;
    for (const ancestorId of item.ancestorIds) {
      descendantIdsById.get(ancestorId)?.add(workspaceId);
    }
  }

  return descendantIdsById;
}

export function getWorkspaceSelfAndDescendantIds(workspaces: WorkspaceDoc[], workspaceId?: string | null) {
  if (!workspaceId) return null;
  return buildWorkspaceDescendantIdsMap(workspaces).get(workspaceId) ?? new Set([workspaceId]);
}

export function getWorkspaceDirectContentIds(workspaceId?: string | null) {
  if (!workspaceId) return null;
  return new Set([workspaceId]);
}

export function getWorkspaceResolvedParentId(workspaces: WorkspaceDoc[], workspaceId?: string | null) {
  if (!workspaceId) return null;
  const byId = buildWorkspaceById(workspaces);
  const workspace = byId.get(workspaceId);
  if (!workspace) return null;
  return getResolvedParentId(workspace, byId);
}

export function getWorkspaceById(workspaces: WorkspaceDoc[], workspaceId?: string | null) {
  if (!workspaceId) return null;
  return buildWorkspaceById(workspaces).get(workspaceId) ?? null;
}

export function getWorkspaceDirectChildren(workspaces: WorkspaceDoc[], parentId?: string | null) {
  if (!parentId) return [];

  const byId = buildWorkspaceById(workspaces);
  return sortWorkspaces(workspaces).filter((workspace) => getResolvedParentId(workspace, byId) === parentId);
}

export function getWorkspaceChain(workspaces: WorkspaceDoc[], workspaceId?: string | null) {
  if (!workspaceId) return [];

  const byId = buildWorkspaceById(workspaces);
  const chain: WorkspaceDoc[] = [];
  const visited = new Set<string>();
  let currentId: string | null = workspaceId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const workspace = byId.get(currentId);
    if (!workspace) break;
    chain.unshift(workspace);
    currentId = getResolvedParentId(workspace, byId);
  }

  return chain;
}

export function countItemsByWorkspaceId<T extends { workspaceId?: string | null }>(
  items: T[],
  predicate?: (item: T) => boolean,
) {
  const counts = new Map<string, number>();

  for (const item of items) {
    if (predicate && !predicate(item)) continue;
    const workspaceId = typeof item.workspaceId === "string" && item.workspaceId.trim() ? item.workspaceId.trim() : null;
    if (!workspaceId) continue;
    counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1);
  }

  return counts;
}

export function applyWorkspaceAssignmentOverrides<T extends { id?: string; workspaceId?: string | null }>(
  items: T[],
  overrides: Record<string, string | null>,
) {
  return items.map((item) => {
    if (!item.id || !Object.prototype.hasOwnProperty.call(overrides, item.id)) return item;
    return { ...item, workspaceId: overrides[item.id] ?? null };
  });
}

export function applyWorkspaceParentOverrides(
  workspaces: WorkspaceDoc[],
  overrides: Record<string, string | null>,
) {
  return workspaces.map((workspace) => {
    if (!workspace.id || !Object.prototype.hasOwnProperty.call(overrides, workspace.id)) return workspace;
    return { ...workspace, parentId: overrides[workspace.id] ?? null };
  });
}

export function canMoveWorkspaceToParent(
  workspaces: WorkspaceDoc[],
  workspaceId?: string | null,
  targetParentId?: string | null,
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
