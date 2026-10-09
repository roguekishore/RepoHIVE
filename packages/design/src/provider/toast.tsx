"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** How long a toast stays, in milliseconds. A behaviour, not a visual value, so it is not a token. */
export const TOAST_DURATION_MS = 2600;

type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast | undefined>(undefined);

/** Shows one message at a time at the bottom of the page; a new message replaces the old one. */
export function ToastProvider({ children, duration = TOAST_DURATION_MS }: { children: ReactNode; duration?: number }) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback<ShowToast>(
    (next) => {
      clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => setMessage(undefined), duration);
    },
    [duration],
  );

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="rh-toast-region" role="status" aria-live="polite">
        {message === undefined ? null : <div className="rh-toast">{message}</div>}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const value = useContext(ToastContext);
  if (value === undefined) throw new Error("useToast must be used inside a DesignProvider");
  return value;
}
