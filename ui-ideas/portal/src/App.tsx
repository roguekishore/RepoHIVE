import { useState } from 'react'
import {
  Search,
  User,
  Menu,
  X,
  Star,
  Clock,
  Calendar,
  Play,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_094145_4a271a6c-3869-4f1c-8aa7-aeb0cb227994.mp4'

const NAV_LINKS = [
  'Movies',
  'TV Series',
  "Editor's Pick",
  'Interviews',
  'User Reviews',
]

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative h-full w-full bg-black text-white overflow-hidden">
      {/* ---- Background video ---- */}
      <video
        className="fixed inset-0 h-full w-full object-cover"
        style={{ zIndex: 0 }}
        src={VIDEO_URL}
        autoPlay
        loop
        muted
        playsInline
      />

      {/* ---- Bottom blur overlay (no darkening) ---- */}
      <div
        className="bottom-blur-overlay fixed inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* ---- Page shell ---- */}
      <div className="relative flex h-full flex-col" style={{ zIndex: 10 }}>
        {/* ---- Navbar ---- */}
        <nav
          className="relative flex items-center justify-between px-4 sm:px-6 md:px-12 py-4 md:py-6"
          style={{ zIndex: 50 }}
        >
          {/* Logo */}
          <div
            className="animate-blur-fade-up flex h-8 md:h-10 items-center text-xl md:text-2xl font-bold tracking-[0.2em]"
            style={{ animationDelay: '0ms' }}
          >
            CINEMATIC
          </div>

          {/* Center nav links (lg and up) */}
          <div className="hidden lg:flex items-center gap-8">
            {NAV_LINKS.map((label, i) => (
              <a
                key={label}
                href="#"
                className="animate-blur-fade-up text-sm transition-colors hover:text-gray-300"
                style={{ animationDelay: `${100 + i * 50}ms` }}
              >
                {label}
              </a>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3">
            {/* Search pill (sm and up) */}
            <button
              className="liquid-glass animate-blur-fade-up hidden sm:flex items-center gap-2 rounded-full px-4 md:px-6 py-2 text-sm transition-colors hover:text-gray-300"
              style={{ animationDelay: '350ms' }}
            >
              <Search size={18} />
              <span>Search</span>
            </button>

            {/* Profile circle (sm and up) */}
            <button
              className="liquid-glass animate-blur-fade-up hidden sm:flex h-10 w-10 items-center justify-center rounded-full"
              style={{ animationDelay: '400ms' }}
              aria-label="User profile"
            >
              <User size={18} />
            </button>

            {/* Hamburger (below lg) */}
            <button
              className="liquid-glass animate-blur-fade-up relative flex h-10 w-10 items-center justify-center rounded-full lg:hidden"
              style={{ animationDelay: '350ms' }}
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <Menu
                size={18}
                className={`absolute transition-all duration-500 ease-out ${
                  menuOpen
                    ? 'rotate-180 scale-50 opacity-0'
                    : 'rotate-0 scale-100 opacity-100'
                }`}
              />
              <X
                size={18}
                className={`absolute transition-all duration-500 ease-out ${
                  menuOpen
                    ? 'rotate-0 scale-100 opacity-100'
                    : 'rotate-180 scale-50 opacity-0'
                }`}
              />
            </button>
          </div>
        </nav>

        {/* ---- Mobile menu (below lg) ---- */}
        <div
          className={`absolute left-0 right-0 top-[72px] mx-4 rounded-2xl border-t border-b border-gray-800 bg-gray-900/95 px-3 py-3 shadow-2xl backdrop-blur-lg transition-all duration-500 ease-out lg:hidden ${
            menuOpen
              ? 'translate-y-0 opacity-100'
              : '-translate-y-4 opacity-0 pointer-events-none'
          }`}
          style={{ zIndex: 40 }}
        >
          <div className="flex flex-col">
            {NAV_LINKS.map((label, i) => (
              <a
                key={label}
                href="#"
                className={`rounded-lg px-3 py-3 text-sm transition-all duration-500 ease-out hover:bg-gray-800/50 ${
                  menuOpen ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
                }`}
                style={{ transitionDelay: menuOpen ? `${i * 50}ms` : '0ms' }}
              >
                {label}
              </a>
            ))}
          </div>

          {/* Search + Profile (below sm) */}
          <div className="mt-3 flex items-center gap-3 border-t border-gray-800 pt-3 sm:hidden">
            <button className="liquid-glass flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm">
              <Search size={18} />
              <span>Search</span>
            </button>
            <button
              className="liquid-glass flex h-10 w-10 items-center justify-center rounded-full"
              aria-label="User profile"
            >
              <User size={18} />
            </button>
          </div>
        </div>

        {/* ---- Hero content ---- */}
        <div className="flex flex-1 flex-col justify-end px-4 sm:px-6 md:px-12 pb-8 md:pb-16">
          <div className="flex flex-col md:flex-row items-end gap-8">
            {/* Left */}
            <div className="flex-1">
              {/* Metadata */}
              <div
                className="animate-blur-fade-up mb-6 md:mb-8 flex flex-wrap items-center gap-3 sm:gap-6 text-xs sm:text-sm"
                style={{ animationDelay: '300ms' }}
              >
                <span className="flex items-center gap-2">
                  <Star size={16} className="fill-white sm:h-5 sm:w-5" />
                  <span className="font-medium">8.7/10 IMDB</span>
                </span>
                <span className="flex items-center gap-2">
                  <Clock size={16} />
                  <span>132 min</span>
                </span>
                <span className="flex items-center gap-2">
                  <Calendar size={16} />
                  <span>April, 2025</span>
                </span>
              </div>

              {/* Title */}
              <h1
                className="animate-blur-fade-up mb-4 md:mb-6 text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-normal"
                style={{ animationDelay: '400ms', letterSpacing: '-0.04em' }}
              >
                Step Through. Work Smarter.
              </h1>

              {/* Description */}
              <p
                className="animate-blur-fade-up mb-6 md:mb-12 max-w-2xl text-base sm:text-lg md:text-xl text-gray-400"
                style={{ animationDelay: '500ms' }}
              >
                A voyage through forgotten realms, where past and future
                intertwine.
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap gap-3 sm:gap-4">
                <button
                  className="animate-blur-fade-up flex items-center gap-2 rounded-full bg-white px-6 sm:px-8 py-2.5 sm:py-3 font-medium text-black transition-colors hover:bg-gray-200"
                  style={{ animationDelay: '600ms' }}
                >
                  <Play size={18} className="fill-black" />
                  <span>Watch Now</span>
                </button>
                <button
                  className="liquid-glass animate-blur-fade-up rounded-full px-6 sm:px-8 py-2.5 sm:py-3 font-medium"
                  style={{ animationDelay: '700ms' }}
                >
                  Learn More
                </button>
              </div>
            </div>

            {/* Right: navigation arrows */}
            <div className="flex w-full md:w-auto items-center justify-start md:justify-end gap-3">
              <button
                className="liquid-glass animate-blur-fade-up flex items-center gap-2 rounded-full px-4 sm:px-6 py-2.5 sm:py-3 font-medium"
                style={{ animationDelay: '800ms' }}
              >
                <ChevronLeft size={18} />
                <span>Previous</span>
              </button>
              <button
                className="liquid-glass animate-blur-fade-up flex items-center gap-2 rounded-full px-4 sm:px-6 py-2.5 sm:py-3 font-medium"
                style={{ animationDelay: '900ms' }}
              >
                <span>Next</span>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
