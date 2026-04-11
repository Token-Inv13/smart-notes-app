import type { WorkspaceDoc } from "@/types/firestore";
import { normalizeDisplayText } from "@/lib/normalizeText";

export type FlattenedWorkspaceItem = {
  workspace: WorkspaceDoc;
  depth: number;
  pathLabel: string;
  ancestorIds: string[];
};

type WorkspaceLike = {
  id?: string;
  workspaceId?: string | null;
};

function compareWorkspaces(a: WorkspaceDoc, b: WorkspaceDoc) {
  const ao = typeof a.order === "number" ? a.order : null;
  const bo = typeof b.order === "number" ? b.order : null;

  if (ao !== null && bo !== null && ao !== bo) return ao - bo;
  if (ao !== null && bo === null) return -1;
  if (ao === null && bo !== null) return 1;

  return normalizeDisplayText(a.name || "").localeCompare(normalizeDisplayText(b.name || ""), "fr");
}

function getWorkspaceId(workspace: WorkspaceDoc | null | undefined): string | null {
  return typeof workspace?.id === "string" && workspace.id.trim() ? workspace.id.trim() : null;
}

function buildWorkspaceById(workspaces: WorkspaceDoc[]) {
  const byId = new Map<string, WorkspaceDoc>();
  if (!Array.isArray(workspaces)) return byId;

  for (const workspace of workspaces) {
    const id = getWorkspaceId(workspace);
    if (!id) continue;
    byId.set(id, workspace);
  }

  return byId;
}

function getResolvedParentId(workspace: WorkspaceDoc, byId: Map<string, WorkspaceDoc>): string | null {
  const workspaceId = getWorkspaceId(workspace);
  const parentId =
    typeof workspace.parentId === "string" && workspace.parentId.trim() ? workspace.parentId.trim() : null;

  if (!parentId || !workspaceId) return null;
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
    const workspaceId = getWorkspaceId(workspace);
    if (!workspaceId) continue;
    pushChild(getResolvedParentId(workspace, byId), workspace);
  }

  for (const [parentId, items] of childrenByParent.entries()) {
    childrenByParent.set(parentId, items.slice().sort(compareWorkspaces));
  }

  const flattened: FlattenedWorkspaceItem[] = [];
  const visited = new Set<string>();

  const visit = (workspace: WorkspaceDoc, depth: number, ancestors: string[], ancestorIds: string[]) => {
    const workspaceId = getWorkspaceId(workspace);
    if (!workspaceId || visited.has(workspaceId)) return;
    visited.add(workspaceId);

    const safeName = normalizeDisplayText(workspace.name) || "Dossier";
    const pathSegments = [...ancestors, safeName];
    flattened.push({
      workspace,
      depth,
      pathLabel: pathSegments.join(" / "),
      ancestorIds,
    });

    const children = childrenByParent.get(workspaceId) ?? [];
    for (const child of children) {
      visit(child, depth + 1, pathSegments, [...ancestorIds, workspaceId]);
    }
  };

  const roots = childrenByParent.get(null) ?? [];
  for (const root of roots) {
    visit(root, 0, [], []);
  }

  for (const workspace of sortWorkspaces(workspaces)) {
    visit(workspace, 0, [], []);
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
    return normalizeDisplayText(labels.get(workspaceId) ?? workspace.name);
  }
  return normalizeDisplayText(workspace.name);
}

export function getRootWorkspaceOptions(workspaces: WorkspaceDoc[]) {
  const byId = buildWorkspaceById(workspaces);
  return sortWorkspaces(workspaces).filter((workspace) => getResolvedParentId(workspace, byId) === null);
}

export function getWorkspaceById(workspaces: WorkspaceDoc[], workspaceId: string | null | undefined) {
  if (!workspaceId) return null;
  const byId = buildWorkspaceById(workspaces);
  return byId.get(workspaceId) ?? null;
}

export function getWorkspaceResolvedParentId(workspaces: WorkspaceDoc[], workspaceId: string | null | undefined) {
  const workspace = getWorkspaceById(workspaces, workspaceId);
  if (!workspace) return null;
  return getResolvedParentId(workspace, buildWorkspaceById(workspaces));
}

