import { useState, useEffect, useRef, useCallback, useMemo, type RefObject } from 'react';
import { api } from './api';

// ── Types ────────────────────────────────────────────────────

export interface SuggestionItem {
  id: string;
  label: string;
  description?: string;
  icon: 'file' | 'folder' | 'command';
  type: 'file' | 'command';
}

export interface CommandDef {
  id: string;
  label: string;          // e.g. "/stop"
  description: string;    // e.g. "Stop the running job"
  available: () => boolean;
  execute: () => void;
}

export interface UseSuggestionsOptions {
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  setValue: (v: string) => void;
  projectId: string;
  commands?: CommandDef[];
  enabled?: boolean;
}

export interface UseSuggestionsReturn {
  isOpen: boolean;
  items: SuggestionItem[];
  selectedIndex: number;
  triggerType: '@' | '/' | null;
  loading: boolean;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  selectItem: (index: number) => void;
  setSelectedIndex: (i: number) => void;
  dismiss: () => void;
}

// ── Trigger detection ────────────────────────────────────────

interface TriggerInfo {
  type: '@' | '/';
  query: string;
  startPos: number;  // position of the trigger character
}

function detectTrigger(value: string, cursorPos: number): TriggerInfo | null {
  if (cursorPos === 0 || value.length === 0) return null;

  // Scan backward from cursor
  const textBeforeCursor = value.slice(0, cursorPos);

  // Check for `/` command trigger: must be at start of line or after whitespace
  // and must be the first character of the token
  const slashMatch = textBeforeCursor.match(/(?:^|[\s\n])(\/[^\s\n]*)$/);
  if (slashMatch) {
    const fullMatch = slashMatch[1]; // includes the "/"
    const startPos = cursorPos - fullMatch.length;
    return {
      type: '/',
      query: fullMatch.slice(1), // everything after "/"
      startPos,
    };
  }

  // Check for `@` file trigger: scan backward to find @, ensure it's after whitespace/start
  // Allow path separators (/) and dots in file paths
  const atMatch = textBeforeCursor.match(/(?:^|[\s\n])(@[^\s\n]*)$/);
  if (atMatch) {
    const fullMatch = atMatch[1]; // includes the "@"
    const startPos = cursorPos - fullMatch.length;
    return {
      type: '@',
      query: fullMatch.slice(1), // everything after "@"
      startPos,
    };
  }

  return null;
}

// ── Flatten file tree ────────────────────────────────────────

interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

function flattenFileTree(nodes: FileNode[], maxItems = 50): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  const walk = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (items.length >= maxItems) return;
      items.push({
        id: node.path,
        label: node.path,
        icon: node.isDir ? 'folder' : 'file',
        type: 'file',
      });
      if (node.isDir && node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return items;
}

// ── Main hook ────────────────────────────────────────────────

