import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { SearchAddon } from '@xterm/addon-search';
import { OverlayAddon } from '../components/OverlayAddon';
import { getToken, api } from '../api';
import '@xterm/xterm/css/xterm.css';

const LS_KEY = 'terminal-tabs';
const LS_THEME_KEY = 'terminal-theme';
const LS_SNIPPETS_KEY = 'terminal-snippets';

// --- Terminal Themes ---
const TERMINAL_THEMES = {
  default: {
    name: 'Default',
    background: '#1a1b2e',
    foreground: '#e4e4e7',
    cursor: '#a78bfa',
    cursorAccent: '#1a1b2e',
    selectionBackground: '#3b3d5e80',
    selectionForeground: undefined,
    selectionInactiveBackground: '#3b3d5e40',
    black: '#1a1b2e', red: '#f87171', green: '#4ade80', yellow: '#facc15',
    blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e4e4e7',
    brightBlack: '#4b5563', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a',
    brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f9fafb',
  },
  dracula: {
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    cursorAccent: '#282a36',
    selectionBackground: '#44475a80',
    selectionForeground: undefined,
    selectionInactiveBackground: '#44475a40',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
    brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  monokai: {
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    cursorAccent: '#272822',
    selectionBackground: '#49483e80',
    selectionForeground: undefined,
    selectionInactiveBackground: '#49483e40',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
    brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
  },
  solarizedDark: {
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    selectionForeground: undefined,
    selectionInactiveBackground: '#07364280',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
    brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  nord: {
    name: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    cursorAccent: '#2e3440',
    selectionBackground: '#434c5e80',
    selectionForeground: undefined,
    selectionInactiveBackground: '#434c5e40',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  oneDark: {
    name: 'One Dark',
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    cursorAccent: '#282c34',
    selectionBackground: '#3e445180',
    selectionForeground: undefined,
    selectionInactiveBackground: '#3e445140',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
    brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
};

function loadThemeKey() {
  try {
    const key = localStorage.getItem(LS_THEME_KEY);
    if (key && TERMINAL_THEMES[key]) return key;
  } catch (_) {}
  return 'default';
}

function saveThemeKey(key) {
  try { localStorage.setItem(LS_THEME_KEY, key); } catch (_) {}
}

function loadSnippets() {
  try {
    const raw = localStorage.getItem(LS_SNIPPETS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveSnippets(snippets) {
  try { localStorage.setItem(LS_SNIPPETS_KEY, JSON.stringify(snippets)); } catch (_) {}
}

function loadTabState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

function saveTabState(sessionIds, activeId) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ sessionIds, activeId }));
  } catch (_) {}
}

// Create a fully configured xterm instance with all addons
function createXtermInstance(themeKey) {
  const themeObj = TERMINAL_THEMES[themeKey] || TERMINAL_THEMES.default;
  const { name: _n, ...themeColors } = themeObj;
  const term = new XTerminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    fontSize: 14,
    fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", "Menlo", "Consolas", monospace',
    fontWeight: '400',
    fontWeightBold: '700',
    lineHeight: 1.15,
    letterSpacing: 0,
    scrollback: 10000,
    smoothScrollDuration: 0,
    fastScrollModifier: 'alt',
    allowProposedApi: true,
    allowTransparency: false,
    drawBoldTextInBrightColors: true,
    minimumContrastRatio: 1,
    macOptionIsMeta: true,
    rightClickSelectsWord: true,
    theme: themeColors,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const overlayAddon = new OverlayAddon();
  term.loadAddon(overlayAddon);

  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = '11';

  const webLinks = new WebLinksAddon();
  term.loadAddon(webLinks);

  const clipboardAddon = new ClipboardAddon();
  term.loadAddon(clipboardAddon);

  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);

  const imageAddon = new ImageAddon();
  term.loadAddon(imageAddon);

  return { term, fitAddon, overlayAddon, searchAddon };
}

function openAndAttachRenderer(term, container) {
  term.open(container);

  let webglAddon = null;
  let canvasAddon = null;

  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon?.dispose();
      webglAddon = null;
      try {
        canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
      } catch (_) {}
    });
    term.loadAddon(webglAddon);
  } catch (_) {
    try {
      canvasAddon = new CanvasAddon();
      term.loadAddon(canvasAddon);
    } catch (_2) {}
  }

  // Selection auto-copy
  term.onSelectionChange(() => {
    const sel = term.getSelection();
    if (!sel) return;
    try { navigator.clipboard.writeText(sel); } catch (_) {}
  });

  return { webglAddon, canvasAddon };
}

