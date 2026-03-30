"use client";

import Link from "next/link";

export type OnboardingStep = 1 | 2 | 3 | 4;

type StepConfig = {
  title: string;
  description: string;
  cta: string;
  href: string;
};

type Props = {
  open: boolean;
  step: OnboardingStep;
  notesHref: string;
  tasksHref: string;
  planHref: string;
  onSkip: () => void;
  onContinue: () => void;
};

const STEP_CONFIG: Record<1 | 2 | 3, StepConfig> = {
  1: {
    title: "Commence par écrire ta première note",
    description: "Capture une idée, une tâche ou une demande en quelques secondes.",
    cta: "Créer une note",
    href: "/notes?create=1",
  },
  2: {
    title: "Transforme cette note en tâche",
    description: "Passe du texte à une action claire que tu pourras suivre facilement.",
    cta: "Créer une tâche",
    href: "/tasks?create=1",
  },
  3: {
    title: "Planifie-la pour aujourd’hui",
    description: "Ajoute-la dans l’agenda pour la faire apparaître dans ta journée.",
    cta: "Planifier aujourd’hui",
    href: "/tasks?create=1",
  },
};

function StepDot({ active, done }: { active?: boolean; done?: boolean }) {
  const base = "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold";
  const className = done
    ? `${base} border-primary bg-primary text-primary-foreground`
    : active
      ? `${base} border-primary/60 bg-primary/10 text-primary`
      : `${base} border-border bg-background text-muted-foreground`;
  return <span className={className} aria-hidden="true" />;
}

export default function OnboardingOverlay({ open, step, notesHref, tasksHref, planHref, onSkip, onContinue }: Props) {
  if (!open) return null;

  const config =
    step === 1
      ? { ...STEP_CONFIG[1], href: notesHref }
      : step === 2
        ? { ...STEP_CONFIG[2], href: tasksHref }
        : step === 3
          ? { ...STEP_CONFIG[3], href: planHref }
          : null;

  const completed = step === 4;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div className="absolute inset-0 bg-background/35 backdrop-blur-[1px]" aria-hidden="true" />
      <aside
        className="pointer-events-auto absolute bottom-4 left-4 right-4 max-w-[min(92vw,380px)] rounded-2xl border border-border bg-card/95 p-4 shadow-xl sm:left-auto sm:right-4 sm:bottom-4"
        role="dialog"
        aria-modal="false"
        aria-label="Onboarding de démarrage"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              Démarrage rapide
            </div>
            <div className="text-sm font-semibold">{completed ? "Tu viens d’organiser ta première journée" : `Étape ${step} sur 3`}</div>
          </div>
          <button type="button" onClick={onSkip} className="rounded-md border border-input px-2 py-1 text-xs hover:bg-accent" aria-label="Passer">
            Passer
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {([1, 2, 3] as const).map((itemStep) => {
            const isDone = completed || itemStep < step;
            const isActive = itemStep === step && !completed;
            const itemConfig = STEP_CONFIG[itemStep];
            return (
              <div key={itemStep} className={`flex gap-3 rounded-xl border p-3 ${isActive ? "border-primary/40 bg-primary/5" : "border-border bg-background/40"}`}>
                <StepDot active={isActive} done={isDone} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{itemConfig.title}</div>
                  <div className="text-xs text-muted-foreground">{itemConfig.description}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 space-y-3">
          {!completed && config ? (
            <Link
              href={config.href}
              className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {config.cta}
            </Link>
          ) : null}

          {completed ? (
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              Continuer
            </button>
          ) : (
            <div className="text-xs text-muted-foreground">
              Tu peux ignorer cette aide à tout moment. Les boutons restent accessibles derrière le panneau.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