export function useSuggestions(options: UseSuggestionsOptions): UseSuggestionsReturn {
  const { inputRef, value, setValue, projectId, commands = [], enabled = true } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerType, setTriggerType] = useState<'@' | '/' | null>(null);
  const [loading, setLoading] = useState(false);

  // Cache for flat file list
  const fileCacheRef = useRef<{ projectId: string; items: SuggestionItem[] } | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<TriggerInfo | null>(null);

  // Available commands (filtered by availability)
  const availableCommands = useMemo(() => {
    return commands.filter(c => c.available()).map(c => ({
      id: c.id,
      label: c.label,
      description: c.description,
      icon: 'command' as const,
      type: 'command' as const,
    }));
  }, [commands]);

  // Dismiss the dropdown
  const dismiss = useCallback(() => {
    setIsOpen(false);
    setItems([]);
    setSelectedIndex(0);
    setTriggerType(null);
    triggerRef.current = null;
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  // Fetch files for @ suggestions
  const fetchFiles = useCallback(async (query: string) => {
    if (!projectId) return;

    // If no query, try cached tree or fetch fresh
    if (!query) {
      if (fileCacheRef.current?.projectId === projectId) {
        setItems(fileCacheRef.current.items.slice(0, 10));
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const tree = await api.getFiles(projectId);
        const flat = flattenFileTree(tree);
        fileCacheRef.current = { projectId, items: flat };
        // Only update if we're still in @ mode
        if (triggerRef.current?.type === '@') {
          setItems(flat.slice(0, 10));
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
      return;
    }

    // With query: search (debounced via caller)
    // First try client-side filter on cache
    if (fileCacheRef.current?.projectId === projectId) {
      const lq = query.toLowerCase();
      const filtered = fileCacheRef.current.items
        .filter(item => item.label.toLowerCase().includes(lq))
        .slice(0, 10);
      if (triggerRef.current?.type === '@') {
        setItems(filtered);
      }
      // If cache had few results, also do server search
      if (filtered.length >= 3) {
        setLoading(false);
        return;
      }
    }

    // Server search (filename only, no content)
    try {
      setLoading(true);
      const results = await api.searchFiles(projectId, query, false);
      if (triggerRef.current?.type === '@') {
        const fileItems: SuggestionItem[] = (results.files || []).slice(0, 10).map((f: any) => ({
          id: f.path,
          label: f.path,
          icon: f.isDir ? 'folder' : 'file',
          type: 'file',
        }));
        // Merge with cache results (deduplicate by id)
        const existing = new Set(items.map(i => i.id));
        const merged = [...items.filter(i => i.type === 'file')];
        for (const fi of fileItems) {
          if (!existing.has(fi.id)) {
            merged.push(fi);
          }
        }
        setItems(merged.slice(0, 10));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Filter commands for / suggestions
  const filterCommands = useCallback((query: string) => {
    if (!query) {
      setItems(availableCommands);
    } else {
      const lq = query.toLowerCase();
      setItems(availableCommands.filter(c =>
        c.label.toLowerCase().includes(lq) || c.description.toLowerCase().includes(lq)
      ));
    }
    setLoading(false);
  }, [availableCommands]);

  // Handle input changes — detect triggers
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    if (!enabled) return;

    const el = e.target;
    const cursorPos = el.selectionStart ?? newValue.length;

    const trigger = detectTrigger(newValue, cursorPos);

    if (!trigger) {
      if (isOpen) dismiss();
      return;
    }

    triggerRef.current = trigger;
    setTriggerType(trigger.type);
    setIsOpen(true);
    setSelectedIndex(0);

    if (trigger.type === '/') {
      filterCommands(trigger.query);
    } else if (trigger.type === '@') {
      // Debounce file search
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (!trigger.query) {
        // No query yet, show cached or fetch immediately
        fetchFiles('');
      } else {
        setLoading(true);
        searchTimerRef.current = setTimeout(() => {
          fetchFiles(trigger.query);
        }, 200);
      }
    }
  }, [enabled, isOpen, dismiss, filterCommands, fetchFiles, setValue]);

  // Select an item
  const selectItem = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;

    const trigger = triggerRef.current;
    if (!trigger) return;

    if (item.type === 'file') {
      // Replace @query with @path/to/file
      const before = value.slice(0, trigger.startPos);
      const after = value.slice(trigger.startPos + 1 + trigger.query.length); // +1 for the @ char
      const insertion = `@${item.label} `;
      const newValue = before + insertion + after;
      setValue(newValue);

      // Move cursor to after the inserted text
      const newCursorPos = before.length + insertion.length;
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.setSelectionRange(newCursorPos, newCursorPos);
          el.focus();
        }
      });
    } else if (item.type === 'command') {
      // Execute the command, clear input
      const cmd = commands.find(c => c.id === item.id);
      if (cmd) {
        setValue('');
        cmd.execute();
      }
    }

    dismiss();
  }, [items, value, setValue, dismiss, commands, inputRef]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        selectItem(selectedIndex);
        break;
      case 'Escape':
        e.preventDefault();
        dismiss();
        break;
    }
  }, [isOpen, items.length, selectedIndex, selectItem, dismiss]);

  // Dismiss on blur (with a small delay for click handling)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const handleBlur = () => {
      // Small delay to allow onMouseDown to fire first
      setTimeout(() => dismiss(), 150);
    };

    el.addEventListener('blur', handleBlur);
    return () => el.removeEventListener('blur', handleBlur);
  }, [inputRef, dismiss]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  return {
    isOpen: isOpen && items.length > 0,
    items,
    selectedIndex,
    triggerType,
    loading,
    handleKeyDown,
    handleChange,
    selectItem,
    setSelectedIndex,
    dismiss,
  };
}
