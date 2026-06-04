import { useEffect, useRef } from 'react';
import { File, Folder, Goal, Repeat2, Slash, Terminal } from 'lucide-react';
import type { SuggestionItem } from '../hooks/useSuggestions';

interface Props {
  items: SuggestionItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  position: 'above' | 'below';
  loading?: boolean;
  triggerType: '@' | '/' | null;
}

function ItemIcon({ icon }: { icon: SuggestionItem['icon'] }) {
  switch (icon) {
    case 'file':
      return <File size={13} />;
    case 'folder':
      return <Folder size={13} />;
    case 'command':
      return <Slash size={13} />;
    case 'sdk-command':
      return <Terminal size={13} />;
    case 'goal':
      return <Goal size={13} />;
    case 'loop':
      return <Repeat2 size={13} />;
    default:
      return null;
  }
}

export function SuggestionDropdown({ items, selectedIndex, onSelect, onHover, position, loading, triggerType }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  const setItemRef = (index: number) => (el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(index, el);
    } else {
      itemRefs.current.delete(index);
    }
  };

  // Detect boundaries between item types for separators
  const hasLocal = items.some(i => i.type === 'command');
  const hasSdk = items.some(i => i.type === 'sdk-command');
  const showSeparator = hasLocal && hasSdk;

  return (
    <div className={`suggestion-dropdown ${position}`}>
      <div className="suggestion-list" ref={listRef}>
        {loading && items.length === 0 && (
          <div className="suggestion-loading">Searching...</div>
        )}
        {!loading && items.length === 0 && (
          <div className="suggestion-empty">
            {triggerType === '@' ? 'No files found' : 'No commands available'}
          </div>
        )}
        {items.map((item, i) => {
          // Show separator before the first SDK command (when local commands exist above)
          const prevItem = i > 0 ? items[i - 1] : null;
          const needsSeparator = showSeparator && item.type === 'sdk-command' && prevItem?.type === 'command';

          return (
            <div key={item.id}>
              {needsSeparator && (
                <div className="suggestion-separator">Claude Code</div>
              )}
              <div
                ref={setItemRef(i)}
                className={`suggestion-item ${i === selectedIndex ? 'selected' : ''}`}
                onMouseDown={e => {
                  e.preventDefault(); // prevent input blur
                  onSelect(i);
                }}
                onMouseEnter={() => onHover(i)}
              >
                <span className="suggestion-item-icon">
                  <ItemIcon icon={item.icon} />
                </span>
                <span className="suggestion-item-label">{item.label}</span>
                {item.description && (
                  <span className="suggestion-item-desc">{item.description}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="suggestion-hint">
        <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> Navigate</span>
        <span><kbd>&crarr;</kbd> Select</span>
        <span><kbd>Esc</kbd> Dismiss</span>
      </div>
    </div>
  );
}
