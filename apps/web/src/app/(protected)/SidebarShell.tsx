"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PanelLeft, Menu, X } from "lucide-react";
import SidebarWorkspaces from "./SidebarWorkspaces";
import PwaInstallCta from "./_components/PwaInstallCta";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { WorkspaceDoc } from "@/types/firestore";

const STORAGE_KEY = "sidebarCollapsed";

type ActiveDragState =
  | { kind: "workspace"; id: string }
  | null;

export default function SidebarShell({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const workspaceId = searchParams.get("workspaceId");
  const { data: workspaces, loading: workspacesLoading, error: workspacesError } = useUserWorkspaces();

  const baseSortedWorkspaces = useMemo(() => {
    return workspaces
      .slice()
      .sort((a, b) => {
        const ao = typeof a.order === "number" ? a.order : null;
        const bo = typeof b.order === "number" ? b.order : null;
        if (ao !== null && bo !== null && ao !== bo) return ao - bo;
        if (ao !== null && bo === null) return -1;
        if (ao === null && bo !== null) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [workspaces]);

  const [localWorkspaces, setLocalWorkspaces] = useState<WorkspaceDoc[]>(baseSortedWorkspaces);
  const [activeDrag, setActiveDrag] = useState<ActiveDragState>(null);
  const [touchDragging, setTouchDragging] = useState(false);

  useEffect(() => {
    if (activeDrag) return;
    // Avoid infinite loops when the hook returns a new array reference on each render.
    // Only sync when the content (ids + order) actually changed.
    const sig = (arr: WorkspaceDoc[]) =>
      arr
        .map((w) => `${w.id ?? ""}:${typeof w.order === "number" ? w.order : ""}`)
        .join("|");

    setLocalWorkspaces((prev) => {
      if (sig(prev) === sig(baseSortedWorkspaces)) return prev;
      return baseSortedWorkspaces;
    });
  }, [baseSortedWorkspaces, activeDrag]);

  useEffect(() => {
    if (!touchDragging) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [touchDragging]);

  const touchActivationConstraint = useMemo(() => ({ delay: 350, tolerance: 10 }), []);
  const pointerActivationConstraint = useMemo(() => ({ distance: 6 }), []);
  const touchSensorOptions = useMemo(
    () => ({ activationConstraint: touchActivationConstraint }),
    [touchActivationConstraint],
  );
  const pointerSensorOptions = useMemo(
    () => ({ activationConstraint: pointerActivationConstraint }),
    [pointerActivationConstraint],
  );

  const sensors = useSensors(
    useSensor(TouchSensor, touchSensorOptions),
    useSensor(PointerSensor, pointerSensorOptions),
  );

  const computeNextOrderValue = (list: WorkspaceDoc[], index: number) => {
    const prev = list[index - 1];
    const next = list[index + 1];

    const prevOrder = typeof prev?.order === "number" ? prev.order : null;
    const nextOrder = typeof next?.order === "number" ? next.order : null;

    if (prevOrder !== null && nextOrder !== null) {
      if (prevOrder === nextOrder) return prevOrder + 1;
      return prevOrder + (nextOrder - prevOrder) / 2;
    }
    if (prevOrder !== null && nextOrder === null) return prevOrder + 1;
    if (prevOrder === null && nextOrder !== null) return nextOrder - 1;
    return index;
  };

  const onDragStart = (event: DragStartEvent) => {
    const id = event.active.id;
    if (typeof id !== "string") return;

    setActiveDrag({ kind: "workspace", id });

    const pe = event.activatorEvent as PointerEvent | undefined;
    setTouchDragging(pe?.pointerType === "touch");
  };

  const onDragCancel = (_event: DragCancelEvent) => {
    setActiveDrag(null);
    setTouchDragging(false);
    setLocalWorkspaces(baseSortedWorkspaces);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const activeId = event.active.id;
    const overId = event.over?.id;

    setActiveDrag(null);
    setTouchDragging(false);

    if (typeof activeId !== "string" || typeof overId !== "string") return;

    // Workspace reorder
    if (activeId === overId) return;

    const oldIndex = localWorkspaces.findIndex((w) => w.id === activeId);
    const newIndex = localWorkspaces.findIndex((w) => w.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextList = arrayMove(localWorkspaces, oldIndex, newIndex);
    setLocalWorkspaces(nextList);

    const moved = nextList.find((w) => w.id === activeId);
    if (!moved?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== moved.ownerId) return;

    const nextOrder = computeNextOrderValue(nextList, newIndex);
    if (typeof moved.order === "number" && moved.order === nextOrder) return;

    try {
      await updateDoc(doc(db, "workspaces", moved.id), {
        order: nextOrder,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Error reordering workspace", e);
      setLocalWorkspaces(baseSortedWorkspaces);
    }
  };

  const currentWorkspaceName = (() => {
    if (!workspaceId) return null;
    return workspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId;
  })();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    // Close the drawer on navigation to avoid stale overlay states.
    setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, workspaceId]);

  useEffect(() => {
    if (!mobileOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;

    // Prevent background scroll (iOS-friendly approach).
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "true" || raw === "false") {
        setCollapsed(raw === "true");
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const closeMobile = () => setMobileOpen(false);

  const sidebarWidthClass = collapsed ? "w-16" : "w-64";

  return (
    <div className="min-h-screen flex bg-background text-foreground overflow-x-hidden">
      {/* Desktop sidebar */}
      <aside className={`hidden md:flex ${sidebarWidthClass} border-r border-border`}>
        <div className="w-full flex flex-col">
          <div className={collapsed ? "p-3 flex flex-col items-center gap-2" : "p-3 flex items-center justify-between gap-2"}>
            <div className={collapsed ? "flex flex-col items-center gap-2" : "min-w-0 flex items-center gap-2"}>
              <img
                src="/favicon.svg"
                alt="Smart Notes"
                className="h-8 w-8 rounded-md border border-border bg-background"
              />
              {!collapsed && <div className="text-sm font-semibold truncate">Smart Notes</div>}
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent"
              aria-label={collapsed ? "Agrandir la sidebar" : "Réduire la sidebar"}
              title={collapsed ? "Agrandir" : "Réduire"}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="px-3 pb-3 overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragCancel={onDragCancel}
              onDragEnd={onDragEnd}
            >
              <SidebarWorkspaces
                collapsed={collapsed}
                onRequestExpand={collapsed ? () => setCollapsed(false) : undefined}
                workspaces={localWorkspaces}
                loading={workspacesLoading}
                error={workspacesError}
              />
            </DndContext>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="sn-drawer-backdrop absolute inset-0 bg-black/40"
            aria-label="Fermer le menu"
            onClick={closeMobile}
          />
          <div
            className="sn-drawer-panel absolute left-0 top-0 h-full w-72 bg-background border-r border-border"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div className="p-3 flex items-center justify-between border-b border-border">
              <div className="text-sm font-medium">Menu</div>
              <button
                type="button"
                onClick={closeMobile}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 overflow-y-auto h-[calc(100%-52px)]">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={onDragStart}
                onDragCancel={onDragCancel}
                onDragEnd={onDragEnd}
              >
                <SidebarWorkspaces
                  collapsed={false}
                  onNavigate={closeMobile}
                  workspaces={localWorkspaces}
                  loading={workspacesLoading}
                  error={workspacesError}
                />
              </DndContext>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <div className="md:hidden border-b border-border p-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background hover:bg-accent"
            aria-label="Ouvrir le menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <img
              src="/favicon.svg"
              alt="Smart Notes"
              className="h-7 w-7 rounded-md border border-border bg-background"
            />
            <div className="text-sm font-medium truncate">Smart Notes</div>
          </div>
          {currentWorkspaceName && (
            <div className="ml-auto text-xs text-muted-foreground truncate max-w-[45%]">
              📁 {currentWorkspaceName}
            </div>
          )}
        </div>

        <main className="flex-1 p-4 min-w-0">
          <PwaInstallCta />
          {currentWorkspaceName && (
            <div className="mb-4 text-sm text-muted-foreground truncate">📁 {currentWorkspaceName}</div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
