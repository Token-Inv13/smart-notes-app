export type AssistantVoiceIntentKind = 'create_todo' | 'create_task' | 'create_reminder' | 'schedule_meeting';
export type AssistantVoiceMissingField = 'time';

export type AssistantVoiceIntent = {
  kind: AssistantVoiceIntentKind;
  title: string;
  confidence: number;
  requiresConfirmation: boolean;
  requiresConfirmationReason?: string;
  remindAt: Date | null;
  missingFields?: AssistantVoiceMissingField[];
  clarificationQuestion?: string;
};

export function stripVoiceCommandPrefix(input: string): string {
  return input
    .trim()
    .replace(/^(stp\s+|s'il te plait\s+|please\s+)/i, '')
    .replace(/^(ajoute|ajouter|crée|créer|cree|creer|planifie|program(me|mer)|rappelle\s*-?\s*moi\s+de|pense\s+à|note)\s+/i, '')
    .trim();
}

export function inferReminderTime(
  text: string,
  now: Date,
): {
  remindAt: Date | null;
  missingFields: AssistantVoiceMissingField[];
} {
  const lower = text.toLowerCase();
  const hasTomorrow = lower.includes('demain');
  const hasEvening = lower.includes('ce soir') || lower.includes('soir');
  const hasMorning = lower.includes('matin');
  const hasAfternoon = lower.includes('après-midi') || lower.includes('apres-midi');

  const timeMatch = /\b([01]?\d|2[0-3])(?:[:h]([0-5]\d)?)\b/.exec(lower);
  if (timeMatch) {
    const h = Number(timeMatch[1]);
    const m = Number(timeMatch[2] ?? 0);
    const d = new Date(now);
    d.setSeconds(0, 0);
    if (hasTomorrow) {
      d.setDate(d.getDate() + 1);
    }
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: d, missingFields: [] };
  }

  if (hasTomorrow && hasMorning) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return { remindAt: d, missingFields: [] };
  }

  if (hasTomorrow && hasAfternoon) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(14, 0, 0, 0);
    return { remindAt: d, missingFields: [] };
  }

  if (hasEvening) {
    const d = new Date(now);
    d.setHours(18, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: d, missingFields: [] };
  }

  if (hasTomorrow) {
    return { remindAt: null, missingFields: ['time'] };
  }

  if (hasMorning) {
    const d = new Date(now);
    d.setHours(9, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: d, missingFields: [] };
  }

  if (hasAfternoon) {
    const d = new Date(now);
    d.setHours(14, 0, 0, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    return { remindAt: d, missingFields: [] };
  }

  return { remindAt: null, missingFields: ['time'] };
}

export function parseAssistantVoiceIntent(transcript: string, now: Date): AssistantVoiceIntent {
  const raw = transcript.trim();
  const lower = raw.toLowerCase();
  const cleaned = stripVoiceCommandPrefix(raw);

  const meetingLike =
    lower.includes('réunion') ||
    lower.includes('reunion') ||
    lower.includes('meeting') ||
    lower.includes('rendez-vous') ||
    lower.includes('rdv') ||
    lower.includes('agenda') ||
    lower.includes('calendrier');

  if (meetingLike) {
    const inferred = inferReminderTime(raw, now);
    const missingFields = inferred.missingFields;
    return {
      kind: 'schedule_meeting',
      title: cleaned || 'Nouvelle réunion',
      confidence: 0.74,
      requiresConfirmation: true,
      requiresConfirmationReason: 'Confirme pour créer la réunion.',
      remindAt: inferred.remindAt,
      missingFields,
      clarificationQuestion: missingFields.length > 0 ? 'À quelle heure veux-tu planifier la réunion ?' : undefined,
    };
  }

  const reminderLike =
    lower.includes('rappel') ||
    lower.includes('rappelle') ||
    lower.includes('souviens') ||
    lower.includes("n'oublie") ||
    lower.includes('n oublie');

  if (reminderLike) {
    const inferred = inferReminderTime(raw, now);
    const missingFields = inferred.missingFields;
    return {
      kind: 'create_reminder',
      title: cleaned || 'Rappel',
      confidence: 0.81,
      requiresConfirmation: false,
      remindAt: inferred.remindAt,
      missingFields,
      clarificationQuestion: missingFields.length > 0 ? 'Je peux le faire. À quelle heure veux-tu ce rappel ?' : undefined,
    };
  }

  const todoLike =
    lower.includes('todo') ||
    lower.includes('to-do') ||
    lower.includes('checklist') ||
    lower.includes('à faire') ||
    lower.includes('a faire') ||
    lower.includes('liste');
  const taskLike =
    lower.includes('tâche') ||
    lower.includes('tache') ||
    lower.includes('task') ||
    lower.includes('projet') ||
    lower.includes('deadline') ||
    lower.includes('échéance') ||
    lower.includes('echeance');
  const textForRouting = (cleaned || raw).trim();
  const words = textForRouting.split(/\s+/).filter(Boolean);
  const shortActionLike = words.length > 0 && words.length <= 5;
  const projectLike = /\b(projet|client|livrable|sp[ée]cification|sp[ée]cifications|roadmap|plan|strat[ée]gie|r[ée]union|meeting)\b/i.test(lower);
  const hasScheduleSignal = /\b(avant|apr[èe]s|pour\s+demain|ce\s+soir|ce\s+matin|cette\s+semaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i.test(lower);
  const toDoPreferred = todoLike || (!taskLike && !projectLike && !hasScheduleSignal && shortActionLike);

  if (toDoPreferred) {
    return {
      kind: 'create_todo',
      title: cleaned || raw || 'Nouvelle todo',
      confidence: 0.84,
      requiresConfirmation: false,
      remindAt: null,
    };
  }

  return {
    kind: 'create_task',
    title: cleaned || raw || 'Nouvelle tâche',
    confidence: 0.86,
    requiresConfirmation: false,
    remindAt: null,
  };
}
