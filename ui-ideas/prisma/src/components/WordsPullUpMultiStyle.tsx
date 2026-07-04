import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

export interface StyledSegment {
  text: string
  className?: string
}

interface WordsPullUpMultiStyleProps {
  segments: StyledSegment[]
  className?: string
}

const word = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export default function WordsPullUpMultiStyle({
  segments,
  className = '',
}: WordsPullUpMultiStyleProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true })

  // Flatten all segments into individual words, preserving per-word className.
  const words: { text: string; className?: string }[] = []
  segments.forEach((segment) => {
    segment.text
      .split(' ')
      .filter((w) => w.length > 0)
      .forEach((w) => words.push({ text: w, className: segment.className }))
  })

  return (
    <motion.span
      ref={ref}
      className={`inline-flex flex-wrap justify-center ${className}`}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      transition={{ staggerChildren: 0.08 }}
    >
      {words.map((w, i) => (
        <motion.span
          key={`${w.text}-${i}`}
          variants={word}
          className={`inline-block ${w.className ?? ''}`}
          style={{ marginRight: '0.25em' }}
        >
          {w.text}
        </motion.span>
      ))}
    </motion.span>
  )
}