export function getWorkspaceChain(workspaces: WorkspaceDoc[], workspaceId: string | null | undefined) {
  if (!workspaceId) return [];

  const byId = buildWorkspaceById(workspaces);
  const chain: WorkspaceDoc[] = [];
  const seen = new Set<string>();
  let current = byId.get(workspaceId) ?? null;

  while (current) {
    const currentId = getWorkspaceId(current);
    if (!currentId || seen.has(currentId)) break;
    seen.add(currentId);
    chain.unshift(current);

    const parentId = getResolvedParentId(current, byId);
    current = parentId ? byId.get(parentId) ?? null : null;
  }

  return chain;
}

export function getWorkspaceDirectChildren(workspaces: WorkspaceDoc[], parentId: string | null | undefined) {
  const byId = buildWorkspaceById(workspaces);
  return sortWorkspaces(workspaces).filter((workspace) => getResolvedParentId(workspace, byId) === (parentId ?? null));
}

export function getWorkspaceSelfAndDescendantIds(workspaces: WorkspaceDoc[], workspaceId: string | null | undefined) {
  if (!workspaceId) return null;
  const byId = buildWorkspaceById(workspaces);
  if (!byId.has(workspaceId)) return null;

  const ids = new Set<string>();
  const queue = [workspaceId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || ids.has(currentId)) continue;
    ids.add(currentId);

    for (const workspace of workspaces) {
      const childId = getWorkspaceId(workspace);
      if (!childId || ids.has(childId)) continue;
      if (getResolvedParentId(workspace, byId) === currentId) {
        queue.push(childId);
      }
    }
  }

  return ids;
}

export function getWorkspaceDirectContentIds(workspaceId: string | null | undefined) {
  if (!workspaceId) return null;
  return new Set([workspaceId]);
}

export function countItemsByWorkspaceId<T extends WorkspaceLike>(
  items: T[],
  predicate?: (item: T) => boolean,
) {
  const counts = new Map<string, number>();
  if (!Array.isArray(items)) return counts;

  for (const item of items) {
    if (!item) continue;
    if (predicate && !predicate(item)) continue;
    const workspaceId = typeof item.workspaceId === "string" && item.workspaceId.trim() ? item.workspaceId.trim() : null;
    if (!workspaceId) continue;
    counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1);
  }

  return counts;
}

export function applyWorkspaceAssignmentOverrides<T extends WorkspaceLike>(
  items: T[],
  overrides: Record<string, string | null | undefined>,
) {
  if (!Array.isArray(items) || !overrides || Object.keys(overrides).length === 0) return items;

  return items.map((item) => {
    if (!item?.id || !(item.id in overrides)) return item;
    return {
      ...item,
      workspaceId: overrides[item.id] ?? null,
    };
  });
}

export function applyWorkspaceParentOverrides(
  workspaces: WorkspaceDoc[],
  overrides: Record<string, string | null | undefined>,
) {
  if (!Array.isArray(workspaces) || !overrides || Object.keys(overrides).length === 0) return workspaces;

  return workspaces.map((workspace) => {
    const workspaceId = getWorkspaceId(workspace);
    if (!workspaceId || !(workspaceId in overrides)) return workspace;
    return {
      ...workspace,
      parentId: overrides[workspaceId] ?? null,
    };
  });
}

export function canMoveWorkspaceToParent(
  workspaces: WorkspaceDoc[],
  workspaceId: string | null | undefined,
  targetParentId: string | null | undefined,
) {
  if (!workspaceId || !targetParentId) return false;
  if (workspaceId === targetParentId) return false;

  const currentParentId = getWorkspaceResolvedParentId(workspaces, workspaceId);
  if (currentParentId === targetParentId) return false;

  const descendantIds = getWorkspaceSelfAndDescendantIds(workspaces, workspaceId);
  if (descendantIds?.has(targetParentId)) return false;

  return true;
}
