import { useState, useEffect } from 'react';
import { Database as DbIcon, Search, LayoutList, Terminal, ChevronRight, Loader2, Play } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';

export default function Database() {
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTable, setSearchTable] = useState('');
  
  const [query, setQuery] = useState('');
  const [executing, setExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<{ columns?: string[], rows?: any[], affectedRows?: number, error?: string, message?: string } | null>(null);

  useEffect(() => {
    fetchTables();
  }, []);

  const fetchTables = async () => {
    try {
      const data = await apiFetch('/db/tables');
      setTables(data.tables || []);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  const handleTableClick = (table: string) => {
    setQuery(`SELECT * FROM ${table} LIMIT 50;`);
  };

  const handleExecute = async () => {
    if (!query.trim()) return;
    setExecuting(true);
    setQueryResult(null);
    try {
      const res = await apiFetch('/db/query', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      setQueryResult(res);
      if (res.error) {
        toast.error('Query execution failed');
      } else {
        toast.success('Query executed successfully');
      }
    } catch (err: any) {
      setQueryResult({ error: err.message || 'Failed to execute query' });
      toast.error('Query execution failed');
    } finally {
      setExecuting(false);
    }
  };

  const displayTables = (tables.length > 0 ? tables : ['users', 'owned_vehicles', 'characters', 'addon_inventory', 'addon_account', 'datastore']).filter(t => t.toLowerCase().includes(searchTable.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col w-full h-full p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-zinc-800/50 mb-6 gap-4">
        <div>
           <h1 className="text-2xl font-bold tracking-tight text-white mb-1">MariaDB Explorer</h1>
           <p className="text-sm text-zinc-500">Direct database administration interface</p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 min-h-0">
         {/* Sidebar for Tables */}
         <div className="bg-[#111] border border-zinc-800 rounded-xl flex flex-col shadow-lg overflow-hidden shrink-0">
            <div className="p-3 border-b border-zinc-800">
               <div className="relative">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                 <input 
                    type="text" 
                    placeholder="Search tables..."
                    value={searchTable}
                    onChange={(e) => setSearchTable(e.target.value)}
                    className="pl-9 pr-3 py-2 w-full bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                 />
               </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px]">
               {displayTables.map((table) => (
                  <button 
                    key={table} 
                    onClick={() => handleTableClick(table)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-zinc-900 transition-colors group"
                  >
                     <span className="flex items-center gap-2 text-zinc-400 group-hover:text-zinc-200">
                        <LayoutList className="h-3.5 w-3.5 text-zinc-600 group-hover:text-orange-500 transition-colors" />
                        {table}
                     </span>
                     <ChevronRight className="h-3 w-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
                  </button>
               ))}
               {displayTables.length === 0 && (
                 <div className="text-center p-4 text-zinc-500">No tables found</div>
               )}
            </div>
         </div>

         {/* Query Interface */}
         <div className="bg-[#111] border border-zinc-800 rounded-xl flex flex-col shadow-lg overflow-hidden min-h-[400px]">
            <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2.5 flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <Terminal className="h-3.5 w-3.5 text-orange-500" />
                 <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300">SQL Query Interface</span>
               </div>
               
               <button 
                 onClick={handleExecute}
                 disabled={executing || !query.trim()}
                 className="flex items-center gap-2 px-3 py-1.5 bg-orange-600/10 text-orange-500 border border-orange-600/20 rounded font-bold text-xs uppercase tracking-wider hover:bg-orange-600/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  {executing ? <Loader2 className="h-3 w-3 animate-spin"/> : <Play className="h-3 w-3" />} Execute
               </button>
            </div>
            
            <div className="p-0 border-b border-zinc-800 bg-[#0a0a0a] min-h-[120px] relative">
               <textarea 
                  className="w-full h-32 bg-transparent border-none p-4 font-mono text-[13px] leading-relaxed text-blue-400 focus:outline-none focus:ring-0 resize-none placeholder-zinc-700"
                  placeholder="SELECT * FROM users LIMIT 10;"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
               ></textarea>
            </div>

            <div className="flex-1 overflow-auto bg-black/40 relative">
               {!queryResult ? (
                 <div className="absolute inset-0 flex items-center justify-center text-zinc-600 flex-col gap-4">
                    <DbIcon className="h-10 w-10 opacity-20" />
                    <p className="text-xs font-mono uppercase tracking-widest text-zinc-500">Awaiting Query Execution...</p>
                 </div>
               ) : (
                 <div className="p-4">
                   {queryResult.error ? (
                     <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                       <h3 className="text-red-500 text-sm font-bold mb-1">Execution Error</h3>
                       <p className="text-red-400 text-xs font-mono">{queryResult.error}</p>
                     </div>
                   ) : queryResult.rows && queryResult.columns ? (
                     <div className="overflow-x-auto rounded-lg border border-zinc-800">
                       <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                         <thead>
                           <tr className="bg-zinc-900 border-b border-zinc-800 text-xs font-bold uppercase tracking-wider text-zinc-400">
                             {queryResult.columns.map((col, idx) => (
                               <th key={idx} className="px-4 py-3 border-r border-zinc-800 last:border-0">{col}</th>
                             ))}
                           </tr>
                         </thead>
                         <tbody className="divide-y divide-zinc-800 font-mono text-[12px]">
                           {queryResult.rows.map((row, rIdx) => (
                             <tr key={rIdx} className="hover:bg-zinc-900/50 transition-colors">
                               {queryResult.columns!.map((col, cIdx) => (
                                 <td key={cIdx} className="px-4 py-3 border-r border-zinc-800/50 last:border-0 text-zinc-300">
                                   {row[col] !== null ? String(row[col]) : <span className="text-zinc-600 italic">NULL</span>}
                                 </td>
                               ))}
                             </tr>
                           ))}
                           {queryResult.rows.length === 0 && (
                             <tr className="hover:bg-zinc-900/50">
                               <td colSpan={queryResult.columns.length} className="px-4 py-8 text-center text-zinc-500">
                                 No results found.
                               </td>
                             </tr>
                           )}
                         </tbody>
                       </table>
                     </div>
                   ) : (
                     <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                       <h3 className="text-green-500 text-sm font-bold mb-1">Success</h3>
                       <p className="text-green-400 text-xs">{queryResult.message || `Affected rows: ${queryResult.affectedRows || 0}`}</p>
                     </div>
                   )}
                 </div>
               )}
            </div>
         </div>
      </div>
    </div>
  );
}