export default function Terminal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const socketRef = useRef(null);
  const queryProcessedRef = useRef(false);

  // tabs: array of { id, title, project, exited }
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

  // Rename state
  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createProject, setCreateProject] = useState('');
  const [projectList, setProjectList] = useState([]);
  const createDialogRef = useRef(null);

  // Inline project creation state
  const [showInlineCreate, setShowInlineCreate] = useState(false);
  const [inlineProjectName, setInlineProjectName] = useState('');
  const [inlineCreating, setInlineCreating] = useState(false);

  // Theme state
  const [currentTheme, setCurrentTheme] = useState(loadThemeKey);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const themeMenuRef = useRef(null);

  // Scroll-to-bottom state
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollListenerRef = useRef(null);

  // Snippets state
  const [snippets, setSnippets] = useState(loadSnippets);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetName, setSnippetName] = useState('');
  const [snippetCmd, setSnippetCmd] = useState('');
  const snippetsPanelRef = useRef(null);

  // Drag & drop tab reordering state
  const [dragTabId, setDragTabId] = useState(null);
  const [dragOverTabId, setDragOverTabId] = useState(null);
  const [dragOverSide, setDragOverSide] = useState(null);

  // AI Enhance state
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiOutput, setAiOutput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiInputRef = useRef(null);

  // Per-tab xterm instances: Map<sessionId, { term, fitAddon, overlayAddon, searchAddon, webglAddon, canvasAddon, opened }>
  const xtermMapRef = useRef(new Map());
  // Track initialization
  const initRef = useRef(false);

  // --- Socket connection (single, shared) ---
  useEffect(() => {
    const socket = io('/terminal', {
      auth: { token: getToken() },
      transports: ['websocket'],
      upgrade: false,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      if (!initRef.current) {
        initRef.current = true;
        initializeTabs(socket);
      } else {
        // Reconnect: re-attach current tab
        reattachCurrentTab(socket);
      }
    });

    socket.on('connect_error', () => setIsConnected(false));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('output', (data) => {
      // Route output to the active tab's xterm
      const activeId = activeTabRef.current;
      if (activeId) {
        const entry = xtermMapRef.current.get(activeId);
        if (entry) entry.term.write(data);
      }
    });

    socket.on('session-exited', ({ id }) => {
      setTabs(prev => prev.map(t => t.id === id ? { ...t, exited: true } : t));
      const entry = xtermMapRef.current.get(id);
      if (entry) entry.overlayAddon.showOverlay('Process exited', 3000);
    });

    return () => {
      socket.disconnect();
      // Dispose all xterm instances
      for (const entry of xtermMapRef.current.values()) {
        try { entry.webglAddon?.dispose(); } catch (_) {}
        try { entry.canvasAddon?.dispose(); } catch (_) {}
        try { entry.term.dispose(); } catch (_) {}
      }
      xtermMapRef.current.clear();
    };
  }, []);

  // Ref to always hold the current active tab id (for use in socket callbacks)
  const activeTabRef = useRef(null);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // --- Initialize tabs from server + localStorage ---
  function initializeTabs(socket) {
    socket.emit('list-sessions', (serverSessions) => {
      const saved = loadTabState();
      const serverIds = new Set(serverSessions.map(s => s.id));

      // Read query params
      const qSession = searchParams.get('session');
      const qProject = searchParams.get('project');

      if (serverSessions.length > 0) {
        // Restore tabs from server, ordered by saved state if available
        let orderedSessions;
        if (saved && saved.sessionIds) {
          const savedOrder = saved.sessionIds.filter(id => serverIds.has(id));
          const remaining = serverSessions.filter(s => !savedOrder.includes(s.id));
          orderedSessions = [
            ...savedOrder.map(id => serverSessions.find(s => s.id === id)),
            ...remaining,
          ];
        } else {
          orderedSessions = serverSessions;
        }

        const newTabs = orderedSessions.map(s => ({ id: s.id, title: s.title, project: s.project || '', exited: s.exited }));
        setTabs(newTabs);

        // Handle query params
        if (!queryProcessedRef.current && qSession && serverIds.has(qSession)) {
          // Activate the requested session tab
          queryProcessedRef.current = true;
          setActiveTab(qSession);
          saveTabState(newTabs.map(t => t.id), qSession);
          navigate('/terminal', { replace: true });
        } else if (!queryProcessedRef.current && qProject) {
          // Create a new session for this project
          queryProcessedRef.current = true;
          setTabs(newTabs);
          const initialActive = saved?.activeId && serverIds.has(saved.activeId) ? saved.activeId : newTabs[0].id;
          setActiveTab(initialActive);
          saveTabState(newTabs.map(t => t.id), initialActive);
          createNewTab(socket, qProject);
          navigate('/terminal', { replace: true });
        } else {
          // Normal init — pick active tab
          let initialActive = saved?.activeId;
          if (!initialActive || !serverIds.has(initialActive)) {
            initialActive = newTabs[0].id;
          }
          setActiveTab(initialActive);
          saveTabState(newTabs.map(t => t.id), initialActive);
          // Clean up any stale query params
          if (qSession || qProject) {
            navigate('/terminal', { replace: true });
          }
        }
      } else {
        // No sessions exist
        if (!queryProcessedRef.current && qProject) {
          // Create a session for the requested project
          queryProcessedRef.current = true;
          createNewTab(socket, qProject);
          navigate('/terminal', { replace: true });
        } else {
          // Create a default tab
          createNewTab(socket);
          if (qSession || qProject) {
            navigate('/terminal', { replace: true });
          }
        }
      }
    });
  }

  function reattachCurrentTab(socket) {
    const id = activeTabRef.current;
    if (!id) return;
    const entry = xtermMapRef.current.get(id);
    if (!entry) return;
    socket.emit('attach-session', {
      id,
      cols: entry.term.cols,
      rows: entry.term.rows,
      replay: false, // Already have local buffer
    });
  }

  // --- Create a new tab (simple, no dialog) ---
  function createNewTab(socket, project) {
    const s = socket || socketRef.current;
    if (!s?.connected) return;
    s.emit('create-session', { cols: 120, rows: 30, project: project || undefined }, (result) => {
      if (result.error) {
        alert(result.error);
        return;
      }
      const newTab = { id: result.id, title: result.title, project: result.project || '', exited: false };
      setTabs(prev => {
        const next = [...prev, newTab];
        saveTabState(next.map(t => t.id), result.id);
        return next;
      });
      setActiveTab(result.id);
    });
  }

  // --- Create tab via dialog ---
  function handleCreateFromDialog() {
    const s = socketRef.current;
    if (!s?.connected) return;
    s.emit('create-session', { cols: 120, rows: 30, project: createProject || undefined }, (result) => {
      if (result.error) {
        alert(result.error);
        return;
      }
      // If a custom name was given, rename immediately
      const tabTitle = createName.trim() || result.title;
      if (createName.trim() && createName.trim() !== result.title) {
        s.emit('rename-session', { id: result.id, title: createName.trim() });
      }
      const newTab = { id: result.id, title: tabTitle, project: result.project || '', exited: false };
      setTabs(prev => {
        const next = [...prev, newTab];
        saveTabState(next.map(t => t.id), result.id);
        return next;
      });
      setActiveTab(result.id);
    });
    setShowCreateDialog(false);
    setCreateName('');
    setCreateProject('');
  }

  // --- Kill/close a tab ---
  function closeTab(sessionId) {
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('kill-session', { id: sessionId });
    }

    // Dispose the xterm instance and remove wrapper
    const entry = xtermMapRef.current.get(sessionId);
    if (entry) {
      try { entry.webglAddon?.dispose(); } catch (_) {}
      try { entry.canvasAddon?.dispose(); } catch (_) {}
      try { entry.term.dispose(); } catch (_) {}
      try { entry.wrapper?.remove(); } catch (_) {}
      xtermMapRef.current.delete(sessionId);
    }

    setTabs(prev => {
      const next = prev.filter(t => t.id !== sessionId);
      if (next.length === 0) {
        // Create a fresh tab
        createNewTab(s);
        return next;
      }
      // If closing active tab, switch to neighbor
      if (activeTab === sessionId) {
        const idx = prev.findIndex(t => t.id === sessionId);
        const newActive = next[Math.min(idx, next.length - 1)]?.id;
        setActiveTab(newActive);
        saveTabState(next.map(t => t.id), newActive);
      } else {
        saveTabState(next.map(t => t.id), activeTab);
      }
      return next;
    });
  }

  // --- Rename helpers ---
  function startRename(tabId, currentTitle) {
    setRenamingTabId(tabId);
    setRenameValue(currentTitle);
  }

  function commitRename() {
    if (!renamingTabId) return;
    const newTitle = renameValue.trim();
    if (newTitle) {
      const s = socketRef.current;
      if (s?.connected) {
        s.emit('rename-session', { id: renamingTabId, title: newTitle }, (result) => {
          if (result && !result.error) {
            setTabs(prev => prev.map(t => t.id === renamingTabId ? { ...t, title: result.title } : t));
          }
        });
      }
    }
    setRenamingTabId(null);
    setRenameValue('');
  }

  function cancelRename() {
    setRenamingTabId(null);
    setRenameValue('');
  }

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingTabId]);

  // --- Fetch project list for dialog ---
  function openCreateDialog() {
    setShowCreateDialog(true);
    setCreateName('');
    setCreateProject('');
    api('/api/terminal/projects')
      .then(dirs => setProjectList(dirs))
      .catch(() => setProjectList([]));
  }

  // Inline project creation
  async function handleInlineCreateProject() {
    const name = inlineProjectName.trim();
    if (!name || inlineCreating) return;
    setInlineCreating(true);
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      // Refresh project list and select the new project
      const dirs = await api('/api/terminal/projects');
      setProjectList(dirs);
      setCreateProject(name);
      setShowInlineCreate(false);
      setInlineProjectName('');
    } catch (err) {
      alert(err.message);
    } finally {
      setInlineCreating(false);
    }
  }

  // Close dialog on outside click
  useEffect(() => {
    if (!showCreateDialog) return;
    function handleClick(e) {
      if (createDialogRef.current && !createDialogRef.current.contains(e.target)) {
        setShowCreateDialog(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCreateDialog]);

  // --- Switch active tab: attach on server, show/hide xterm ---
  useEffect(() => {
    if (!activeTab || !socketRef.current?.connected) return;

    const socket = socketRef.current;
    const container = containerRef.current;
    if (!container) return;

    // Ensure xterm instance exists for this tab
    let entry = xtermMapRef.current.get(activeTab);
    const needsReplay = !entry;

    if (!entry) {
      const { term, fitAddon, overlayAddon, searchAddon } = createXtermInstance(currentTheme);
      entry = { term, fitAddon, overlayAddon, searchAddon, webglAddon: null, canvasAddon: null, opened: false, wrapper: null };
      xtermMapRef.current.set(activeTab, entry);

      // Wire input to socket
      term.onData((data) => {
        if (socketRef.current?.connected) socketRef.current.emit('input', data);
      });
      term.onBinary((data) => {
        if (socketRef.current?.connected) socketRef.current.emit('input', data);
      });
      term.onResize(({ cols, rows }) => {
        entry.overlayAddon.showOverlay(`${cols} x ${rows}`, 500);
      });
    }

    // Hide all other wrapper divs (not just xterm elements)
    for (const [id, e] of xtermMapRef.current) {
      if (id !== activeTab && e.opened && e.wrapper) {
        e.wrapper.style.display = 'none';
      }
    }

    // Show / open the active terminal
    if (!entry.opened) {
      // Create a wrapper div for this terminal
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'width:100%;height:100%;';
      wrapper.dataset.sessionId = activeTab;
      container.appendChild(wrapper);
      entry.wrapper = wrapper;
      const { webglAddon, canvasAddon } = openAndAttachRenderer(entry.term, wrapper);
      entry.webglAddon = webglAddon;
      entry.canvasAddon = canvasAddon;
      entry.opened = true;
    } else if (entry.wrapper) {
      entry.wrapper.style.display = '';
    }

    // Fit and focus
    requestAnimationFrame(() => {
      try { entry.fitAddon.fit(); } catch (_) {}
      entry.term.focus();
    });

    // Scroll-to-bottom detection
    if (scrollListenerRef.current) {
      scrollListenerRef.current.dispose();
      scrollListenerRef.current = null;
    }
    const checkScroll = () => {
      const buf = entry.term.buffer.active;
      setShowScrollBtn(buf.viewportY < buf.baseY);
    };
    scrollListenerRef.current = entry.term.onScroll(checkScroll);
    // Also check right now
    checkScroll();

    // Attach on server
    socket.emit('attach-session', {
      id: activeTab,
      cols: entry.term.cols,
      rows: entry.term.rows,
      replay: needsReplay,
    });

    saveTabState(tabs.map(t => t.id), activeTab);
  }, [activeTab, isConnected]);

  // --- ResizeObserver ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let resizeTimeout = null;
    function doResize() {
      const id = activeTabRef.current;
      if (!id) return;
      const entry = xtermMapRef.current.get(id);
      if (!entry || !entry.opened) return;
      try {
        entry.fitAddon.fit();
        if (socketRef.current?.connected) {
          socketRef.current.emit('resize', { cols: entry.term.cols, rows: entry.term.rows });
        }
      } catch (_) {}
    }

    function debouncedResize() {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(doResize, 50);
    }

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(debouncedResize);
      observer.observe(container);
    } else {
      window.addEventListener('resize', debouncedResize);
    }

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', debouncedResize);
    };
  }, []);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e) => {
      // Ctrl+Shift+T -- new tab in current project
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        const proj = tabs.find(t => t.id === activeTabRef.current)?.project;
        createNewTab(null, proj || undefined);
        return;
      }
      // Ctrl+Shift+W -- close active tab
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        if (activeTabRef.current) closeTab(activeTabRef.current);
        return;
      }
      // Ctrl+Shift+F -- search
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowSearch(prev => {
          if (prev) {
            const entry = xtermMapRef.current.get(activeTabRef.current);
            if (entry) {
              entry.searchAddon.clearDecorations();
              entry.term.focus();
            }
            return false;
          }
          return true;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [showSearch]);

  // Search helpers
  const doSearch = useCallback((query, direction) => {
    if (!query || !activeTabRef.current) return;
    const entry = xtermMapRef.current.get(activeTabRef.current);
    if (!entry) return;
    if (direction === 'prev') {
      entry.searchAddon.findPrevious(query, { regex: false, caseSensitive: false, wholeWord: false });
    } else {
      entry.searchAddon.findNext(query, { regex: false, caseSensitive: false, wholeWord: false });
    }
  }, []);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(searchQuery, e.shiftKey ? 'prev' : 'next');
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      const entry = xtermMapRef.current.get(activeTabRef.current);
      if (entry) {
        entry.searchAddon.clearDecorations();
        entry.term.focus();
      }
      setShowSearch(false);
    }
  };

  // Send a key sequence to the active terminal (for mobile controls)
  const sendKey = useCallback((seq) => {
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('input', seq);
    }
    const entry = xtermMapRef.current.get(activeTabRef.current);
    if (entry) {
      entry.term.focus();
    }
  }, []);

  // --- Speech-to-text (voice input) ---
  const [isListening, setIsListening] = useState(false);
  const [speechSupported] = useState(
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
  const recognitionRef = useRef(null);

  const toggleSpeech = useCallback(() => {
    if (isListening) {
      // Stop
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    // Use browser default language (adapts to user's device)

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      if (text) {
        const s = socketRef.current;
        if (s?.connected) {
          s.emit('input', text);
        }
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }, [isListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (scrollListenerRef.current) {
        scrollListenerRef.current.dispose();
      }
    };
  }, []);

  // --- Apply theme to all open terminals ---
  const applyTheme = useCallback((key) => {
    const themeObj = TERMINAL_THEMES[key];
    if (!themeObj) return;
    const { name: _n, ...themeColors } = themeObj;
    setCurrentTheme(key);
    saveThemeKey(key);
    // Update all open xterm instances
    for (const entry of xtermMapRef.current.values()) {
      entry.term.options.theme = themeColors;
    }
    // Update container background
    if (containerRef.current) {
      containerRef.current.style.background = themeColors.background;
    }
    setShowThemeMenu(false);
  }, []);

  // Sync container bg on first render / theme change
  useEffect(() => {
    const theme = TERMINAL_THEMES[currentTheme] || TERMINAL_THEMES.default;
    if (containerRef.current) {
      containerRef.current.style.background = theme.background;
    }
  }, [currentTheme]);

  // Close theme menu on outside click
  useEffect(() => {
    if (!showThemeMenu) return;
    function handleClick(e) {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showThemeMenu]);

  // --- Scroll to bottom ---
  const scrollToBottom = useCallback(() => {
    const id = activeTabRef.current;
    if (!id) return;
    const entry = xtermMapRef.current.get(id);
    if (!entry) return;
    entry.term.scrollToBottom();
    entry.term.focus();
    setShowScrollBtn(false);
  }, []);

  // --- Snippets ---
  const addSnippet = useCallback(() => {
    const name = snippetName.trim();
    const cmd = snippetCmd.trim();
    if (!name || !cmd) return;
    const newSnippet = { id: Date.now().toString(), name, command: cmd };
    setSnippets(prev => {
      const next = [...prev, newSnippet];
      saveSnippets(next);
      return next;
    });
    setSnippetName('');
    setSnippetCmd('');
  }, [snippetName, snippetCmd]);

  const deleteSnippet = useCallback((id) => {
    setSnippets(prev => {
      const next = prev.filter(s => s.id !== id);
      saveSnippets(next);
      return next;
    });
  }, []);

  const executeSnippet = useCallback((command) => {
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('input', command + '\r');
    }
    const entry = xtermMapRef.current.get(activeTabRef.current);
    if (entry) entry.term.focus();
    setShowSnippets(false);
  }, []);

  // Close snippets panel on outside click
  useEffect(() => {
    if (!showSnippets) return;
    function handleClick(e) {
      if (snippetsPanelRef.current && !snippetsPanelRef.current.contains(e.target)) {
        setShowSnippets(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSnippets]);

  // --- Drag & Drop Tab Reordering ---
  const handleDragStart = useCallback((e, tabId) => {
    setDragTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
    // Make dragged tab semi-transparent
    requestAnimationFrame(() => {
      const el = e.target;
      if (el) el.style.opacity = '0.4';
    });
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.target.style.opacity = '';
    setDragTabId(null);
    setDragOverTabId(null);
    setDragOverSide(null);
  }, []);

  const handleDragOver = useCallback((e, tabId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Determine which side of the tab the cursor is on
    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const side = e.clientX < midX ? 'left' : 'right';
    setDragOverTabId(tabId);
    setDragOverSide(side);
  }, []);

  const handleDrop = useCallback((e, targetTabId) => {
    e.preventDefault();
    const sourceId = dragTabId;
    if (!sourceId || sourceId === targetTabId) {
      setDragOverTabId(null);
      setDragOverSide(null);
      return;
    }
    setTabs(prev => {
      const sourceIdx = prev.findIndex(t => t.id === sourceId);
      const targetIdx = prev.findIndex(t => t.id === targetTabId);
      if (sourceIdx === -1 || targetIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      // If we're dragging to the right side, insert after target; otherwise before
      let insertIdx = next.findIndex(t => t.id === targetTabId);
      if (dragOverSide === 'right') insertIdx += 1;
      next.splice(insertIdx, 0, moved);
      saveTabState(next.map(t => t.id), activeTab);
      return next;
    });
    setDragOverTabId(null);
    setDragOverSide(null);
  }, [dragTabId, dragOverSide, activeTab]);

  // --- AI Enhance ---
  const handleAIEnhance = useCallback(() => {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    const s = socketRef.current;
    const sessionId = activeTabRef.current;
    if (!s?.connected || !sessionId) return;

    setAiLoading(true);
    setAiError('');
    setAiOutput('');

    s.emit('ai-enhance', { text, sessionId }, (result) => {
      setAiLoading(false);
      if (result.error) {
        setAiError(result.error);
      } else {
        setAiOutput(result.enhanced || '');
      }
    });
  }, [aiInput, aiLoading]);

  // Clear the current line in the terminal (Ctrl+E go to end, Ctrl+U kill backward = wipe whole line)
  const clearTerminalLine = useCallback(() => {
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('input', '\x05\x15'); // Ctrl+E (end of line) + Ctrl+U (kill line backward)
    }
  }, []);

  const sendAIOutputToTerminal = useCallback(() => {
    const text = aiOutput.trim();
    if (!text) return;
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('input', text);
    }
    const entry = xtermMapRef.current.get(activeTabRef.current);
    if (entry) entry.term.focus();
    setShowAIPanel(false);
    setAiInput('');
    setAiOutput('');
    setAiError('');
  }, [aiOutput]);

  // Clear current line THEN type the enhanced text (replace flow)
  const replaceLineWithAIOutput = useCallback(() => {
    const text = aiOutput.trim();
    if (!text) return;
    const s = socketRef.current;
    if (s?.connected) {
      // Ctrl+E (end) + Ctrl+U (kill backward) = wipe line, then type new text
      s.emit('input', '\x05\x15' + text);
    }
    const entry = xtermMapRef.current.get(activeTabRef.current);
    if (entry) entry.term.focus();
    setShowAIPanel(false);
    setAiInput('');
    setAiOutput('');
    setAiError('');
  }, [aiOutput]);

  const resetAIConversation = useCallback(() => {
    const s = socketRef.current;
    const sessionId = activeTabRef.current;
    if (s?.connected && sessionId) {
      s.emit('ai-reset', { sessionId });
    }
    setAiOutput('');
    setAiError('');
  }, []);

  // Toggle AI panel
  const toggleAIPanel = useCallback(() => {
    setShowAIPanel(prev => {
      if (!prev) {
        // Focus the textarea on next render
        setTimeout(() => aiInputRef.current?.focus(), 50);
      }
      return !prev;
    });
  }, []);

  // Keyboard shortcut: Ctrl+Shift+E to toggle AI panel
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        toggleAIPanel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleAIPanel]);

  // Get active tab's project
  const activeProject = tabs.find(t => t.id === activeTab)?.project || '';

  return (
    <div className="page terminal-page">
      {/* Tab bar */}
      <div className="terminal-tabs-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`terminal-tab ${tab.id === activeTab ? 'active' : ''} ${tab.exited ? 'exited' : ''} ${dragTabId === tab.id ? 'dragging' : ''} ${dragOverTabId === tab.id ? `drag-over-${dragOverSide}` : ''}`}
            onClick={() => setActiveTab(tab.id)}
            draggable={renamingTabId !== tab.id}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, tab.id)}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragLeave={() => { setDragOverTabId(null); setDragOverSide(null); }}
          >
            {tab.project && (
              <span className="terminal-tab-project">{tab.project}</span>
            )}
            {renamingTabId === tab.id ? (
              <input
                ref={renameInputRef}
                className="terminal-tab-rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  e.stopPropagation();
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                spellCheck={false}
                draggable="false"
              />
            ) : (
              <span
                className="terminal-tab-title"
                onDoubleClick={(e) => { e.stopPropagation(); startRename(tab.id, tab.title); }}
              >
                {tab.title}
              </span>
            )}
            <button
              className="terminal-tab-close"
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              title="Close Tab"
              draggable="false"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ))}
        <button
          className="terminal-tab-new"
          onClick={() => createNewTab(null, activeProject || undefined)}
          title="New tab in current project (Ctrl+Shift+T)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>

      {/* Toolbar */}
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          <div className="terminal-conn-status">
            <span className={`terminal-status ${isConnected ? 'connected' : 'disconnected'}`} />
            <span className="terminal-status-text">
              {isConnected ? 'Stable' : 'Offline'}
            </span>
          </div>
          <div className="toolbar-sep" />
          {activeProject && (
            <span className="terminal-project-badge">{activeProject}</span>
          )}
          {tabs.length > 0 && (
            <span className="terminal-instance-count">
              {tabs.length} {tabs.length === 1 ? 'instance' : 'instances'}
            </span>
          )}
        </div>
        <div className="terminal-toolbar-right">
          {/* Theme selector */}
          <div className="terminal-toolbar-dropdown-wrapper" ref={themeMenuRef}>
            <button
              className="terminal-toolbar-btn"
              onClick={() => setShowThemeMenu(prev => !prev)}
              title="Terminal theme"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              <span>Theme</span>
            </button>
            {showThemeMenu && (
              <div className="terminal-theme-menu">
                {Object.entries(TERMINAL_THEMES).map(([key, theme]) => (
                  <button
                    key={key}
                    className={`terminal-theme-option ${currentTheme === key ? 'active' : ''}`}
                    onClick={() => applyTheme(key)}
                  >
                    <span
                      className="terminal-theme-preview"
                      style={{ background: theme.background, borderColor: theme.foreground + '40' }}
                    >
                      <span style={{ color: theme.green }}>$</span>
                      <span style={{ color: theme.foreground }}>_</span>
                    </span>
                    <span className="terminal-theme-name">{theme.name}</span>
                    {currentTheme === key && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Snippets */}
          <div className="terminal-toolbar-dropdown-wrapper" ref={snippetsPanelRef}>
            <button
              className="terminal-toolbar-btn"
              onClick={() => setShowSnippets(prev => !prev)}
              title="Command snippets"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
              <span>Snippets</span>
            </button>
            {showSnippets && (
              <div className="terminal-snippets-panel">
                <div className="terminal-snippets-header">Saved Snippets</div>
                {snippets.length === 0 && (
                  <div className="terminal-snippets-empty">No snippets yet. Add one below.</div>
                )}
                <div className="terminal-snippets-list">
                  {snippets.map(s => (
                    <div key={s.id} className="terminal-snippet-item">
                      <div className="terminal-snippet-info" onClick={() => executeSnippet(s.command)} title={`Run: ${s.command}`}>
                        <span className="terminal-snippet-name">{s.name}</span>
                        <code className="terminal-snippet-cmd">{s.command}</code>
                      </div>
                      <button
                        className="terminal-snippet-delete"
                        onClick={(e) => { e.stopPropagation(); deleteSnippet(s.id); }}
                        title="Delete snippet"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="terminal-snippets-add">
                  <input
                    type="text"
                    placeholder="Name"
                    value={snippetName}
                    onChange={(e) => setSnippetName(e.target.value)}
                    className="terminal-snippet-input"
                    onKeyDown={(e) => { if (e.key === 'Enter') addSnippet(); }}
                  />
                  <input
                    type="text"
                    placeholder="Command"
                    value={snippetCmd}
                    onChange={(e) => setSnippetCmd(e.target.value)}
                    className="terminal-snippet-input terminal-snippet-input-cmd"
                    onKeyDown={(e) => { if (e.key === 'Enter') addSnippet(); }}
                  />
                  <button className="terminal-snippet-save-btn" onClick={addSnippet} title="Save snippet">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* AI Enhance */}
          <button
            className={`terminal-toolbar-btn ${showAIPanel ? 'ai-active' : ''}`}
            onClick={toggleAIPanel}
            title="AI Prompt Enhancer (Ctrl+Shift+E)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
            <span>AI Enhance</span>
          </button>

          <button
            className="terminal-toolbar-btn"
            onClick={() => setShowSearch(prev => {
              if (prev) {
                const entry = xtermMapRef.current.get(activeTabRef.current);
                if (entry) {
                  entry.searchAddon.clearDecorations();
                  entry.term.focus();
                }
                return false;
              }
              return true;
            })}
            title="Search (Ctrl+Shift+F)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span>Search</span>
          </button>
          <button
            className="terminal-toolbar-btn"
            onClick={() => {
              if (activeTabRef.current) {
                const entry = xtermMapRef.current.get(activeTabRef.current);
                if (entry) entry.term.clear();
              }
            }}
            title="Clear terminal"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
            <span>Clear</span>
          </button>
          {speechSupported && (
            <button
              className={`terminal-toolbar-btn ${isListening ? 'speech-active' : ''}`}
              onClick={toggleSpeech}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
              <span>{isListening ? 'Listening' : 'Voice'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="terminal-search-input"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              doSearch(e.target.value, 'next');
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search... (Enter=next, Shift+Enter=prev, Esc=close)"
            spellCheck={false}
          />
          <button className="btn btn-xs btn-ghost" onClick={() => doSearch(searchQuery, 'prev')} title="Previous">&#9650;</button>
          <button className="btn btn-xs btn-ghost" onClick={() => doSearch(searchQuery, 'next')} title="Next">&#9660;</button>
          <button className="btn btn-xs btn-ghost" onClick={() => {
            const entry = xtermMapRef.current.get(activeTabRef.current);
            if (entry) {
              entry.searchAddon.clearDecorations();
              entry.term.focus();
            }
            setShowSearch(false);
          }} title="Close (Esc)">&#10005;</button>
        </div>
      )}

      {/* AI Enhance Panel */}
      {showAIPanel && (
        <div className="terminal-ai-panel">
          <div className="terminal-ai-header">
            <div className="terminal-ai-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                <path d="M2 17l10 5 10-5"></path>
                <path d="M2 12l10 5 10-5"></path>
              </svg>
              <span>AI Prompt Enhancer</span>
              <span className="terminal-ai-badge">GPT-5 mini</span>
            </div>
            <div className="terminal-ai-header-actions">
              <button className="terminal-ai-reset-btn" onClick={resetAIConversation} title="Reset conversation context">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10"></polyline>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                </svg>
                <span>Reset</span>
              </button>
              <button className="terminal-ai-close-btn" onClick={() => setShowAIPanel(false)} title="Close (Ctrl+Shift+E)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
          <div className="terminal-ai-body">
            <div className="terminal-ai-input-group">
              <label className="terminal-ai-label">Your draft prompt</label>
              <textarea
                ref={aiInputRef}
                className="terminal-ai-textarea"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleAIEnhance();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowAIPanel(false);
                  }
                }}
                placeholder="Type your rough prompt here... GPT will rewrite it for optimal Claude results."
                rows={3}
                spellCheck={false}
              />
              <button
                className="terminal-ai-enhance-btn"
                onClick={handleAIEnhance}
                disabled={aiLoading || !aiInput.trim()}
              >
                {aiLoading ? (
                  <>
                    <span className="terminal-ai-spinner" />
                    <span>Enhancing...</span>
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>Enhance (Ctrl+Enter)</span>
                  </>
                )}
              </button>
            </div>
            {aiError && (
              <div className="terminal-ai-error">{aiError}</div>
            )}
            {aiOutput && (
              <div className="terminal-ai-output-group">
                <label className="terminal-ai-label">Enhanced prompt</label>
                <div className="terminal-ai-output">{aiOutput}</div>
                <div className="terminal-ai-output-actions">
                  <button className="terminal-ai-replace-btn" onClick={replaceLineWithAIOutput} title="Clear current line and type the enhanced text">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 1l4 4-4 4"></path>
                      <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                      <path d="M7 23l-4-4 4-4"></path>
                      <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                    </svg>
                    <span>Replace Line</span>
                  </button>
                  <button className="terminal-ai-delete-btn" onClick={clearTerminalLine} title="Delete current line in terminal">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path>
                      <line x1="18" y1="9" x2="12" y2="15"></line>
                      <line x1="12" y1="9" x2="18" y2="15"></line>
                    </svg>
                    <span>Delete Line</span>
                  </button>
                  <button className="terminal-ai-send-btn" onClick={sendAIOutputToTerminal} title="Append enhanced text to terminal">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                    <span>Send</span>
                  </button>
                  <button className="terminal-ai-copy-btn" onClick={() => {
                    navigator.clipboard.writeText(aiOutput).catch(() => {});
                  }} title="Copy to clipboard">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Terminal container -- all xterm instances render here */}
      <div className="terminal-container-wrapper">
        <div className="terminal-container" ref={containerRef} />
        {showScrollBtn && (
          <button
            className="terminal-scroll-bottom-btn"
            onClick={scrollToBottom}
            title="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        )}
      </div>

      {/* Mobile touch control bar */}
      <div className="terminal-mobile-controls">
        <div className="terminal-ctrl-group">
          <button className="terminal-ctrl-btn" onTouchStart={(e) => { e.preventDefault(); sendKey('\x1b[A'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\x1b[A'); }} aria-label="Up">&#9650;</button>
          <button className="terminal-ctrl-btn" onTouchStart={(e) => { e.preventDefault(); sendKey('\x1b[B'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\x1b[B'); }} aria-label="Down">&#9660;</button>
          <button className="terminal-ctrl-btn" onTouchStart={(e) => { e.preventDefault(); sendKey('\x1b[D'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\x1b[D'); }} aria-label="Left">&#9664;</button>
          <button className="terminal-ctrl-btn" onTouchStart={(e) => { e.preventDefault(); sendKey('\x1b[C'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\x1b[C'); }} aria-label="Right">&#9654;</button>
        </div>
        <div className="terminal-ctrl-sep" />
        <div className="terminal-ctrl-group">
          <button className="terminal-ctrl-btn ctrl-label" onTouchStart={(e) => { e.preventDefault(); sendKey('\r'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\r'); }}>Enter</button>
          <button className="terminal-ctrl-btn ctrl-label" onTouchStart={(e) => { e.preventDefault(); sendKey('\t'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\t'); }}>Tab</button>
          <button className="terminal-ctrl-btn ctrl-label" onTouchStart={(e) => { e.preventDefault(); sendKey('\x1b'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\x1b'); }}>Esc</button>
        </div>
        <div className="terminal-ctrl-sep" />
        <div className="terminal-ctrl-group">
          <button className="terminal-ctrl-btn ctrl-label" onTouchStart={(e) => { e.preventDefault(); sendKey('\x03'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\x03'); }}>Ctrl+C</button>
          <button className="terminal-ctrl-btn ctrl-label" onTouchStart={(e) => { e.preventDefault(); sendKey('\x04'); }} onMouseDown={(e) => { e.preventDefault(); sendKey('\x04'); }}>Ctrl+D</button>
        </div>
        {speechSupported && (
          <>
            <div className="terminal-ctrl-sep" />
            <div className="terminal-ctrl-group">
              <button
                className={`terminal-ctrl-btn ctrl-label ${isListening ? 'speech-active' : ''}`}
                onTouchStart={(e) => { e.preventDefault(); toggleSpeech(); }}
                onMouseDown={(e) => { e.preventDefault(); toggleSpeech(); }}
              >
                {isListening ? '\u{1F534} Stop' : '\u{1F3A4} Mic'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
