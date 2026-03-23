"use client";

export const TASK_MODAL_CREATE_TITLE = "Nouvel élément d’agenda";
export const TASK_MODAL_EDIT_TITLE = "Modifier l’élément d’agenda";
export const TASK_MODAL_DETAIL_TITLE = "Détail de l’élément d’agenda";

export const TASK_FIELD_TITLE_LABEL = "Titre";
export const TASK_FIELD_START_LABEL = "Date de début";
export const TASK_FIELD_DUE_LABEL = "Date de fin / échéance";
export const TASK_FIELD_WORKSPACE_LABEL = "Dossier";
export const TASK_FIELD_PRIORITY_LABEL = "Priorité";

export const TASK_EMPTY_WORKSPACE_LABEL = "Sans dossier";
export const TASK_EMPTY_PRIORITY_LABEL = "Sans priorité";

export const TASK_PRIORITY_OPTIONS = [
  { value: "low", label: "Basse" },
  { value: "medium", label: "Moyenne" },
  { value: "high", label: "Haute" },
] as const;
