export const FEATURE_FLAGS = {
  agendaGridEnabled: process.env.NEXT_PUBLIC_AGENDA_ENABLE_GRID === "1",
} as const;
