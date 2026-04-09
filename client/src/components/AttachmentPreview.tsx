import { X } from 'lucide-react';
import type { Attachment } from '../types';
import { formatSize } from '../hooks/useAttachments';

interface Props {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export function AttachmentPreview({ attachments, onRemove }: Props) {
  if (attachments.length === 0) return null;

  return (
    <div className="attachment-preview">
      {attachments.map(a => (
        <div key={a.id} className="attachment-thumb">
          <img
            src={`data:${a.mediaType};base64,${a.data}`}
            alt={a.filename}
            draggable={false}
          />
          <button
            className="attachment-thumb-remove"
            onClick={() => onRemove(a.id)}
            title="Remove"
            type="button"
          >
            <X size={12} />
          </button>
          <div className="attachment-thumb-info">
            <span className="attachment-thumb-name" title={a.filename}>
              {a.filename.length > 18 ? a.filename.slice(0, 15) + '...' : a.filename}
            </span>
            <span className="attachment-thumb-size">{formatSize(a.size)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Lightweight badge for displaying attachment metadata in chat history (no base64 data needed)
interface AttachmentBadgeProps {
  filename: string;
  mediaType: string;
  size: number;
}

export function AttachmentBadge({ filename, size }: AttachmentBadgeProps) {
  return (
    <span className="attachment-badge" title={filename}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21,15 16,10 5,21" />
      </svg>
      <span className="attachment-badge-name">
        {filename.length > 20 ? filename.slice(0, 17) + '...' : filename}
      </span>
      <span className="attachment-badge-size">{formatSize(size)}</span>
    </span>
  );
}
