import type { TaskDoc } from "@/types/firestore";

export function formatTaskRecurrenceLabel(recurrence: TaskDoc["recurrence"] | null | undefined) {
  if (!recurrence?.freq) return "Aucune";
  if (recurrence.freq === "daily") return "Chaque jour";
  if (recurrence.freq === "weekly") return "Chaque semaine";
  return "Chaque mois";
}
