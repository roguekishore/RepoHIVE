import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import WordsPullUpMultiStyle, { type StyledSegment } from './WordsPullUpMultiStyle'

const FEATURES_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_133058_0504132a-0cf3-4450-a370-8ea3b05c95d4.mp4'

const ICON_STORYBOARD =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171918_4a5edc79-d78f-4637-ac8b-53c43c220606.png&w=1280&q=85'
const ICON_CRITIQUES =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171741_ed9845ab-f5b2-4018-8ce7-07cc01823522.png&w=1280&q=85'
const ICON_CAPSULE =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171809_f56666dc-c099-4778-ad82-9ad4f209567b.png&w=1280&q=85'

const HEADER_SEGMENTS: StyledSegment[] = [
  {
    text: 'Studio-grade workflows for visionary creators.',
    className: 'text-primary',
  },
  { text: 'Built for pure vision. Powered by art.', className: 'text-gray-500' },
]

interface FeatureCardData {
  number: string
  title: string
  icon: string
  items: string[]
}

const CARDS: FeatureCardData[] = [
  {
    number: '01',
    title: 'Project Storyboard.',
    icon: ICON_STORYBOARD,
    items: [
      'Drag-and-drop scene sequencing',
      'Shared frame annotations',
      'Version history per board',
      'Export to PDF and reel',
    ],
  },
  {
    number: '02',
    title: 'Smart Critiques.',
    icon: ICON_CRITIQUES,
    items: [
      'AI analysis of pacing and tone',
      'Creative notes from collaborators',
      'Tool integrations for editing suites',
    ],
  },
  {
    number: '03',
    title: 'Immersion Capsule.',
    icon: ICON_CAPSULE,
    items: [
      'Notification silencing',
      'Ambient soundscapes',
      'Schedule syncing across teams',
    ],
  },
]

const cardEase = [0.22, 1, 0.36, 1] as const

interface AnimatedCardProps {
  index: number
  children: React.ReactNode
  className?: string
}

function AnimatedCard({ index, children, className = '' }: AnimatedCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={isInView ? { scale: 1, opacity: 1 } : { scale: 0.95, opacity: 0 }}
      transition={{ duration: 0.6, delay: index * 0.15, ease: cardEase }}
    >
      {children}
    </motion.div>
  )
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="text-primary mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="text-xs text-gray-400 sm:text-sm">{text}</span>
    </li>
  )
}

function LearnMore() {
  return (
    <a
      href="#"
      className="group mt-auto inline-flex items-center gap-2 text-xs text-primary sm:text-sm"
    >
      Learn more
      <ArrowRight className="h-4 w-4 -rotate-45 transition-transform group-hover:translate-x-0.5" />
    </a>
  )
}

function ContentCard({ card }: { card: FeatureCardData }) {
  return (
    <div className="flex h-full flex-col rounded-2xl bg-[#212121] p-5 md:p-6">
      <img
        src={card.icon}
        alt=""
        className="h-10 w-10 rounded-lg object-cover sm:h-12 sm:w-12"
      />
      <h3 className="mt-4 flex items-baseline gap-2 text-base font-medium text-[#E1E0CC] sm:text-lg">
        {card.title}
        <span className="text-xs text-gray-500">{card.number}</span>
      </h3>
      <ul className="mt-4 flex flex-col gap-3">
        {card.items.map((item) => (
          <ChecklistItem key={item} text={item} />
        ))}
      </ul>
      <div className="mt-6 flex">
        <LearnMore />
      </div>
    </div>
  )
}

export default function Features() {
  return (
    <section className="relative min-h-screen bg-black px-4 py-20 md:px-8 md:py-28">
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.15]" />

      <div className="relative mx-auto max-w-7xl">
        <div className="max-w-3xl text-xl font-normal sm:text-2xl md:text-3xl lg:text-4xl">
          <WordsPullUpMultiStyle segments={HEADER_SEGMENTS} className="!justify-start" />
        </div>

        <div className="mt-12 grid grid-cols-1 gap-3 sm:gap-2 md:grid-cols-2 md:gap-1 lg:h-[480px] lg:grid-cols-4">
          {/* Card 1 - video */}
          <AnimatedCard index={0} className="h-full">
            <div className="relative h-full min-h-[280px] overflow-hidden rounded-2xl">
              <video
                className="absolute inset-0 h-full w-full object-cover"
                src={FEATURES_VIDEO}
                autoPlay
                loop
                muted
                playsInline
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-0 left-0 p-5 md:p-6">
                <p className="text-base font-medium sm:text-lg" style={{ color: '#E1E0CC' }}>
                  Your creative canvas.
                </p>
              </div>
            </div>
          </AnimatedCard>

          {/* Cards 2-4 - content */}
          {CARDS.map((card, i) => (
            <AnimatedCard key={card.number} index={i + 1} className="h-full">
              <ContentCard card={card} />
            </AnimatedCard>
          ))}
        </div>
      </div>
    </section>
  )
}
