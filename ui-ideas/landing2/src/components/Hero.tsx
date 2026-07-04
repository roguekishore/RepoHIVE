import { motion } from 'framer-motion';
import FadingVideo from './FadingVideo';
import BlurText from './BlurText';
import { ArrowUpRight, Play, ClockIcon, GlobeIcon } from './Icons';

const HERO_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4';

const NAV_LINKS = ['Work', 'Studio', 'Services', 'Journal', 'Contact'];
const LOGOS = ['Aeon', 'Vela', 'Apex', 'Orbit', 'Zeno'];

const reveal = {
  initial: { filter: 'blur(10px)', opacity: 0, y: 20 },
  animate: { filter: 'blur(0px)', opacity: 1, y: 0 },
};

export default function Hero() {
  return (
    <section className="relative h-screen overflow-hidden bg-black">
      {/* Background video */}
      <FadingVideo
        src={HERO_VIDEO}
        className="absolute left-1/2 top-0 z-0 -translate-x-1/2 object-cover object-top"
        style={{ width: '120%', height: '120%' }}
      />

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col">
        {/* Navbar */}
        <nav className="fixed left-0 right-0 top-4 z-50 flex items-center justify-between px-8 lg:px-16">
          {/* Left: logo */}
          <div className="liquid-glass flex h-12 w-12 items-center justify-center rounded-full">
            <span className="font-heading text-2xl italic">a</span>
          </div>

          {/* Center: nav pill */}
          <div className="liquid-glass hidden items-center gap-1 rounded-full px-1.5 py-1.5 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link}
                href="#"
                className="px-3 py-2 text-sm font-medium text-white/90 font-body"
              >
                {link}
              </a>
            ))}
            <button className="ml-1 flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm font-medium text-black font-body">
              Start a Project
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>

          {/* Right: spacer */}
          <div className="h-12 w-12" />
        </nav>

        {/* Main content */}
        <div className="flex flex-1 flex-col items-center justify-center px-4 pt-24 text-center">
          {/* Badge */}
          <motion.div
            variants={reveal}
            initial="initial"
            animate="animate"
            transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
            className="liquid-glass flex items-center gap-2 rounded-full px-3 py-1.5"
          >
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-black font-body">
              New
            </span>
            <span className="text-sm text-white/90 font-body font-light">
              Booking Q3 2026 engagements — limited capacity
            </span>
          </motion.div>

          {/* Headline */}
          <div className="mt-6 max-w-3xl">
            <BlurText
              text="Crafted Digital Experiences Built to Outlast Trends"
              className="text-6xl md:text-7xl lg:text-[5.5rem] font-heading italic text-white leading-[0.8] tracking-[-4px]"
            />
          </div>

          {/* Subtext */}
          <motion.p
            variants={reveal}
            initial="initial"
            animate="animate"
            transition={{ duration: 0.8, delay: 0.8, ease: 'easeOut' }}
            className="mt-4 max-w-2xl text-sm md:text-base text-white font-body font-light leading-tight"
          >
            We are a small studio of designers and engineers shaping
            brand-defining websites for ambitious companies. Precise typography,
            cinematic motion, and code you can be proud of.
          </motion.p>

          {/* CTA buttons */}
          <motion.div
            variants={reveal}
            initial="initial"
            animate="animate"
            transition={{ duration: 0.8, delay: 1.1, ease: 'easeOut' }}
            className="mt-6 flex items-center gap-6"
          >
            <button className="liquid-glass-strong flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white font-body">
              Start a Project
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <button className="flex items-center gap-2 text-sm font-medium text-white font-body">
              <Play className="h-4 w-4" />
              Watch Showreel
            </button>
          </motion.div>

          {/* Stats cards */}
          <motion.div
            variants={reveal}
            initial="initial"
            animate="animate"
            transition={{ duration: 0.8, delay: 1.3, ease: 'easeOut' }}
            className="mt-8 flex gap-4"
          >
            <div className="liquid-glass w-[220px] rounded-[1.25rem] p-5 text-left">
              <ClockIcon className="h-6 w-6 text-white" />
              <div className="mt-4 text-4xl font-heading italic tracking-[-1px] leading-none">
                6 Weeks
              </div>
              <div className="mt-2 text-xs text-white/80 font-body font-light">
                Average End-to-End Launch Time
              </div>
            </div>
            <div className="liquid-glass w-[220px] rounded-[1.25rem] p-5 text-left">
              <GlobeIcon className="h-6 w-6 text-white" />
              <div className="mt-4 text-4xl font-heading italic tracking-[-1px] leading-none">
                140+
              </div>
              <div className="mt-2 text-xs text-white/80 font-body font-light">
                Brands Shipped Across Four Continents
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom trust bar */}
        <motion.div
          variants={reveal}
          initial="initial"
          animate="animate"
          transition={{ duration: 0.8, delay: 1.4, ease: 'easeOut' }}
          className="flex flex-col items-center gap-4 pb-8"
        >
          <div className="liquid-glass rounded-full px-4 py-2 text-xs text-white/90 font-body font-light">
            Trusted by founders, operators, and creative directors worldwide
          </div>
          <div className="flex flex-wrap items-center justify-center gap-12 md:gap-16">
            {LOGOS.map((logo) => (
              <span
                key={logo}
                className="font-heading italic text-2xl md:text-3xl tracking-tight text-white"
              >
                {logo}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
