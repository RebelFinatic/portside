import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { ArrowDown, Terminal, Copy, Command, Filter, Save, Bookmark } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface FilterPreset {
  name: string;
  level: string;
  source: string;
}

const fivemColorClasses: Record<string, string> = {
  '0': 'text-black',
  '1': 'text-red-400',
  '2': 'text-green-400',
  '3': 'text-yellow-300',
  '4': 'text-blue-400',
  '5': 'text-cyan-300',
  '6': 'text-purple-400',
  '7': 'text-zinc-300',
  '8': 'text-orange-400',
  '9': 'text-zinc-400',
};

const ansiColorClasses: Record<string, string> = {
  '30': 'text-black',
  '31': 'text-red-400',
  '32': 'text-green-400',
  '33': 'text-yellow-300',
  '34': 'text-blue-400',
  '35': 'text-purple-400',
  '36': 'text-cyan-300',
  '37': 'text-zinc-300',
  '90': 'text-zinc-500',
  '91': 'text-red-300',
  '92': 'text-green-300',
  '93': 'text-yellow-200',
  '94': 'text-blue-300',
  '95': 'text-purple-300',
  '96': 'text-cyan-200',
  '97': 'text-white',
};

interface ConsoleSegment {
  text: string;
  className: string;
  style?: React.CSSProperties;
}

const ansi256Color = (code: number) => {
  if (code >= 16 && code <= 231) {
    const value = code - 16;
    const r = Math.floor(value / 36);
    const g = Math.floor((value % 36) / 6);
    const b = value % 6;
    const channel = (part: number) => part === 0 ? 0 : 55 + part * 40;
    return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
  }

  if (code >= 232 && code <= 255) {
    const shade = 8 + (code - 232) * 10;
    return `rgb(${shade}, ${shade}, ${shade})`;
  }

  return null;
};

