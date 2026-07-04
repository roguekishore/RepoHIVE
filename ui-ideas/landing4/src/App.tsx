import {
  Sparkles,
  Download,
  Wand2,
  BookOpen,
  ArrowRight,
  Twitter,
  Linkedin,
  Instagram,
  Menu,
} from 'lucide-react';
import heroFlowers from '@/assets/hero-flowers.png';
import { VIDEO_SRC } from './content';

export default function App() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black">
      {/* ---------------------------------------------------------------
          Background video — full viewport, behind everything (z-0)
      ---------------------------------------------------------------- */}
      <video
        className="absolute inset-0 z-0 h-full w-full object-cover"
        src={VIDEO_SRC}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />

      {/* ---------------------------------------------------------------
          Content layer (z-10)
      ---------------------------------------------------------------- */}
      <div className="relative z-10 flex min-h-screen w-full flex-row">
        <LeftPanel />
        <RightPanel />
      </div>
    </div>
  );
}

/* =================================================================
   LEFT PANEL — 52%
================================================================= */
function LeftPanel() {
  return (
    <section className="relative flex w-full flex-col lg:w-[52%]">
      {/* Glass overlay sheet */}
      <div className="liquid-glass-strong absolute inset-4 rounded-3xl lg:inset-6" />

      <div className="relative flex flex-1 flex-col px-8 py-8 lg:px-12 lg:py-10">
        {/* Nav */}
        <nav className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Bloom logo" className="h-8 w-8" width={32} height={32} />
            <span className="text-2xl font-semibold tracking-tighter text-white">bloom</span>
          </div>

          <button
            type="button"
            className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/80 transition-transform hover:scale-105"
          >
            <Menu className="h-4 w-4" />
            <span>Menu</span>
          </button>
        </nav>

        {/* Hero center */}
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <img
            src="/logo.png"
            alt="Bloom emblem"
            className="mb-8 h-20 w-20"
            width={80}
            height={80}
          />

          <h1 className="text-6xl font-medium tracking-[-0.05em] text-white lg:text-7xl">
            Innovating the
            <br />
            <em className="font-serif italic text-white/80">spirit of bloom</em> AI
          </h1>

          <button
            type="button"
            className="liquid-glass-strong mt-10 flex items-center gap-3 rounded-full py-2 pl-2 pr-6 text-base font-medium text-white transition-transform hover:scale-105 active:scale-95"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
              <Download className="h-4 w-4" />
            </span>
            <span>Explore Now</span>
          </button>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {['Artistic Gallery', 'AI Generation', '3D Structures'].map((label) => (
              <span
                key={label}
                className="liquid-glass rounded-full px-4 py-2 text-xs text-white/80 transition-transform hover:scale-105"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom quote */}
        <div className="flex flex-col items-center text-center">
          <span className="text-xs uppercase tracking-widest text-white/50">Visionary Design</span>

          <p className="mt-3 text-2xl text-white lg:text-3xl">
            <span className="font-display">We imagined a realm with </span>
            <span className="font-serif italic text-white/80">no ending.</span>
          </p>

          <div className="mt-5 flex items-center gap-4">
            <span className="h-px w-12 bg-white/30" />
            <span className="text-xs uppercase tracking-widest text-white/60">Marcus Aurelio</span>
            <span className="h-px w-12 bg-white/30" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* =================================================================
   RIGHT PANEL — 48% (desktop only)
================================================================= */
function RightPanel() {
  return (
    <section className="relative hidden flex-col px-8 py-8 lg:flex lg:w-[48%] lg:px-12 lg:py-10">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="liquid-glass flex items-center gap-4 rounded-full px-5 py-2.5">
          <a
            href="#"
            aria-label="Twitter"
            className="text-white transition-colors hover:text-white/80"
          >
            <Twitter className="h-4 w-4" />
          </a>
          <a
            href="#"
            aria-label="LinkedIn"
            className="text-white transition-colors hover:text-white/80"
          >
            <Linkedin className="h-4 w-4" />
          </a>
          <a
            href="#"
            aria-label="Instagram"
            className="text-white transition-colors hover:text-white/80"
          >
            <Instagram className="h-4 w-4" />
          </a>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
            <ArrowRight className="h-4 w-4 text-white" />
          </span>
        </div>

        <button
          type="button"
          className="liquid-glass flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-white/80 transition-transform hover:scale-105"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <span>Account</span>
        </button>
      </div>

      {/* Community card */}
      <div className="liquid-glass mt-6 w-56 rounded-3xl p-5">
        <h3 className="text-base font-medium text-white">Enter our ecosystem</h3>
        <p className="mt-2 text-xs leading-relaxed text-white/60">
          Join a living community of designers shaping the future of botanical AI.
        </p>
      </div>

      {/* Bottom feature section */}
      <div className="liquid-glass mt-auto rounded-[2.5rem] p-5">
        <div className="grid grid-cols-2 gap-4">
          <FeatureCard
            icon={<Wand2 className="h-5 w-5 text-white" />}
            title="Processing"
            description="Real-time generative pipelines for organic form."
          />
          <FeatureCard
            icon={<BookOpen className="h-5 w-5 text-white" />}
            title="Growth Archive"
            description="A versioned library of every bloom you cultivate."
          />
        </div>

        {/* Bottom card */}
        <div className="liquid-glass mt-4 flex items-center gap-4 rounded-3xl p-4">
          <img
            src={heroFlowers}
            alt="Sculpted flowers"
            className="h-16 w-24 rounded-2xl object-cover"
            width={96}
            height={64}
          />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-white">Advanced Plant Sculpting</h4>
            <p className="mt-1 text-xs leading-relaxed text-white/60">
              Shape light, petals, and structure with precision controls.
            </p>
          </div>
          <button
            type="button"
            aria-label="Add"
            className="liquid-glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl font-light text-white transition-transform hover:scale-105"
          >
            +
          </button>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="liquid-glass rounded-3xl p-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
        {icon}
      </span>
      <h4 className="mt-4 text-sm font-medium text-white">{title}</h4>
      <p className="mt-1.5 text-xs leading-relaxed text-white/60">{description}</p>
    </div>
  );
}
