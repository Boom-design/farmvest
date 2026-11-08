import { useEffect, useRef, useState } from 'react';

/**
 * Width of an element, tracked as it resizes.
 *
 * Charts are drawn at the real pixel width instead of being scaled through a
 * viewBox, so labels stay at their intended size on a phone.
 */
export const useElementWidth = <T extends HTMLElement>(fallback = 640) => {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
};
