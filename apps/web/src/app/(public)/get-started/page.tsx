import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  Layers3,
  NotebookPen,
} from "lucide-react";
import { SITE_NAME, SITE_URL } from "@/lib/siteConfig";

const ctaHref = "/register?source=google_ads_lp";

const coreBenefits = [
  "Prends tes notes et tes tâches au même endroit, sans changer d'outil.",
  "Ajoute des rappels clairs pour arrêter d'oublier ce qui compte.",
  "Retrouve immédiatement ce qu'il faut faire aujourd'hui.",
];

const conversionPoints = [
  {
    title: "Mise en route rapide",
    description: "Crée ton compte et commence à capturer tes premières tâches en moins de 2 minutes.",
    icon: Clock3,
  },
  {
    title: "Un seul espace de travail",
    description: "Notes, tâches, rappels et dossiers restent regroupés au même endroit.",
    icon: Layers3,
  },
  {
    title: "Pensé pour l'action",
    description: "L'interface va droit au but pour t'aider à noter, prioriser et avancer.",
    icon: CheckCircle2,
  },
];

export const metadata: Metadata = {
  title: `Commencer avec ${SITE_NAME}`,
  description: "Page d'atterrissage dédiée à l'inscription TaskNote, conçue pour une conversion rapide.",
  alternates: {
    canonical: "/get-started",
  },
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: `Commencer avec ${SITE_NAME}`,
    description: "Lance-toi rapidement sur TaskNote et crée ton compte en quelques secondes.",
    url: `${SITE_URL}/get-started`,
    siteName: SITE_NAME,
    locale: "fr_FR",
    type: "website",
  },
};

function ProductPreview() {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/80 p-4 shadow-[0_30px_80px_rgba(15,23,42,0.45)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.22),_transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(34,197,94,0.16),_transparent_30%)]" />
      <div className="relative space-y-4">
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Aujourd'hui</p>
            <p className="mt-1 text-sm font-semibold text-white">Tableau de bord TaskNote</p>
          </div>
          <div className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100">
            3 priorités
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-white/10 bg-slate-900/85 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Tâches importantes
            </div>
            <div className="mt-4 space-y-3">
              {[
                { title: "Préparer la réunion client", meta: "10:00 • priorité haute" },
                { title: "Relancer le devis signé", meta: "14:30 • rappel activé" },
                { title: "Vérifier la campagne Google Ads", meta: "17:00 • à suivre" },
              ].map((task) => (
                <div key={task.title} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
                  <p className="text-sm font-medium text-white">{task.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{task.meta}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <NotebookPen className="h-4 w-4 text-cyan-300" />
                Note rapide
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Idées campagne Q2
                <br />
                - tester une landing sans navigation
                <br />
                - envoyer vers /register
                <br />
                - suivre le taux d'inscription
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-emerald-400/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <BellRing className="h-4 w-4 text-emerald-300" />
                Rappels actifs
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {["Réunion à 10:00", "Devis à 14:30", "Suivi campagne à 17:00"].map((reminder) => (
                  <span
                    key={reminder}
                    className="rounded-full border border-emerald-300/20 bg-slate-950/60 px-3 py-1 text-xs text-emerald-100"
                  >
                    {reminder}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function GetStartedPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#0f172a_0%,#111827_45%,#f8fafc_45%,#f8fafc_100%)] text-slate-950">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid w-full gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="max-w-xl text-white">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
              <Image src="/logo-icon.svg" alt="" width={16} height={16} className="h-4 w-4" />
              TaskNote
            </div>

            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Capture tes tâches et tes notes avant qu'elles ne se perdent.
            </h1>

            <p className="mt-5 text-lg leading-8 text-slate-300">
              Une page claire, un seul objectif: t'inscrire rapidement pour commencer à organiser tes priorités,
              tes rappels et tes notes dans TaskNote.
            </p>

            <div className="mt-8 space-y-3">
              {coreBenefits.map((benefit) => (
                <div key={benefit} className="flex items-start gap-3 text-sm text-slate-200">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-6 py-3 text-base font-semibold text-slate-950 no-underline shadow-[0_12px_30px_rgba(34,211,238,0.28)] transition hover:-translate-y-0.5 hover:bg-cyan-300 hover:no-underline"
              >
                Créer mon compte
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-sm text-slate-400">Accès immédiat. Pas de navigation parasite. Direction l'inscription.</p>
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="border-t border-slate-200/80 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">Pourquoi cette page convertit mieux</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Le message est court, le parcours est direct, l'action est évidente.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {conversionPoints.map(({ title, description, icon: Icon }) => (
              <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-cyan-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </article>
            ))}
          </div>

          <div className="mt-12 rounded-[28px] border border-slate-200 bg-slate-950 px-6 py-8 text-white shadow-[0_22px_55px_rgba(15,23,42,0.18)] sm:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <h3 className="text-2xl font-semibold tracking-tight">Lance le funnel Ads sur une page faite pour inscrire.</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Envoie ton trafic Google Ads ici, garde la landing actuelle pour le SEO et le branding, et pousse
                  chaque visiteur vers un seul résultat: l'ouverture d'un compte.
                </p>
              </div>

              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-semibold text-slate-950 no-underline transition hover:-translate-y-0.5 hover:bg-slate-100 hover:no-underline"
              >
                Aller à l'inscription
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
