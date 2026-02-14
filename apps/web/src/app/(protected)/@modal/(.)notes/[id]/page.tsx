"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Timestamp, deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { auth, db, storage } from "@/lib/firebase";
import { exportNotePdf } from "@/lib/pdf/exportPdf";
import { invalidateAuthSession, isAuthInvalidError } from "@/lib/authInvalidation";
import { sanitizeNoteHtml } from "@/lib/richText";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserWorkspaces } from "@/hooks/useUserWorkspaces";
import type { NoteAttachment, NoteDoc } from "@/types/firestore";
import AssistantNotePanel from "@/app/(protected)/_components/AssistantNotePanel";
import DictationMicButton from "@/app/(protected)/_components/DictationMicButton";
import { insertTextAtSelection, prepareDictationTextForInsertion } from "@/lib/textInsert";
import Modal from "../../../Modal";
import ItemActionsMenu from "../../../ItemActionsMenu";
import RichTextEditor from "../../../_components/RichTextEditor";

const FREE_MAX_FILES_PER_NOTE = 5;
const PRO_MAX_FILES_PER_NOTE = 10;
const FREE_MAX_BYTES = 20 * 1024 * 1024;
const PRO_MAX_BYTES = 350 * 1024 * 1024;

const FREE_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const PRO_ALLOWED_MIME = new Set([
  ...Array.from(FREE_ALLOWED_MIME),
  "video/mp4",
  "video/quicktime",
]);

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go"];
  let n = size;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const v = i === 0 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${v} ${units[i]}`;
}

function iconForMime(mime: string) {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("video/")) return "🎬";
  return "📎";
}

function safeId() {
  const cryptoAny = globalThis as any;
  if (typeof cryptoAny?.crypto?.randomUUID === "function") return cryptoAny.crypto.randomUUID();
  if (typeof cryptoAny?.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoAny.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b: number) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeFilename(raw: string) {
  const name = String(raw ?? "fichier");
  const lastDot = name.lastIndexOf(".");
  const ext = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : "";
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const cleanedBase = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const shortBase = (cleanedBase || "fichier").slice(0, 60);
  if (!ext) return shortBase;
  return `${shortBase}.${ext}`;
}

function normalizeStoragePath(path: string) {
  return String(path ?? "").replace(/^\/+/, "");
}

function formatFrDateTime(ts?: NoteDoc["updatedAt"] | NoteDoc["createdAt"] | null) {
  if (!ts) return "—";
  if (typeof (ts as any)?.toDate !== "function") return "—";
  const d = (ts as any).toDate() as Date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const editNoteSchema = z.object({
  title: z.string().min(1, "Le titre est requis."),
  content: z.string().optional(),
  workspaceId: z.string().optional(),
});

export default function NoteDetailModal(props: any) {
  const router = useRouter();
  const noteId: string | undefined = props?.params?.id;
  const fallbackHref: string | undefined = typeof props?.fallbackHref === "string" ? props.fallbackHref : undefined;
  const fullscreen: boolean = props?.fullscreen === true;

  const { data: workspaces } = useUserWorkspaces();
  const { data: userSettings } = useUserSettings();

  const [note, setNote] = useState<NoteDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editWorkspaceId, setEditWorkspaceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [, setDeleting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [busyAttachmentId, setBusyAttachmentId] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [dictationStatus, setDictationStatus] = useState<"idle" | "listening" | "stopped" | "error">("idle");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [assistantDrawerOpen, setAssistantDrawerOpen] = useState(false);

  const [, setIsDirty] = useState(false);

  const handleRichTextLinkClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const a = target.closest("a") as HTMLAnchorElement | null;
    if (!a) return;

    const href = a.getAttribute("href");
    if (!href) return;

    e.preventDefault();
    e.stopPropagation();
    window.open(href, "_blank", "noopener,noreferrer");
  };
  const isDirtyRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string>("");

  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);

  const setDirty = (next: boolean) => {
    isDirtyRef.current = next;
    setIsDirty(next);
  };

  const attachments = note?.attachments ?? [];
  const userPlan = userSettings?.plan === "pro" ? "pro" : "free";
  const maxFiles = userPlan === "pro" ? PRO_MAX_FILES_PER_NOTE : FREE_MAX_FILES_PER_NOTE;
  const maxBytes = userPlan === "pro" ? PRO_MAX_BYTES : FREE_MAX_BYTES;
  const allowedMime = userPlan === "pro" ? PRO_ALLOWED_MIME : FREE_ALLOWED_MIME;

  const validateFileForPlan = (file: File) => {
    if (attachments.length >= maxFiles) {
      return `Limite atteinte: ${maxFiles} fichiers max par note.`;
    }
    if (!allowedMime.has(file.type)) {
      if (file.type.startsWith("video/") && userPlan === "free") {
        return "Passe à Pro pour importer des vidéos et des fichiers jusqu’à 350 Mo.";
      }
      return "Type de fichier non autorisé.";
    }
    if (file.size > maxBytes) {
      if (userPlan === "free") {
        return "Fichier trop volumineux (max 20 Mo en Free). Passe à Pro pour importer jusqu’à 350 Mo.";
      }
      return `Fichier trop volumineux (max ${formatBytes(maxBytes)}).`;
    }
    return null;
  };

  const handlePickAttachment = () => {
    setAttachmentError(null);
    fileInputRef.current?.click();
  };

  const handleUploadAttachment = async (file: File) => {
    if (!note?.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setAttachmentError("Impossible d’ajouter un fichier à cette note.");
      return;
    }

    const msg = validateFileForPlan(file);
    if (msg) {
      setAttachmentError(msg);
      return;
    }

    setUploadingAttachment(true);
    setAttachmentError(null);

    try {
      const attachmentId = safeId();
      const safeName = sanitizeFilename(file.name ?? "fichier");
      const storagePath = normalizeStoragePath(
        `users/${user.uid}/notes/${note.id}/${attachmentId}-${safeName}`,
      );
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file, { contentType: file.type });

      const newAttachment: NoteAttachment = {
        id: attachmentId,
        name: safeName,
        mimeType: file.type,
        size: file.size,
        storagePath,
        addedAt: Timestamp.now(),
      };

      const next = [...attachments, newAttachment];
      await updateDoc(doc(db, "notes", note.id), {
        attachments: next,
        updatedAt: serverTimestamp(),
      });

      setNote((prev) => (prev ? { ...prev, attachments: next } : prev));
    } catch (e) {
      const err = e as any;
      const code = typeof err?.code === "string" ? err.code : undefined;
      const message = typeof err?.message === "string" ? err.message : undefined;
      const serverResponse =
        typeof err?.serverResponse === "string"
          ? err.serverResponse
          : typeof err?.customData?.serverResponse === "string"
            ? err.customData.serverResponse
            : undefined;

      let serverResponseSummary: string | undefined;
      if (serverResponse) {
        try {
          const parsed = JSON.parse(serverResponse);
          serverResponseSummary =
            typeof parsed?.error?.message === "string"
              ? parsed.error.message
              : typeof parsed?.error === "string"
                ? parsed.error
                : serverResponse.slice(0, 200);
        } catch {
          serverResponseSummary = serverResponse.slice(0, 200);
        }
      }

      console.error("Error uploading attachment", {
        code,
        message,
        serverResponse,
        customData: err?.customData,
        name: err?.name,
      });

      if (code === "storage/unauthorized") {
        setAttachmentError(
          "Import refusé. Vérifie que ton plan et ton fichier respectent les limites (Free: 20 Mo, Pro: 350 Mo).",
        );
        return;
      }

      const uiMsg = [
        code ? `[${code}]` : null,
        message ?? null,
        serverResponseSummary ? `serverResponse: ${serverResponseSummary}` : null,
      ]
        .filter(Boolean)
        .join(" ");

      setAttachmentError(uiMsg || "Erreur lors de l’ajout du fichier.");
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadAttachment = async (att: NoteAttachment) => {
    setAttachmentError(null);
    setBusyAttachmentId(att.id);
    try {
      const url = await getDownloadURL(ref(storage, normalizeStoragePath(att.storagePath)));

      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Téléchargement impossible (${res.status})`);
        }

        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = att.name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        console.warn("Attachment download via fetch failed; falling back to opening in a new tab", e);

        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      console.error("Error downloading attachment", e);
      setAttachmentError(e instanceof Error ? e.message : "Erreur lors du téléchargement.");
    } finally {
      setBusyAttachmentId(null);
    }
  };

  const handleDeleteAttachment = async (att: NoteAttachment) => {
    if (!note?.id) return;
    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setAttachmentError("Impossible de supprimer ce fichier.");
      return;
    }

    if (!confirm("Supprimer ce fichier joint ?")) return;

    setUploadingAttachment(true);
    setBusyAttachmentId(att.id);
    setAttachmentError(null);
    try {
      try {
        await deleteObject(ref(storage, normalizeStoragePath(att.storagePath)));
      } catch (e) {
        const err = e as any;
        if (typeof err?.code === "string" && err.code === "storage/object-not-found") {
          // continue
        } else {
          throw e;
        }
      }
      const next = attachments.filter((a) => a.id !== att.id);
      await updateDoc(doc(db, "notes", note.id), {
        attachments: next,
        updatedAt: serverTimestamp(),
      });
      setNote((prev) => (prev ? { ...prev, attachments: next } : prev));
    } catch (e) {
      console.error("Error deleting attachment", e);
      setAttachmentError(e instanceof Error ? e.message : "Erreur lors de la suppression du fichier.");
    } finally {
      setUploadingAttachment(false);
      setBusyAttachmentId(null);
    }
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  };

  const scheduleLongPressToEdit = (e: React.TouchEvent) => {
    if (mode !== "view") return;
    if (!note) return;
    const t = e.touches[0];
    if (!t) return;

    longPressFiredRef.current = false;
    longPressStartRef.current = { x: t.clientX, y: t.clientY };

    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      startEdit();
      clearLongPress();
    }, 550);
  };

  const cancelLongPressIfMoved = (e: React.TouchEvent) => {
    const start = longPressStartRef.current;
    const t = e.touches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearLongPress();
    }
  };

  const endLongPress = (e: React.TouchEvent) => {
    if (longPressFiredRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
    clearLongPress();
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!noteId) {
        setError("ID de note manquant.");
        setLoading(false);
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        setError("Tu dois être connecté.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const snap = await getDoc(doc(db, "notes", noteId));
        if (!snap.exists()) {
          throw new Error("Note introuvable.");
        }

        const data = snap.data() as NoteDoc;
        if (data.userId !== user.uid) {
          throw new Error("Accès refusé.");
        }

        if (!cancelled) {
          setNote({ id: snap.id, ...(data as any) });
          setMode("view");
        }
      } catch (e) {
        if (isAuthInvalidError(e)) {
          void invalidateAuthSession();
          return;
        }
        const msg = e instanceof Error ? e.message : "Erreur lors du chargement.";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const handleExportPdf = async () => {
    if (!note?.id) return;

    setEditError(null);
    setExportFeedback(null);

    try {
      const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? null;
      await exportNotePdf(note, workspaceName);
      setExportFeedback("PDF téléchargé.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’export PDF.");
    }
  };

  const handleExport = async () => {
    if (!note?.id) return;

    setEditError(null);
    setExportFeedback(null);

    const sanitize = (raw: string) => {
      const base = raw
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      return base || "sans-titre";
    };

    const workspaceName = workspaces.find((ws) => ws.id === note.workspaceId)?.name ?? null;

    const lines: string[] = [];
    lines.push(`# ${note.title ?? ""}`);
    if (workspaceName) lines.push(`Workspace: ${workspaceName}`);
    if (note.updatedAt) lines.push(`Dernière mise à jour: ${formatFrDateTime(note.updatedAt)}`);
    lines.push("");
    lines.push(note.content ?? "");

    const md = `${lines.join("\n")}\n`;
    const filename = `smartnotes-note-${sanitize(note.title ?? "")}.md`;

    try {
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setExportFeedback("Export téléchargé.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’export.");
    }
  };

  const handleShare = async () => {
    if (!note?.id) return;

    setEditError(null);
    setShareFeedback(null);

    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://app.tachesnotes.com";
    const url = `${origin}/notes/${encodeURIComponent(note.id)}`;

    try {
      if (typeof navigator !== "undefined" && typeof (navigator as any).share === "function") {
        await (navigator as any).share({ title: note.title ?? "Note", url });
        setShareFeedback("Partage ouvert.");
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareFeedback("Lien copié.");
        return;
      }

      throw new Error("Partage non supporté sur cet appareil.");
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erreur lors du partage.");
    }
  };

  useEffect(() => {
    if (!note) return;
    setEditTitle(note.title ?? "");
    setEditContent(note.content ?? "");
    setEditWorkspaceId(typeof note.workspaceId === "string" ? note.workspaceId : "");
    setEditError(null);
    setShareFeedback(null);
    setExportFeedback(null);

    lastSavedSnapshotRef.current = JSON.stringify({
      title: note.title ?? "",
      content: note.content ?? "",
      workspaceId: typeof note.workspaceId === "string" ? note.workspaceId : "",
    });
    setDirty(false);
  }, [note]);

  const createdLabel = useMemo(() => formatFrDateTime(note?.createdAt ?? null), [note?.createdAt]);
  const updatedLabel = useMemo(() => formatFrDateTime(note?.updatedAt ?? null), [note?.updatedAt]);

  const handleOpenFullscreen = () => {
    if (!note?.id) return;

    const params = new URLSearchParams();
    try {
      const url = new URL(window.location.href);
      url.searchParams.forEach((v, k) => {
        if (k === "noteId" || k === "fullscreen") return;
        params.set(k, v);
      });
    } catch {
      // ignore
    }

    params.set("noteId", note.id);
    if (fullscreen) params.delete("fullscreen");
    else params.set("fullscreen", "1");

    const qs = params.toString();
    router.push(qs ? `/notes?${qs}` : "/notes");
  };

  const startEdit = () => {
    if (!note) return;
    setMode("edit");
    setEditError(null);
    setDirty(false);
  };

  const cancelEdit = () => {
    if (!note) return;
    setMode("view");
    setEditTitle(note.title ?? "");
    setEditContent(note.content ?? "");
    setEditWorkspaceId(typeof note.workspaceId === "string" ? note.workspaceId : "");
    setEditError(null);
    setDirty(false);
  };

  const saveEdits = async (opts?: { setView?: boolean }): Promise<boolean> => {
    if (!note?.id) return false;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setEditError("Impossible de modifier cette note.");
      console.warn("[note modal] saveEdits blocked: unauth or not owner", {
        hasUser: Boolean(user),
        userId: user?.uid,
        noteUserId: note.userId,
        noteId: note.id,
      });
      return false;
    }

    const validation = editNoteSchema.safeParse({
      title: editTitle,
      content: editContent,
      workspaceId: editWorkspaceId || undefined,
    });

    if (!validation.success) {
      setEditError(validation.error.issues[0]?.message ?? "Données invalides.");
      console.warn("[note modal] saveEdits blocked: validation failed", {
        issues: validation.error.issues,
        noteId: note.id,
      });
      return false;
    }

    const nextSnapshot = JSON.stringify({
      title: validation.data.title,
      content: validation.data.content ?? "",
      workspaceId: validation.data.workspaceId ?? "",
    });

    if (lastSavedSnapshotRef.current === nextSnapshot) {
      console.info("[note modal] saveEdits noop: snapshot unchanged", { noteId: note.id });
      if (opts?.setView) setMode("view");
      setDirty(false);
      return true;
    }

    setSaving(true);
    setEditError(null);
    console.info("[note modal] saveEdits start", {
      noteId: note.id,
      workspaceId: validation.data.workspaceId,
    });

    try {
      await updateDoc(doc(db, "notes", note.id), {
        title: validation.data.title,
        content: sanitizeNoteHtml(validation.data.content ?? ""),
        workspaceId: validation.data.workspaceId ?? null,
        updatedAt: serverTimestamp(),
      });

      console.info("[note modal] saveEdits success", { noteId: note.id });

      lastSavedSnapshotRef.current = nextSnapshot;
      setDirty(false);

      setNote((prev) =>
        prev
          ? {
              ...prev,
              title: validation.data.title,
              content: validation.data.content ?? "",
              workspaceId: validation.data.workspaceId ?? null,
            }
          : prev,
      );
      if (opts?.setView) setMode("view");
      return true;
    } catch (e) {
      console.error("Error updating note (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la modification de la note.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const ok = await saveEdits({ setView: true });
    if (!ok) {
      console.warn("[note modal] handleSave: save failed (staying in edit mode)", { noteId: note?.id });
    }
  };

  const handleAssistantNoteContentUpdated = (nextContent: string) => {
    if (!note) return;

    setNote((prev) =>
      prev
        ? {
            ...prev,
            content: nextContent,
          }
        : prev,
    );

    setEditContent(nextContent);
    lastSavedSnapshotRef.current = JSON.stringify({
      title: note.title ?? "",
      content: nextContent,
      workspaceId: typeof note.workspaceId === "string" ? note.workspaceId : "",
    });
    setDirty(false);
  };

  useEffect(() => {
    if (mode !== "edit") return;

    const flush = () => {
      if (!isDirtyRef.current) return;
      void saveEdits({ setView: false });
    };

    const warnIfDirty = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", flush);
    window.addEventListener("beforeunload", warnIfDirty);
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("beforeunload", warnIfDirty);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleToggleArchive = async () => {
    if (!note?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setEditError("Impossible d’archiver cette note.");
      return;
    }

    setSaving(true);
    setEditError(null);
    try {
      const nextArchived = !(note.archived === true);
      await updateDoc(doc(db, "notes", note.id), {
        archived: nextArchived,
        archivedAt: nextArchived ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      router.back();
    } catch (e) {
      console.error("Error archiving note (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de l’archivage de la note.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!note?.id) return;

    const user = auth.currentUser;
    if (!user || user.uid !== note.userId) {
      setEditError("Impossible de supprimer cette note.");
      return;
    }

    if (!confirm("Supprimer cette note ?")) return;

    setDeleting(true);
    setEditError(null);

    try {
      await deleteDoc(doc(db, "notes", note.id));
      router.back();
    } catch (e) {
      console.error("Error deleting note (modal)", e);
      setEditError(e instanceof Error ? e.message : "Erreur lors de la suppression de la note.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      title={note?.title ?? "Note"}
      hideHeader
      fallbackHref={fallbackHref}
      fullscreen={fullscreen}
      onBeforeClose={async () => {
        if (!isDirtyRef.current) return true;
        return await saveEdits({ setView: false });
      }}
    >
      {({ close }: { close: () => void }) => {
        if (loading) {
          return (
            <div className="sn-skeleton-card space-y-3">
              <div className="sn-skeleton-title w-56" />
              <div className="sn-skeleton-line w-72" />
              <div className="sn-skeleton-line w-64" />
              <div className="sn-skeleton-block-lg w-full" />
            </div>
          );
        }

        if (error) {
          return <div className="sn-alert sn-alert--error">{error}</div>;
        }

        if (!note) return null;

        return (
          <>
            <div className="max-h-[90svh] md:max-h-[90vh] overflow-y-auto">
              <div className="space-y-4">
              {shareFeedback && <div className="sn-alert">{shareFeedback}</div>}
              {exportFeedback && <div className="sn-alert">{exportFeedback}</div>}
              {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
              {attachmentError && <div className="sn-alert sn-alert--error">{attachmentError}</div>}

              <div className="relative">
                <div className={assistantDrawerOpen ? "lg:pr-[34%]" : undefined}>
                  <div className="sn-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {mode === "view" ? (
                      <div className="text-sm font-semibold truncate">{note.title}</div>
                    ) : (
                      <div className="space-y-1">
                        <label className="sr-only" htmlFor="note-modal-title">
                          Titre
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="note-modal-title"
                            ref={titleInputRef}
                            value={editTitle}
                            onChange={(e) => {
                              const nextTitle = e.target.value;
                              setEditTitle(nextTitle);
                              const snap = JSON.stringify({
                                title: nextTitle,
                                content: editContent,
                                workspaceId: editWorkspaceId,
                              });
                              setDirty(snap !== lastSavedSnapshotRef.current);
                            }}
                            className="flex-1 w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                          />
                          <DictationMicButton
                            disabled={saving}
                            onFinalText={(rawText) => {
                              const el = titleInputRef.current;
                              const insert = prepareDictationTextForInsertion({
                                value: editTitle,
                                selectionStart: el?.selectionStart ?? null,
                                rawText,
                              });
                              if (!insert) return;
                              const { nextValue, nextCursor } = insertTextAtSelection({
                                value: editTitle,
                                selectionStart: el?.selectionStart ?? null,
                                selectionEnd: el?.selectionEnd ?? null,
                                text: insert,
                              });
                              setEditTitle(nextValue);
                              const snap = JSON.stringify({
                                title: nextValue,
                                content: editContent,
                                workspaceId: editWorkspaceId,
                              });
                              setDirty(snap !== lastSavedSnapshotRef.current);
                              window.requestAnimationFrame(() => {
                                try {
                                  el?.focus();
                                  el?.setSelectionRange(nextCursor, nextCursor);
                                } catch {
                                  // ignore
                                }
                              });
                            }}
                            onStatusChange={(st, err) => {
                              setDictationStatus(st);
                              setDictationError(err);
                            }}
                          />
                        </div>
                        {dictationStatus === "listening" ? (
                          <div className="text-xs text-muted-foreground">Écoute…</div>
                        ) : dictationError ? (
                          <div className="text-xs text-destructive">{dictationError}</div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {mode === "view" ? (
                      <ItemActionsMenu
                        onEdit={startEdit}
                        onToggleArchive={handleToggleArchive}
                        onShare={handleShare}
                        onExportPdf={handleExportPdf}
                        onExportMarkdown={handleExport}
                        onToggleFullscreen={handleOpenFullscreen}
                        fullscreen={fullscreen}
                        archived={note.archived === true}
                        onDelete={handleDelete}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={handleSave}
                          disabled={saving}
                          className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                        >
                          {saving ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => setAssistantDrawerOpen((v) => !v)}
                      className="px-3 py-2 rounded-md border border-input text-sm"
                    >
                      {assistantDrawerOpen ? "Fermer l’aide" : "Aide à la rédaction"}
                    </button>

                    <button
                      type="button"
                      onClick={close}
                      className="sn-icon-btn"
                      aria-label="Fermer"
                      title="Fermer"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {mode === "view" ? (
                  <div className="space-y-1">
                    <div
                      aria-label="Contenu de la note"
                      className="w-full min-h-[240px] px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm sn-richtext-content select-text"
                      onClick={handleRichTextLinkClick}
                      onDoubleClick={() => startEdit()}
                      onTouchStart={scheduleLongPressToEdit}
                      onTouchMove={cancelLongPressIfMoved}
                      onTouchEnd={endLongPress}
                      onTouchCancel={endLongPress}
                    >
                      <div dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note.content ?? "") }} />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <label className="text-sm font-medium" htmlFor="note-modal-workspace">
                        Dossier
                      </label>
                      <select
                        id="note-modal-workspace"
                        value={editWorkspaceId}
                        onChange={(e) => {
                          const nextWorkspaceId = e.target.value;
                          setEditWorkspaceId(nextWorkspaceId);
                          const snap = JSON.stringify({
                            title: editTitle,
                            content: editContent,
                            workspaceId: nextWorkspaceId,
                          });
                          setDirty(snap !== lastSavedSnapshotRef.current);
                        }}
                        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm"
                      >
                        <option value="">—</option>
                        {workspaces.map((ws) => (
                          <option key={ws.id ?? ws.name} value={ws.id ?? ""}>
                            {ws.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="sr-only" htmlFor="note-modal-content">
                        Contenu
                      </label>
                      <RichTextEditor
                        value={editContent}
                        onChange={(next) => {
                          setEditContent(next);
                          const snap = JSON.stringify({
                            title: editTitle,
                            content: next,
                            workspaceId: editWorkspaceId,
                          });
                          setDirty(snap !== lastSavedSnapshotRef.current);
                        }}
                        placeholder="Écris ici…"
                        minHeightClassName="min-h-[240px]"
                        enableDictation
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">📎 Fichiers joints</div>
                        <div className="flex items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            aria-label="Ajouter un fichier"
                            accept={userPlan === "pro" ? ".jpg,.jpeg,.png,.webp,.pdf,.mp4,.mov" : ".jpg,.jpeg,.png,.webp,.pdf"}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              void handleUploadAttachment(f);
                            }}
                          />
                          <button
                            type="button"
                            onClick={handlePickAttachment}
                            disabled={uploadingAttachment || saving}
                            className="px-3 py-2 rounded-md border border-input text-sm disabled:opacity-50"
                          >
                            {uploadingAttachment ? "Ajout…" : "Ajouter un fichier"}
                          </button>
                        </div>
                      </div>

                      {attachments.length === 0 ? (
                        <div className="text-sm text-muted-foreground">Aucun fichier joint.</div>
                      ) : (
                        <div className="space-y-2">
                          {attachments.map((att) => (
                            <div key={att.id} className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">
                                  {iconForMime(att.mimeType)} {att.name}
                                </div>
                                <div className="text-xs text-muted-foreground">{formatBytes(att.size)}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="px-3 py-2 rounded-md border border-input text-sm"
                                  onClick={() => void handleDownloadAttachment(att)}
                                >
                                  Télécharger
                                </button>
                                <button
                                  type="button"
                                  className="px-3 py-2 rounded-md border border-input text-sm"
                                  disabled={uploadingAttachment || busyAttachmentId === att.id}
                                  onClick={() => void handleDeleteAttachment(att)}
                                >
                                  {busyAttachmentId === att.id ? "Suppression…" : "Supprimer"}
                                </button>
                              </div>
                            </div>
                          ))}
                          <div className="text-xs text-muted-foreground">
                            {attachments.length}/{maxFiles} fichiers — max {formatBytes(maxBytes)} par fichier
                          </div>
                        </div>
                      )}
                    </div>

                    {editError && <div className="sn-alert sn-alert--error">{editError}</div>}
                  </>
                )}

                {mode === "view" && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">📎 Fichiers joints</div>
                    {attachments.length === 0 ? (
                      <div className="text-sm text-muted-foreground">Aucun fichier joint.</div>
                    ) : (
                      <div className="space-y-2">
                        {attachments.map((att) => (
                          <div key={att.id} className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">
                                {iconForMime(att.mimeType)} {att.name}
                              </div>
                              <div className="text-xs text-muted-foreground">{formatBytes(att.size)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="px-3 py-2 rounded-md border border-input text-sm"
                                onClick={() => void handleDownloadAttachment(att)}
                              >
                                Télécharger
                              </button>
                              <button
                                type="button"
                                className="px-3 py-2 rounded-md border border-input text-sm"
                                disabled={uploadingAttachment || busyAttachmentId === att.id}
                                onClick={() => void handleDeleteAttachment(att)}
                              >
                                {busyAttachmentId === att.id ? "Suppression…" : "Supprimer"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {mode === "view" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="font-medium">Créée le:</span> {createdLabel}
                    </div>
                    <div>
                      <span className="font-medium">Dernière mise à jour:</span> {updatedLabel}
                    </div>
                  </div>
                )}
              </div>
                </div>

                {assistantDrawerOpen ? (
                  <aside className="hidden lg:block absolute inset-y-0 right-0 w-[32%] min-w-[320px] max-w-[440px]">
                    <div className="relative h-full">
                      <button
                        type="button"
                        onClick={() => setAssistantDrawerOpen(false)}
                        className="absolute top-2 right-2 z-20 h-8 w-8 rounded-full border border-input bg-background text-sm leading-none"
                        aria-label="Fermer l’aide à la rédaction"
                        title="Fermer"
                      >
                        ×
                      </button>
                      <div className="h-full pt-12">
                        <AssistantNotePanel
                          noteId={note.id}
                          currentNoteContent={mode === "edit" ? editContent : note.content ?? ""}
                          onNoteContentUpdated={handleAssistantNoteContentUpdated}
                        />
                      </div>
                    </div>
                  </aside>
                ) : null}
              </div>
            </div>
            </div>

            {assistantDrawerOpen ? (
              <div className="lg:hidden fixed inset-0 z-[60] bg-background/85 backdrop-blur-sm p-2">
                <div className="relative h-full rounded-xl border border-border bg-card p-2">
                  <button
                    type="button"
                    onClick={() => setAssistantDrawerOpen(false)}
                    className="absolute top-2 right-2 z-20 h-8 w-8 rounded-full border border-input bg-background text-sm leading-none"
                    aria-label="Fermer l’aide à la rédaction"
                    title="Fermer"
                  >
                    ×
                  </button>
                  <div className="h-full pt-12">
                    <AssistantNotePanel
                      noteId={note.id}
                      currentNoteContent={mode === "edit" ? editContent : note.content ?? ""}
                      onNoteContentUpdated={handleAssistantNoteContentUpdated}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </>
        );
      }}
    </Modal>
  );
}
