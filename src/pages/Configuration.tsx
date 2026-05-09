import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { FileCode, Settings, Save, Loader2, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

export default function Configuration() {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [initialContent, setInitialContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        toast.error('Failed to load configuration files');
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
      toast.error(`Failed to load ${filename}`);
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
      toast.error(`Failed to save ${selectedFile}`);
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
           <p className="text-sm text-zinc-500">Manage environment, config files, and server properties</p>
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
                 <textarea 
                    className="w-full h-full bg-transparent border-none p-4 font-mono text-[13px] leading-relaxed text-zinc-300 focus:outline-none focus:ring-0 resize-none placeholder-zinc-700"
                    placeholder="File content..."
                    spellCheck={false}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    disabled={saving}
                 ></textarea>
               )}
            </div>
         </div>
      </div>
    </div>
  );
}