const parseConsoleMessage = (message: string): ConsoleSegment[] => {
  const segments: ConsoleSegment[] = [];
  let currentClass = 'text-zinc-300';
  let currentStyle: React.CSSProperties | undefined;
  let buffer = '';
  let index = 0;

  const pushBuffer = () => {
    if (!buffer) return;
    segments.push({text: buffer, className: currentClass, style: currentStyle});
    buffer = '';
  };

  while (index < message.length) {
    const char = message[index];

    if (char === '^' && index + 1 < message.length) {
      const code = message[index + 1];

      if (fivemColorClasses[code]) {
        pushBuffer();
        currentClass = fivemColorClasses[code];
        index += 2;
        continue;
      }
    }

    if (char === '\u001b') {
      const match = message.slice(index).match(/^\u001b\[([0-9;]*)m/);
      if (match) {
        pushBuffer();
        const codes = match[1].split(';').filter(Boolean);
        if (codes.includes('0')) {
          currentClass = 'text-zinc-300';
          currentStyle = undefined;
        }

        const extendedColorIndex = codes.findIndex((code, codeIndex) => (
          code === '38' && codes[codeIndex + 1] === '5' && Number.isFinite(Number(codes[codeIndex + 2]))
        ));
        if (extendedColorIndex !== -1) {
          const color = ansi256Color(Number(codes[extendedColorIndex + 2]));
          if (color) {
            currentClass = '';
            currentStyle = { color };
          }
        }

        const colorCode = [...codes].reverse().find(code => ansiColorClasses[code]);
        if (colorCode) {
          currentClass = ansiColorClasses[colorCode];
          currentStyle = undefined;
        }

        index += match[0].length;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }

  pushBuffer();
  return segments.length ? segments : [{text: message, className: 'text-zinc-300'}];
};

function ConsoleMessage({message}: {message: string}) {
  const lines = message.split(/\r?\n/);

  return (
    <span className="break-words whitespace-pre-wrap">
      {lines.map((line, lineIndex) => (
        <React.Fragment key={lineIndex}>
          {lineIndex > 0 ? <br /> : null}
          {parseConsoleMessage(line).map((segment, segmentIndex) => (
            <span key={`${lineIndex}-${segmentIndex}`} className={segment.className} style={segment.style}>
              {segment.text}
            </span>
          ))}
        </React.Fragment>
      ))}
    </span>
  );
}

export default function Console() {
  const [logs, setLogs] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const token = useAuthStore(state => state.token);
  
  const [presets, setPresets] = useState<FilterPreset[]>([
    { name: 'Errors Only', level: 'ERROR', source: 'ALL' },
    { name: 'System Logs', level: 'ALL', source: 'system' }
  ]);
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [isFollowingTail, setIsFollowingTail] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  const outputRef = useRef<HTMLDivElement>(null);
  const endOfLogsRef = useRef<HTMLDivElement>(null);
  const shouldFollowTailRef = useRef(true);
  const lastScrollHeightRef = useRef(0);
  const programmaticScrollRef = useRef(false);

  const uniqueLevels = useMemo(() => {
    const levels = new Set(logs.map(l => l.level));
    return ['ALL', ...Array.from(levels)];
  }, [logs]);

  const uniqueSources = useMemo(() => {
    const sources = new Set(logs.map(l => l.source));
    return ['ALL', ...Array.from(sources)];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchLevel = levelFilter === 'ALL' || log.level === levelFilter;
      const matchSource = sourceFilter === 'ALL' || log.source === sourceFilter;
      return matchLevel && matchSource;
    });
  }, [logs, levelFilter, sourceFilter]);

  const fetchLogs = async () => {
    try {
      const [runtimeLogs, actionLogs, history] = await Promise.all([
        apiFetch('/logs?type=fxserver&limit=250'),
        apiFetch('/admin-logs').catch(() => []),
        apiFetch('/console/history').catch(() => []),
      ]);
      if (Array.isArray(history)) {
        setCommandHistory([...history].reverse().map((item: any) => item.command).filter(Boolean));
      }
      const actionLogEntries = Array.isArray(actionLogs)
        ? actionLogs.map((log: any) => ({
          id: log.id,
          timestamp: log.timestamp,
          level: log.status === 'denied' ? 'WARN' : 'INFO',
          source: 'admin',
          message: `${log.actorUsername || 'system'} ${log.action}${log.permission ? ` (${log.permission})` : ''}`,
        }))
        : [];
      setLogs([...runtimeLogs, ...actionLogEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
    } catch {
      // silent fail for polling
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime?rooms=logs&token=${encodeURIComponent(token)}`);
    socket.addEventListener('open', () => setWsConnected(true));
    socket.addEventListener('close', () => setWsConnected(false));
    socket.addEventListener('error', () => setWsConnected(false));
    socket.addEventListener('message', event => {
      try {
        const data = JSON.parse(event.data);
        const payload = Array.isArray(data.payload) ? data.payload : [];
        const fxLogs = payload.filter((log: any) => !log.family || log.family === 'fxserver');
        if (fxLogs.length > 0) {
          setLogs(prev => [...prev, ...fxLogs].slice(-500));
        }
      } catch {
        // Ignore malformed realtime messages.
      }
    });
    return () => {
      setWsConnected(false);
      socket.close();
    };
  }, [token]);

  const scrollToLatest = (behavior: ScrollBehavior = 'auto') => {
    programmaticScrollRef.current = true;
    endOfLogsRef.current?.scrollIntoView({ behavior });
    window.setTimeout(() => {
      programmaticScrollRef.current = false;
      const output = outputRef.current;
      if (output) lastScrollHeightRef.current = output.scrollHeight;
    }, behavior === 'smooth' ? 250 : 0);
  };

  const isViewingLatest = () => {
    const output = outputRef.current;
    const endOfLogs = endOfLogsRef.current;
    if (!output || !endOfLogs) return false;

    const distanceToLatest = endOfLogs.offsetTop - output.scrollTop - output.clientHeight;
    return distanceToLatest <= 80;
  };

  useLayoutEffect(() => {
    const output = outputRef.current;
    if (!output) return;

    if (shouldFollowTailRef.current) {
      scrollToLatest('auto');
      return;
    }

    lastScrollHeightRef.current = output.scrollHeight;
  }, [filteredLogs.length]);

  const handleOutputScroll = () => {
    const output = outputRef.current;
    if (!output) return;

    const scrollHeightChanged = output.scrollHeight !== lastScrollHeightRef.current;
    if (scrollHeightChanged && shouldFollowTailRef.current) {
      scrollToLatest('auto');
      return;
    }

    if (programmaticScrollRef.current) {
      lastScrollHeightRef.current = output.scrollHeight;
      return;
    }

    const nextIsFollowingTail = isViewingLatest();
    shouldFollowTailRef.current = nextIsFollowingTail;
    lastScrollHeightRef.current = output.scrollHeight;
    setIsFollowingTail(nextIsFollowingTail);
  };

  const jumpToLatest = () => {
    shouldFollowTailRef.current = true;
    setIsFollowingTail(true);
    scrollToLatest('smooth');
  };

  const savePreset = () => {
    if (!newPresetName.trim()) return;
    setPresets(prev => [...prev, { name: newPresetName.trim(), level: levelFilter, source: sourceFilter }]);
    toast.success(`Preset "${newPresetName}" saved`);
    setNewPresetName('');
    setPresetModalOpen(false);
  };

  const loadPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const presetName = e.target.value;
    if (!presetName) return;
    const preset = presets.find(p => p.name === presetName);
    if (preset) {
      setLevelFilter(preset.level);
      setSourceFilter(preset.source);
      toast.info(`Loaded preset: ${preset.name}`);
    }
  };

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    const submittedCommand = input.trim();
    shouldFollowTailRef.current = true;
    setIsFollowingTail(true);
    
    // Optimistic custom log to local array
    setLogs(prev => [...prev, {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      level: 'COMMAND',
      source: 'admin',
      message: submittedCommand,
    }]);

    setCommandHistory(prev => [...prev, submittedCommand]);
    setHistoryIndex(-1);
    setInput('');

    try {
      const result = await apiFetch('/console/command', {
        method: 'POST',
        body: JSON.stringify({command: submittedCommand}),
      });

      toast.success('Command sent through RCON', {
        description: result.output || submittedCommand,
      });
      fetchLogs();
    } catch (error: any) {
      toast.error('RCON command failed', {
        description: error.message || submittedCommand,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      
      let newIndex = historyIndex;
      if (newIndex === -1) {
        newIndex = commandHistory.length - 1;
      } else if (newIndex > 0) {
        newIndex -= 1;
      }
      
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      
      let newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
    }
  };

  const copyVisibleLogs = async () => {
    const text = filteredLogs
      .map(log => `[${log.timestamp}] [${log.level}] [${log.source}] ${log.message}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    toast.success('Copied visible logs');
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ERROR': return 'text-red-400';
      case 'WARN': return 'text-yellow-400';
      case 'COMMAND': return 'text-purple-400';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full p-6">
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Live Console</h1>
            <p className="text-sm text-zinc-500">Direct server standard output</p>
          </div>
          <button onClick={copyVisibleLogs} className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-xs font-bold text-white transition-colors hover:bg-zinc-700">
            <Copy className="h-3 w-3" /> COPY
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col bg-[#111] rounded-xl border border-zinc-800 overflow-hidden">
        {/* Hardware details top bar */}
        <div className="p-3 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center flex-wrap gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5" /> Real-time Console Stream
            <span
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-widest ${
                isFollowingTail
                  ? wsConnected
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-500'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isFollowingTail && wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
              {isFollowingTail ? (wsConnected ? 'LIVE' : 'POLLING') : 'PAUSED'}
            </span>
          </span>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Bookmark className="h-3.5 w-3.5 text-zinc-500" />
              <select
                style={{ colorScheme: 'dark' }}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-orange-500 appearance-none cursor-pointer max-w-[120px]"
                onChange={loadPreset}
                value=""
              >
                <option value="" disabled className="bg-zinc-900 text-zinc-300">Load Preset...</option>
                {presets.map(p => (
                  <option key={p.name} value={p.name} className="bg-zinc-900 text-zinc-300">{p.name}</option>
                ))}
              </select>
            </div>
            
            <div className="w-px h-4 bg-zinc-800 mx-1"></div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Level:
              </span>
              <select
                style={{ colorScheme: 'dark' }}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-orange-500 appearance-none cursor-pointer"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
              >
                {uniqueLevels.map(level => (
                  <option key={level} value={level} className="bg-zinc-900 text-zinc-300">{level as string}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Source:</span>
              <select
                style={{ colorScheme: 'dark' }}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-orange-500 appearance-none cursor-pointer"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                {uniqueSources.map(source => (
                  <option key={source} value={source} className="bg-zinc-900 text-zinc-300">{source as string}</option>
                ))}
              </select>
            </div>
            
            <button 
              onClick={() => setPresetModalOpen(true)}
              className="ml-2 flex items-center gap-1.5 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-[10px] uppercase font-bold text-zinc-300 transition-colors"
            >
              <Save className="h-3 w-3" /> Save Preset
            </button>
            <div className="flex gap-2 mx-2 hidden sm:flex">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/30 border border-red-500/50"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/30 border border-yellow-500/50"></span>
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/30 border border-green-500/50"></span>
            </div>
          </div>
        </div>

        {/* Output Area */}
        <div className="relative flex-1 min-h-0 bg-black/40">
          {!isFollowingTail && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-3 right-4 z-10 flex items-center gap-2 rounded border border-orange-500/40 bg-orange-600 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-lg shadow-black/40 transition-colors hover:bg-orange-500"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Latest
            </button>
          )}
          <div
            ref={outputRef}
            onScroll={handleOutputScroll}
            className="absolute inset-0 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed"
          >
            {filteredLogs.map((log) => (
              <div key={log.id} className="flex gap-4 hover:bg-zinc-900/50 px-2 py-0.5 rounded transition-colors group">
                <span className="text-zinc-500 shrink-0">[{format(new Date(log.timestamp), 'HH:mm:ss')}]</span>
                <span className={`w-16 shrink-0 font-bold ${getLevelColor(log.level)}`}>{log.level}</span>
                <span className="text-zinc-500 w-20 shrink-0 truncate">[{log.source}]</span>
                <ConsoleMessage message={log.message} />
              </div>
            ))}
            <div className="text-zinc-500 text-white animate-pulse mt-2 px-2">_</div>
            <div ref={endOfLogsRef} />
            <div className="h-10" />
          </div>
        </div>

        {/* Input Form */}
        <form onSubmit={handleCommand} className="p-3 bg-zinc-900/50 border-t border-zinc-800">
           <div className="relative">
             <Command className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 shrink-0 transition-all duration-300 ${input.trim().length > 0 ? 'text-orange-400 drop-shadow-[0_0_8px_rgba(249,115,22,0.8)] scale-110' : 'text-zinc-500'}`} />
             <input 
               type="text" 
               value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={handleKeyDown}
               placeholder="Execute command..."
               className="w-full bg-transparent border-none text-xs text-white focus:outline-none focus:ring-0 font-mono pl-9 transition-colors placeholder-zinc-600"
               autoFocus
             />
           </div>
        </form>
      </div>

      {/* Preset Modal */}
      {presetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#111] border border-zinc-800 rounded-xl w-full max-w-sm shadow-2xl flex flex-col shrink-0">
            <div className="p-4 border-b border-zinc-800">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Save className="w-4 h-4 text-orange-500" /> Save Filter Preset
              </h2>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Preset Name</label>
                <input
                  type="text"
                  autoFocus
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500"
                  placeholder="e.g. Critical Errors"
                />
              </div>
              <div className="bg-black/20 p-3 rounded border border-zinc-800/50 text-xs text-zinc-400 space-y-1">
                <p><strong>Level:</strong> {levelFilter}</p>
                <p><strong>Source:</strong> {sourceFilter}</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                 <button 
                  onClick={() => setPresetModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white"
                 >Cancel</button>
                 <button 
                  onClick={savePreset}
                  disabled={!newPresetName.trim()}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs font-bold disabled:opacity-50"
                 >Save Preset</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
