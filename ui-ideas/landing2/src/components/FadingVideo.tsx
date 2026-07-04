import { useEffect, useRef, useState, CSSProperties } from 'react';

interface FadingVideoProps {
  src: string | string[];
  className?: string;
  style?: CSSProperties;
}

const FADE_IN_MS = 500;
const FADE_OUT_MS = 550;
const FADE_OUT_THRESHOLD = 0.55; // seconds remaining

export default function FadingVideo({ src, className, style }: FadingVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [opacity, setOpacity] = useState(0);
  const fadeRaf = useRef<number | null>(null);
  const fadingOut = useRef(false);

  const sources = Array.isArray(src) ? src : [src];
  const [index, setIndex] = useState(0);
  const isArray = Array.isArray(src);

  const currentSrc = sources[index % sources.length];

  const cancelFade = () => {
    if (fadeRaf.current !== null) {
      cancelAnimationFrame(fadeRaf.current);
      fadeRaf.current = null;
    }
  };

  const animateOpacity = (from: number, to: number, duration: number) => {
    cancelFade();
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const value = from + (to - from) * t;
      setOpacity(value);
      if (t < 1) {
        fadeRaf.current = requestAnimationFrame(tick);
      } else {
        fadeRaf.current = null;
      }
    };
    fadeRaf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedData = () => {
      fadingOut.current = false;
      animateOpacity(0, 1, FADE_IN_MS);
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          /* autoplay may be blocked; ignore */
        });
      }
    };

    const handleTimeUpdate = () => {
      if (!video.duration || Number.isNaN(video.duration)) return;
      const remaining = video.duration - video.currentTime;
      if (remaining <= FADE_OUT_THRESHOLD && !fadingOut.current) {
        fadingOut.current = true;
        animateOpacity(opacity, 0, FADE_OUT_MS);
      }
    };

    const handleEnded = () => {
      if (isArray) {
        setIndex((prev) => (prev + 1) % sources.length);
      } else {
        fadingOut.current = false;
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {
            /* ignore */
          });
        }
        animateOpacity(0, 1, FADE_IN_MS);
      }
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      cancelFade();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSrc]);

  return (
    <video
      ref={videoRef}
      key={currentSrc}
      className={className}
      style={{ ...style, opacity, transition: 'none' }}
      src={currentSrc}
      autoPlay
      muted
      playsInline
      preload="auto"
    />
  );
}
