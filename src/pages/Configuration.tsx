import { ClipboardEvent, KeyboardEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { FileCode, Settings, Save, Loader2, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

type SyntaxLanguage = 'cfg' | 'lua' | 'json' | 'html' | 'css' | 'js' | 'plain';

const tokenClassNames = {
  comment: 'text-zinc-500 italic',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  keyword: 'text-sky-300',
  boolean: 'text-violet-300',
  property: 'text-orange-300',
  function: 'text-cyan-300',
  variable: 'text-rose-300',
  tag: 'text-red-300',
  attribute: 'text-yellow-200',
  selector: 'text-orange-300',
  punctuation: 'text-zinc-500',
};

const cfgCommands = [
  'add_ace',
  'add_principal',
  'ensure',
  'exec',
  'endpoint_add_tcp',
  'endpoint_add_udp',
  'load_server_icon',
  'onesync',
  'refresh',
  'restart',
  'set',
  'setr',
  'sets',
  'start',
  'stop',
  'sv_endpointprivacy',
  'sv_enforcegamebuild',
  'sv_hostname',
  'sv_licensekey',
  'sv_maxclients',
  'sv_projectdesc',
  'sv_projectname',
  'sv_scriptHookAllowed',
];

const luaKeywords = [
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while',
];

const jsKeywords = [
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'let',
  'new',
  'return',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'while',
];

const cssAtRules = [
  'charset',
  'container',
  'font-face',
  'import',
  'keyframes',
  'layer',
  'media',
  'supports',
];

export default function Configuration() {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [initialContent, setInitialContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const language = useMemo(() => getLanguageFromFile(selectedFile), [selectedFile]);
  const highlightedContent = useMemo(() => highlightCode(content, language), [content, language]);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const data = await apiFetch('/config');
        setFiles(data.files || []);
        if (data.files && data.files.length > 0) {
          loadFile(data.files[0]);
        } else {
          setLoading(false);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load configuration files');
        setLoading(false);
      }
    };
    fetchFiles();
  }, []);

  const loadFile = async (filename: string) => {
    setLoading(true);
    setSelectedFile(filename);
    try {
      const data = await apiFetch(`/config?file=${encodeURIComponent(filename)}`);
      setContent(data.content || '');
      setInitialContent(data.content || '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to load ${filename}`);
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await apiFetch(`/config?file=${encodeURIComponent(selectedFile)}`, {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      setInitialContent(content);
      toast.success(`${selectedFile} saved successfully`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to save ${selectedFile}`);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = content !== initialContent;

  return (
    <div className="flex-1 flex flex-col w-full h-full p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-zinc-800/50 mb-6 gap-4">
        <div>
           <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Configuration</h1>
           <p className="text-sm text-zinc-500">Edit the active FiveM server.cfg used by your server</p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 min-h-0">
         {/* Sidebar for Files */}
         <div className="bg-[#111] border border-zinc-800 rounded-xl flex flex-col shadow-lg overflow-hidden shrink-0">
            <div className="p-4 border-b border-zinc-800 bg-zinc-900 flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" /> Core Configs
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
               {files.map((file) => (
                  <button 
                    key={file} 
                    onClick={() => loadFile(file)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors group ${
                      selectedFile === file 
                        ? 'bg-orange-600/10 text-orange-500 border border-orange-600/20' 
                        : 'text-zinc-400 hover:bg-zinc-900 border border-transparent'
                    }`}
                  >
                     <span className="flex items-center gap-2 text-sm font-mono tracking-tight">
                        <FileCode className={`h-4 w-4 ${selectedFile === file ? 'text-orange-500' : 'text-zinc-600 group-hover:text-zinc-400'}`} />
                        {file.split('/').pop()}
                     </span>
                     <ChevronRight className={`h-3 w-3 ${selectedFile === file ? 'text-orange-500' : 'text-zinc-600'} opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1`} />
                  </button>
               ))}
               {files.length === 0 && !loading && (
                 <div className="text-center p-4 text-xs text-zinc-500">No configs found</div>
               )}
            </div>
         </div>

         {/* Editor Interface */}
         <div className="bg-[#0a0a0a] border border-zinc-800 rounded-xl flex flex-col shadow-lg overflow-hidden min-h-[400px]">
            <div className="bg-[#111] border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <FileCode className="h-3.5 w-3.5 text-zinc-400" />
                 <span className="text-xs font-mono font-medium text-zinc-300">{selectedFile || 'Select a file'}</span>
                 <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                   {language}
                 </span>
               </div>
               
               <button 
                onClick={saveFile}
                disabled={!hasChanges || saving}
                className="flex items-center gap-2 px-3 py-1.5 bg-orange-600/10 text-orange-500 border border-orange-600/20 rounded font-bold text-xs uppercase tracking-wider hover:bg-orange-600/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
               >
                 {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                 Save File
               </button>
            </div>
            
            <div className="flex-1 relative">
               {loading ? (
                 <div className="absolute inset-0 flex items-center justify-center">
                   <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                 </div>
               ) : (
                 <CodeEditor
                   value={content}
                   highlightedValue={highlightedContent}
                   onChange={setContent}
                   disabled={saving}
                 />
               )}
            </div>
         </div>
      </div>
    </div>
  );
}

function CodeEditor({
  value,
  highlightedValue,
  onChange,
  disabled,
}: {
  value: string;
  highlightedValue: ReactNode[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const editorRef = useRef<HTMLPreElement>(null);
  const selectionOffsetRef = useRef<number | null>(null);
  const [activeLine, setActiveLine] = useState(1);
  const [selectedLineRange, setSelectedLineRange] = useState({ start: 1, end: 1 });
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(1, value.split('\n').length) }, (_, index) => index + 1),
    [value],
  );

  useLayoutEffect(() => {
    const editor = editorRef.current;

    if (editor && selectionOffsetRef.current !== null) {
      restoreSelectionOffset(editor, selectionOffsetRef.current);
      selectionOffsetRef.current = null;
    }
  }, [highlightedValue]);

  useEffect(() => {
    const handleSelectionChange = () => updateSelectedLines();

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [value]);

  const handleInput = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const selectionOffset = getSelectionOffset(editor);
    selectionOffsetRef.current = selectionOffset;
    setActiveLine(getLineNumberFromOffset(value, selectionOffset));
    updateSelectedLines();
    onChange(getEditableText(editor));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLPreElement>) => {
    if (event.key !== 'Tab') {
      requestAnimationFrame(updateActiveLine);
      return;
    }

    event.preventDefault();
    document.execCommand('insertText', false, '  ');
    handleInput();
  };

  const handlePaste = (event: ClipboardEvent<HTMLPreElement>) => {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    handleInput();
  };

  const updateActiveLine = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const editorText = getEditableText(editor);
    const selectionOffset = getSelectionOffset(editor);

    setActiveLine(getLineNumberFromOffset(editorText, selectionOffset));
    updateSelectedLines();
  };

  const updateSelectedLines = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const range = getSelectionLineRange(editor);
    if (!range) return;

    setActiveLine(range.end);
    setSelectedLineRange(range);
  };

  return (
    <div className="absolute inset-0 overflow-auto bg-[#070707] font-mono text-[13px] leading-relaxed">
      <div className="flex min-h-full w-max min-w-full items-stretch">
        <div
          aria-hidden="true"
          className="sticky left-0 z-10 select-none border-r border-zinc-900 bg-[#070707] py-4 pl-3 pr-3 text-right text-zinc-600"
        >
          {lineNumbers.map((lineNumber) => (
            <div
              key={lineNumber}
              className={`rounded px-1 transition-colors duration-75 ${getLineNumberClassName(lineNumber, activeLine, selectedLineRange)}`}
            >
              {lineNumber}
            </div>
          ))}
        </div>
        <pre
          ref={editorRef}
          className="min-h-full min-w-0 flex-1 whitespace-pre py-4 pl-4 pr-4 text-zinc-300 caret-orange-300 selection:bg-orange-500/25 focus:outline-none focus:ring-0"
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-label="Config file content"
          aria-multiline="true"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={updateActiveLine}
          onKeyUp={updateActiveLine}
          onPaste={handlePaste}
        >
          <code>{highlightedValue.length ? highlightedValue : <span>&nbsp;</span>}</code>
        </pre>
      </div>
    </div>
  );
}

