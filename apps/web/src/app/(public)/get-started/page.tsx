import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, Layers3 } from "lucide-react";
import { SITE_NAME, SITE_URL } from "@/lib/siteConfig";

const ctaHref = "/register?source=google_ads_lp";

const coreBenefits = [
  "Centralise tes notes, tes tâches et tes rappels dans une seule application.",
  "Retrouve rapidement les actions prioritaires sans te disperser entre plusieurs outils.",
  "Organise ton quotidien avec un espace simple pour capturer, planifier et avancer.",
];

const conversionPoints = [
  {
    title: "Notes, tâches et rappels",
    description: "TaskNote rassemble l'essentiel pour suivre tes idées, tes actions et tes échéances.",
    icon: Clock3,
  },
  {
    title: "Organisation simple",
    description: "Classe tes éléments dans un espace clair pour savoir quoi faire maintenant et ensuite.",
    icon: Layers3,
  },
  {
    title: "Productivité quotidienne",
    description: "Passe plus vite de la capture à l'exécution avec une interface pensée pour l'action.",
    icon: CheckCircle2,
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "Web",
  url: `${SITE_URL}/get-started`,
  description:
    "TaskNote est une application de notes, tâches et rappels pour organiser le quotidien et les priorités dans un seul espace.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "EUR",
  },
  featureList: [
    "Prise de notes",
    "Gestion des tâches",
    "Rappels",
    "Organisation des priorités",
  ],
};

export const metadata: Metadata = {
  title: `${SITE_NAME} | Notes, tâches et rappels dans une seule application`,
  description:
    "TaskNote aide à organiser notes, tâches et rappels dans une application simple pour mieux gérer le quotidien et les priorités.",
  keywords: [
    "TaskNote",
    "application de notes",
    "application de tâches",
    "rappels",
    "organisation personnelle",
    "productivité",
    "gestion des priorités",
  ],
  alternates: {
    canonical: "/get-started",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: `${SITE_NAME} | Notes, tâches et rappels dans une seule application`,
    description:
      "Découvre TaskNote pour centraliser notes, tâches et rappels dans un outil simple orienté organisation et productivité.",
    url: `${SITE_URL}/get-started`,
    siteName: SITE_NAME,
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Notes, tâches et rappels dans une seule application`,
    description:
      "Une application simple pour prendre des notes, gérer des tâches et suivre des rappels au même endroit.",
  },
};

function ProductPreview() {
  return (
    <figure className="relative overflow-hidden rounded-[34px] border border-white/15 bg-[radial-gradient(circle_at_top_left,rgba(186,230,253,0.42),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.18),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.98),rgba(238,245,255,0.96))] p-4 shadow-[0_38px_100px_rgba(15,23,42,0.34)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.42),transparent_36%,transparent_64%,rgba(255,255,255,0.22))]" />
      <div className="pointer-events-none absolute -left-14 bottom-6 h-44 w-44 rounded-full bg-cyan-200/40 blur-3xl" />
      <div className="pointer-events-none absolute right-2 top-2 h-56 w-56 rounded-full bg-blue-200/45 blur-3xl" />

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[26px]">
        <div className="absolute left-[4%] top-[4%] z-20 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600 backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-cyan-400" />
          Notes • Tâches • Rappels
        </div>

        <div className="absolute right-[5%] top-[6%] z-20 rounded-2xl border border-white/60 bg-white/72 px-4 py-2 text-xs text-slate-600 shadow-[0_18px_45px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="font-semibold text-slate-900">Vue claire</div>
          <div>Capture, priorités, rappels</div>
        </div>

        <div className="absolute inset-x-[14%] top-[10%] h-[80%] overflow-hidden rounded-[30px] border border-slate-200/80 bg-white shadow-[0_34px_85px_rgba(15,23,42,0.2)] ring-1 ring-white/60">
          <Image
            src="/assets/screens/notes-hero-crop.png"
            alt="Interface TaskNote avec notes récentes, dossiers et navigation"
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 48vw"
            className="object-cover"
          />
        </div>

        <div className="absolute -bottom-[1%] left-[1%] z-20 h-[49%] w-[45%] -rotate-[5deg] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_30px_75px_rgba(15,23,42,0.2)] ring-1 ring-white/70">
          <Image
            src="/assets/screens/capture.png"
            alt="Fenêtre TaskNote pour capturer rapidement une idée"
            fill
            sizes="(max-width: 1024px) 42vw, 18vw"
            className="object-cover object-[38%_14%]"
          />
        </div>

        <div className="absolute bottom-[2%] right-[1%] z-30 h-[64%] w-[28%] rotate-[4deg] overflow-hidden rounded-[30px] border border-slate-200/80 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.22)] ring-1 ring-white/70">
          <Image
            src="/assets/screens/hero.png"
            alt="Aperçu mobile de TaskNote"
            fill
            sizes="(max-width: 1024px) 24vw, 14vw"
            className="object-cover object-[96%_58%]"
          />
        </div>

        <div className="pointer-events-none absolute inset-x-[18%] bottom-[9%] h-20 rounded-full bg-slate-950/10 blur-2xl" />
      </div>
    </figure>
  );
}

export default function GetStartedPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#0f172a_0%,#111827_45%,#f8fafc_45%,#f8fafc_100%)] text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid w-full gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="max-w-xl text-white">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
              <Image src="/logo-icon.svg" alt="" width={16} height={16} className="h-4 w-4" />
              TaskNote
            </div>

            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              TaskNote, l'application simple pour gérer notes, tâches et rappels.
            </h1>

            <p className="mt-5 text-lg leading-8 text-slate-300">
              Capture tes idées, organise tes priorités et garde une vue claire sur ce que tu dois faire aujourd'hui
              et demain, dans un seul espace de travail.
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
                Commencer avec TaskNote
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-sm text-slate-400">Crée ton compte et commence à organiser tes notes et tes tâches.</p>
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="border-t border-slate-200/80 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">Pourquoi choisir TaskNote</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Une application pensée pour noter, planifier et suivre ce qui compte.
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
                <h3 className="text-2xl font-semibold tracking-tight">Commence à utiliser TaskNote pour mieux organiser tes journées.</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Si tu cherches une application de notes, de tâches et de rappels simple à prendre en main, TaskNote
                  te permet de capturer l'information rapidement et de la transformer en actions concrètes.
                </p>
              </div>

              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-semibold text-slate-950 no-underline transition hover:-translate-y-0.5 hover:bg-slate-100 hover:no-underline"
              >
                Créer mon compte
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
