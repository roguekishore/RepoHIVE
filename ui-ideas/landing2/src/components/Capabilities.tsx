import FadingVideo from './FadingVideo';
import { ImageIcon, MovieIcon, LightbulbIcon } from './Icons';
import { ReactNode } from 'react';

const CAP_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260622_093722_ccfc7ebf-182f-419f-8a62-2dc02db7dd9d.mp4';

interface Capability {
  icon: ReactNode;
  title: string;
  tags: string[];
  body: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: <ImageIcon className="h-5 w-5 text-white" />,
    title: 'Design',
    tags: ['Brand Systems', 'Art Direction', 'Visual Identity', 'Motion'],
    body: 'We shape identities and interfaces that feel unmistakably yours — typographic systems, component libraries, and art-directed pages that scale without losing soul.',
  },
  {
    icon: <MovieIcon className="h-5 w-5 text-white" />,
    title: 'Engineering',
    tags: ['React', 'Next.js', 'Headless CMS', 'Edge-Ready'],
    body: 'Production-grade front-ends built on modern stacks. Performant, accessible, and instrumented — with code your team will enjoy extending long after launch.',
  },
  {
    icon: <LightbulbIcon className="h-5 w-5 text-white" />,
    title: 'Growth',
    tags: ['SEO', 'Analytics', 'A/B Testing', 'Retention'],
    body: 'Launch is the starting line. We partner with your team on conversion, content, and iteration loops that turn a beautiful site into a compounding asset.',
  },
];

export default function Capabilities() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-black">
      {/* Background video */}
      <FadingVideo
        src={CAP_VIDEO}
        className="absolute inset-0 z-0 h-full w-full object-cover"
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col px-8 pb-10 pt-24 md:px-16 lg:px-20">
        {/* Header */}
        <div className="mb-auto">
          <div className="mb-6 text-sm font-body text-white/80">// Capabilities</div>
          <h2 className="font-heading italic text-6xl md:text-7xl lg:text-[6rem] leading-[0.9] tracking-[-3px] whitespace-pre-line">
            {'Studio craft,\nend to end'}
          </h2>
        </div>

        {/* Cards grid */}
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="liquid-glass flex min-h-[360px] flex-col rounded-[1.25rem] p-6"
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-4">
                <div className="liquid-glass flex h-11 w-11 items-center justify-center rounded-[0.75rem]">
                  {cap.icon}
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {cap.tags.map((tag) => (
                    <span
                      key={tag}
                      className="liquid-glass whitespace-nowrap rounded-full px-3 py-1 text-[11px] text-white/90 font-body"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Bottom */}
              <div>
                <h3 className="font-heading italic text-3xl md:text-4xl tracking-[-1px] leading-none">
                  {cap.title}
                </h3>
                <p className="mt-3 max-w-[32ch] text-sm text-white/90 font-body font-light leading-snug">
                  {cap.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