function getEditableText(element: HTMLElement) {
  return getNodeText(element).replace(/\u00a0/g, ' ');
}

function getNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node instanceof HTMLBRElement) {
    return '\n';
  }

  let text = '';
  node.childNodes.forEach((child, index) => {
    if (index > 0 && child instanceof HTMLDivElement) {
      text += '\n';
    }

    text += getNodeText(child);
  });

  return text;
}

function getSelectionOffset(element: HTMLElement) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return 0;
  }

  const range = selection.getRangeAt(0);
  const leadingRange = range.cloneRange();
  leadingRange.selectNodeContents(element);
  leadingRange.setEnd(range.endContainer, range.endOffset);

  return leadingRange.toString().length;
}

function getSelectionLineRange(element: HTMLElement) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    return null;
  }

  const editorText = getEditableText(element);
  const startOffset = getOffsetForRangeBoundary(element, range.startContainer, range.startOffset);
  const endOffset = getOffsetForRangeBoundary(element, range.endContainer, range.endOffset);
  const startLine = getLineNumberFromOffset(editorText, Math.min(startOffset, endOffset));
  const endLine = getLineNumberFromOffset(editorText, Math.max(startOffset, endOffset));

  return { start: startLine, end: endLine };
}

function getOffsetForRangeBoundary(element: HTMLElement, container: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(container, offset);

  return range.toString().length;
}

