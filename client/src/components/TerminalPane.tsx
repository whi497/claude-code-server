import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { RotateCcw, X, Circle } from 'lucide-react';

interface Props {
  projectId: string;
  active: boolean; // whether this tab is currently visible
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function TerminalPane({ projectId, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonically increasing ID so stale WebSocket callbacks are ignored
  const connIdRef = useRef(0);

  const connect = useCallback(() => {
    if (!containerRef.current) return;

    // Create xterm instance if not exists
    if (!xtermRef.current) {
      const term = new XTerm({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        lineHeight: 1.3,
        scrollback: 10000,
        allowProposedApi: true,
        theme: {
          background: '#0a0e17',
          foreground: '#e2e8f0',
          cursor: '#6ee7b7',
          cursorAccent: '#0a0e17',
          selectionBackground: 'rgba(110, 231, 183, 0.2)',
          selectionForeground: '#e2e8f0',
          black: '#1a2234',
          red: '#f87171',
          green: '#6ee7b7',
          yellow: '#fbbf24',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e2e8f0',
          brightBlack: '#4a5d7a',
          brightRed: '#fca5a5',
          brightGreen: '#a7f3d0',
          brightYellow: '#fde68a',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#f8fafc',
        },
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(containerRef.current);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Initial fit
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* ignore */ }
      });
    }

    const term = xtermRef.current;
    const fitAddon = fitAddonRef.current!;

    // Kill previous connection (suppress all its callbacks via connId)
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    // Bump connection ID — any callback from an older ID is stale and ignored
    const myConnId = ++connIdRef.current;
    const isStale = () => connIdRef.current !== myConnId;

    setConnState('connecting');
    setErrorMsg('');

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/terminal?projectId=${projectId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (isStale()) return;
      setConnState('connected');

      // Send initial resize
      try { fitAddon.fit(); } catch { /* ignore */ }
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      if (isStale()) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m`);
          setConnState('disconnected');
        } else if (msg.type === 'error') {
          setErrorMsg(msg.data);
          setConnState('error');
        }
      } catch { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
      if (isStale()) return;
      setConnState(prev => prev === 'error' ? prev : 'disconnected');
    };

    ws.onerror = () => {
      if (isStale()) return;
      setConnState('error');
      setErrorMsg('Connection failed');
    };

    // Terminal input → WebSocket
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Store disposable for cleanup
    return () => {
      inputDisposable.dispose();
    };
  }, [projectId]);

  // Connect on mount
  useEffect(() => {
    const cleanup = connect();

    return () => {
      // Bump connId to invalidate any in-flight callbacks from the old connection
      connIdRef.current++;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      cleanup?.();
      // Close WebSocket — null all handlers first to prevent any stale events
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      // Dispose xterm
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [projectId, connect]);

  // Fit terminal when tab becomes active or window resizes
  useEffect(() => {
    if (!active) return;

    const fit = () => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          // Notify server of new size
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              cols: xtermRef.current.cols,
              rows: xtermRef.current.rows,
            }));
          }
        } catch { /* container might not be visible yet */ }
      }
    };

    // Fit after a tick (container may need layout time)
    const timer = setTimeout(fit, 50);
    window.addEventListener('resize', fit);

    // Also observe the container for size changes (e.g. panel resize)
    let observer: ResizeObserver | null = null;
    if (containerRef.current) {
      observer = new ResizeObserver(fit);
      observer.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', fit);
      observer?.disconnect();
    };
  }, [active]);

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (active && xtermRef.current) {
      setTimeout(() => xtermRef.current?.focus(), 100);
    }
  }, [active]);

  const handleReconnect = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
    connect();
  };

  const statusDot = connState === 'connected' ? 'terminal-status-connected'
    : connState === 'connecting' ? 'terminal-status-connecting'
    : 'terminal-status-disconnected';

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-toolbar">
        <div className="terminal-pane-toolbar-left">
          <Circle size={8} className={`terminal-status-dot ${statusDot}`} />
          <span className="terminal-pane-label">
            {connState === 'connected' ? 'Terminal' :
             connState === 'connecting' ? 'Connecting...' :
             connState === 'error' ? 'Error' : 'Disconnected'}
          </span>
          {errorMsg && <span className="terminal-pane-error">{errorMsg}</span>}
        </div>
        <div className="terminal-pane-toolbar-right">
          {connState !== 'connected' && (
            <button className="terminal-pane-btn" onClick={handleReconnect} title="Reconnect">
              <RotateCcw size={13} />
            </button>
          )}
          {connState === 'connected' && (
            <button
              className="terminal-pane-btn"
              onClick={() => {
                if (wsRef.current) {
                  wsRef.current.close();
                  setConnState('disconnected');
                }
              }}
              title="Disconnect"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="terminal-pane-body" ref={containerRef} />
    </div>
  );
}
