import { useRef } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import WordsPullUpMultiStyle, { type StyledSegment } from './WordsPullUpMultiStyle'

const HEADING_SEGMENTS: StyledSegment[] = [
  { text: 'I am Marcus Chen,', className: 'font-normal' },
  { text: 'a self-taught director.', className: 'italic font-serif' },
  {
    text: 'I have skills in color grading, visual effects, and narrative design.',
    className: 'font-normal',
  },
]

const BODY_TEXT =
  'Over the last seven years, I have worked with Parallax, a Berlin-based production house that crafts cinema, series, and Noir Studio in Paris. Together, we have created work that has earned international acclaim at several major festivals.'

interface AnimatedLetterProps {
  char: string
  index: number
  totalChars: number
  progress: MotionValue<number>
}

function AnimatedLetter({ char, index, totalChars, progress }: AnimatedLetterProps) {
  const charProgress = index / totalChars
  const opacity = useTransform(
    progress,
    [charProgress - 0.1, charProgress + 0.05],
    [0.2, 1],
  )
  return (
    <motion.span style={{ opacity }} className="inline">
      {char === ' ' ? '\u00A0' : char}
    </motion.span>
  )
}

export default function About() {
  const bodyRef = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({
    target: bodyRef,
    offset: ['start 0.8', 'end 0.2'],
  })

  const chars = BODY_TEXT.split('')

  return (
    <section className="bg-black px-4 py-20 md:px-8 md:py-32">
      <div className="mx-auto flex max-w-6xl flex-col items-center rounded-2xl bg-[#101010] px-6 py-16 text-center md:px-12 md:py-24">
        <span className="text-primary text-[10px] uppercase tracking-wider sm:text-xs">
          Visual arts
        </span>

        <h2 className="mt-6 max-w-3xl text-3xl leading-[0.95] sm:text-4xl sm:leading-[0.9] md:text-5xl lg:text-6xl xl:text-7xl">
          <WordsPullUpMultiStyle segments={HEADING_SEGMENTS} />
        </h2>

        <p
          ref={bodyRef}
          className="mt-10 max-w-2xl text-xs sm:text-sm md:text-base"
          style={{ color: '#DEDBC8' }}
        >
          {chars.map((char, i) => (
            <AnimatedLetter
              key={i}
              char={char}
              index={i}
              totalChars={chars.length}
              progress={scrollYProgress}
            />
          ))}
        </p>
      </div>
    </section>
  )
}