function getLineNumberFromOffset(text: string, offset: number) {
  return text.slice(0, Math.max(0, offset)).split('\n').length;
}

function getLineNumberClassName(
  lineNumber: number,
  activeLine: number,
  selectedLineRange: { start: number; end: number },
) {
  if (lineNumber === activeLine) {
    return 'bg-zinc-800/80 text-white';
  }

  if (lineNumber >= selectedLineRange.start && lineNumber <= selectedLineRange.end) {
    return 'bg-zinc-900 text-white';
  }

  return 'text-zinc-600';
}

function restoreSelectionOffset(element: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textLength = currentNode.textContent?.length || 0;

    if (currentOffset + textLength >= offset) {
      const range = document.createRange();
      range.setStart(currentNode, Math.max(0, offset - currentOffset));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    currentOffset += textLength;
    currentNode = walker.nextNode();
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getLanguageFromFile(filename: string | null): SyntaxLanguage {
  const file = filename?.toLowerCase() || '';

  if (file.endsWith('.cfg') || file.endsWith('.conf')) return 'cfg';
  if (file.endsWith('.lua') || file.endsWith('fxmanifest.lua') || file.endsWith('__resource.lua')) return 'lua';
  if (file.endsWith('.json')) return 'json';
  if (file.endsWith('.html') || file.endsWith('.htm')) return 'html';
  if (file.endsWith('.css')) return 'css';
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs') || file.endsWith('.ts')) return 'js';

  return 'plain';
}

function highlightCode(code: string, language: SyntaxLanguage): ReactNode[] {
  if (!code) return [];

  switch (language) {
    case 'cfg':
      return highlightCfg(code);
    case 'lua':
      return highlightRegex(code, [
        [/--.*$/gm, tokenClassNames.comment],
        [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, tokenClassNames.string],
        [new RegExp(`\\b(${luaKeywords.join('|')})\\b`, 'g'), tokenClassNames.keyword],
        [/\b(?:RegisterCommand|RegisterNetEvent|AddEventHandler|TriggerClientEvent|TriggerServerEvent|CreateThread|Citizen\.CreateThread|exports)\b/g, tokenClassNames.function],
        [/\b\d+(?:\.\d+)?\b/g, tokenClassNames.number],
      ]);
    case 'json':
      return highlightRegex(code, [
        [/"(?:\\.|[^"\\])*"(?=\s*:)/g, tokenClassNames.property],
        [/"(?:\\.|[^"\\])*"/g, tokenClassNames.string],
        [/\b(?:true|false|null)\b/g, tokenClassNames.boolean],
        [/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, tokenClassNames.number],
        [/[[\]{}:,]/g, tokenClassNames.punctuation],
      ]);
    case 'html':
      return highlightRegex(code, [
        [/<!--[\s\S]*?-->/g, tokenClassNames.comment],
        [/<\/?[a-z][\w:-]*/gi, tokenClassNames.tag],
        [/\s[a-z_:][\w:.-]*(?==)/gi, tokenClassNames.attribute],
        [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, tokenClassNames.string],
        [/[<>/]/g, tokenClassNames.punctuation],
      ]);
    case 'css':
      return highlightRegex(code, [
        [/\/\*[\s\S]*?\*\//g, tokenClassNames.comment],
        [new RegExp(`@(?:${cssAtRules.join('|')})\\b`, 'g'), tokenClassNames.keyword],
        [/#[\w-]+|\.[\w-]+|[a-z][\w-]*(?=\s*[{,])/gi, tokenClassNames.selector],
        [/[a-z-]+(?=\s*:)/gi, tokenClassNames.property],
        [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, tokenClassNames.string],
        [/\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms)?\b/gi, tokenClassNames.number],
      ]);
    case 'js':
      return highlightRegex(code, [
        [/\/\*[\s\S]*?\*\/|\/\/.*$/gm, tokenClassNames.comment],
        [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, tokenClassNames.string],
        [new RegExp(`\\b(${jsKeywords.join('|')})\\b`, 'g'), tokenClassNames.keyword],
        [/\b(?:true|false|null|undefined)\b/g, tokenClassNames.boolean],
        [/\b[A-Za-z_$][\w$]*(?=\s*\()/g, tokenClassNames.function],
        [/\b\d+(?:\.\d+)?\b/g, tokenClassNames.number],
      ]);
    default:
      return [code];
  }
}

function highlightCfg(code: string): ReactNode[] {
  const commandPattern = new RegExp(`^\\s*(${cfgCommands.join('|')})\\b`, 'gim');

  return highlightRegex(code, [
    [/#.*$|\/\/.*$/gm, tokenClassNames.comment],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, tokenClassNames.string],
    [commandPattern, tokenClassNames.keyword],
    [/\b(?:true|false|on|off|yes|no)\b/gi, tokenClassNames.boolean],
    [/\b(?:resource|group|identifier|steam|license|discord|builtin\.everyone|admin|god)\.[\w:.-]+\b/gi, tokenClassNames.variable],
    [/\b\d+(?:\.\d+)?\b/g, tokenClassNames.number],
  ]);
}

function highlightRegex(
  code: string,
  rules: Array<[RegExp, string]>,
): ReactNode[] {
  const matches: Array<{ start: number; end: number; className: string }> = [];

  rules.forEach(([pattern, className]) => {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(code)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (start === end) {
        regex.lastIndex += 1;
        continue;
      }

      if (!matches.some((existing) => start < existing.end && end > existing.start)) {
        matches.push({ start, end, className });
      }
    }
  });

  matches.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    if (match.start > cursor) {
      nodes.push(code.slice(cursor, match.start));
    }

    nodes.push(
      <span className={match.className} key={`${match.start}-${match.end}-${index}`}>
        {code.slice(match.start, match.end)}
      </span>,
    );
    cursor = match.end;
  });

  if (cursor < code.length) {
    nodes.push(code.slice(cursor));
  }

  return nodes;
}
