import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import confetti from "canvas-confetti";

const Confetti = forwardRef(function Confetti({
  options,
  globalOptions = { resize: true, useWorker: true },
  manualstart = false,
  className,
  ...rest
}, ref) {
  const canvasNodeRef = useRef(null);
  const instanceRef = useRef(null);
  const optionsRef = useRef(options);
  const globalOptionsRef = useRef(globalOptions);

  useEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => { globalOptionsRef.current = globalOptions; }, [globalOptions]);

  useEffect(() => {
    if (!canvasNodeRef.current || instanceRef.current) return undefined;
    instanceRef.current = confetti.create(canvasNodeRef.current, {
      resize: true,
      useWorker: true,
      ...globalOptionsRef.current,
    });
    return () => {
      instanceRef.current?.reset();
      instanceRef.current = null;
    };
  }, []);

  const fire = useCallback(async (extraOptions = {}) => {
    try {
      await instanceRef.current?.({ ...optionsRef.current, ...extraOptions });
    } catch (error) {
      console.error("Confetti error:", error);
    }
  }, []);

  const api = useMemo(() => ({ fire }), [fire]);
  useImperativeHandle(ref, () => api, [api]);

  useEffect(() => {
    if (manualstart) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    void fire();
  }, [manualstart, fire]);

  return <canvas ref={canvasNodeRef} className={className} {...rest} />;
});

Confetti.displayName = "Confetti";

export default Confetti;
