import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

interface WordsPullUpProps {
  text: string
  className?: string
  /** Adds a superscript asterisk after the last "a" of the final word. */
  showAsterisk?: boolean
}

const container = {
  hidden: {},
  visible: (stagger: number) => ({
    transition: { staggerChildren: stagger },
  }),
}

const word = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export default function WordsPullUp({
  text,
  className = '',
  showAsterisk = false,
}: WordsPullUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true })
  const words = text.split(' ')

  return (
    <motion.span
      ref={ref}
      className={`inline-flex flex-wrap ${className}`}
      variants={container}
      custom={0.08}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
    >
      {words.map((w, i) => {
        const isLastWord = i === words.length - 1
        return (
          <motion.span
            key={`${w}-${i}`}
            variants={word}
            className="relative inline-block"
            style={{ marginRight: '0.25em' }}
          >
            {showAsterisk && isLastWord ? (
              <span className="relative inline-block">
                {w}
                <span
                  className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]"
                  aria-hidden="true"
                >
                  *
                </span>
              </span>
            ) : (
              w
            )}
          </motion.span>
        )
      })}
    </motion.span>
  )
}
