import { useState, useCallback, useRef, useEffect } from 'react';

interface UseResizableOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  storageKey?: string;
}

interface UseResizableReturn {
  width: number;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

export function useResizable({
  initialWidth,
  minWidth,
  maxWidth,
  storageKey,
}: UseResizableOptions): UseResizableReturn {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = Number(saved);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return initialWidth;
  });

  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
      setWidth(newWidth);
    },
    [minWidth, maxWidth]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Persist width to localStorage on change
  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(width));
    }
  }, [width, storageKey]);

  // Attach/detach global listeners
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width]
  );

  return { width, isDragging, handleMouseDown };
}
