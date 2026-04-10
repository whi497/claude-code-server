import { useState, useCallback, useRef } from 'react';
import type { Attachment, AttachmentMediaType } from '../types';

const MAX_FILE_SIZE = 5 * 1024 * 1024;       // 5 MB per file
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;     // 20 MB total
const MAX_FILES = 10;

const ACCEPTED_TYPES: AttachmentMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

function isAcceptedType(type: string): type is AttachmentMediaType {
  return (ACCEPTED_TYPES as string[]).includes(type);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URI prefix: "data:image/png;base64,..."
      const base64 = result.split(',')[1];
      if (!base64) return reject(new Error('Failed to read file'));
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface UseAttachmentsReturn {
  attachments: Attachment[];
  error: string | null;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeAttachment: (id: string) => void;
  clearAll: () => void;
  clearError: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  openFilePicker: () => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  isDragging: boolean;
}

export function useAttachments(): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setError(null);

    // Check file count
    const currentCount = attachments.length;
    if (currentCount + fileArray.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files allowed. Currently have ${currentCount}.`);
      return;
    }

    // Validate and read each file
    const newAttachments: Attachment[] = [];
    let currentTotalSize = attachments.reduce((sum, a) => sum + a.size, 0);

    for (const file of fileArray) {
      // Check type
      if (!isAcceptedType(file.type)) {
        setError(`Unsupported file type: ${file.type || file.name}. Accepted: JPEG, PNG, GIF, WebP.`);
        return;
      }

      // Check individual size
      if (file.size > MAX_FILE_SIZE) {
        setError(`File "${file.name}" is too large (${formatSize(file.size)}). Maximum: ${formatSize(MAX_FILE_SIZE)}.`);
        return;
      }

      // Check total size
      if (currentTotalSize + file.size > MAX_TOTAL_SIZE) {
        setError(`Total attachment size would exceed ${formatSize(MAX_TOTAL_SIZE)}.`);
        return;
      }

      try {
        const data = await readFileAsBase64(file);
        newAttachments.push({
          id: crypto.randomUUID(),
          filename: file.name || `clipboard-image.${file.type.split('/')[1]}`,
          mediaType: file.type as AttachmentMediaType,
          size: file.size,
          data,
        });
        currentTotalSize += file.size;
      } catch {
        setError(`Failed to read file: ${file.name}`);
        return;
      }
    }

    setAttachments(prev => [...prev, ...newAttachments]);
  }, [attachments]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
    setError(null);
  }, []);

  const clearAll = useCallback(() => {
    setAttachments([]);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && isAcceptedType(item.type)) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault(); // prevent default paste only if we found images
      addFiles(imageFiles);
    }
    // If no images found, let normal text paste through
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only show drag state if files are being dragged
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  // We need a separate dragEnter handler to properly track enter/leave nesting
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Filter to only accepted image types
      const imageFiles = Array.from(files).filter(f => isAcceptedType(f.type));
      if (imageFiles.length > 0) {
        addFiles(imageFiles);
      } else {
        setError('No supported image files found. Accepted: JPEG, PNG, GIF, WebP.');
      }
    }
  }, [addFiles]);

  return {
    attachments,
    error,
    addFiles,
    removeAttachment,
    clearAll,
    clearError,
    fileInputRef,
    openFilePicker,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    isDragging,
  };
}

export { formatSize };
