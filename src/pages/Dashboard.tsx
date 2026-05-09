import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, BarChart, Bar, Legend } from 'recharts';
import { Server, Users, Activity, Clock, Cpu, HardDrive, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';

export default function Dashboard() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [graphData, setGraphData] = useState<any[]>([]);
  const [playerHistory, setPlayerHistory] = useState<any[]>([]);
  const [errorTrends, setErrorTrends] = useState<any[]>([]);

  useEffect(() => {
    // Generate initial flat data
    const initialData = Array.from({ length: 20 }).map((_, i) => ({
      name: i.toString(),
      cpu: 0,
       ram: 0,
    }));
    setGraphData(initialData);

    // Generate mock historical data for players (last 24h)
    const history = Array.from({ length: 24 }).map((_, i) => ({
      time: `${i}:00`,
      players: Math.floor(Math.random() * 40) + 10,
      peak: Math.floor(Math.random() * 60) + 20
    }));
    setPlayerHistory(history);

    // Generate mock error trends
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const errors = days.map(day => ({
      day,
      warnings: Math.floor(Math.random() * 30),
      errors: Math.floor(Math.random() * 8)
    }));
    setErrorTrends(errors);

    const fetchStatus = async () => {
      try {
        const data = await apiFetch('/server/status');
        setStatus(data);
        
        // Update graph data
        setGraphData(prev => {
          const newArr = [...prev.slice(1), { name: Date.now().toString(), cpu: data.cpuUsage, ram: data.memoryUsage }];
          return newArr;
        });
        
        setLoading(false);
      } catch (err) {
        toast.error('Failed to fetch server status');
        setLoading(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000); // Polling every 3s
    return () => clearInterval(interval);
  }, []);

  if (loading && !status) return <div className="p-8 flex justify-center"><Activity className="animate-spin text-[#FF4E00]" /></div>;

  return (
    <div className="flex-1 flex flex-col relative w-full h-full p-6 lg:p-8 overflow-y-auto overflow-x-hidden">
      <div className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white m-0">Analytics Dashboard</h1>
        <p className="text-sm text-zinc-500 m-0">Real-time metrics and historical trends</p>
      </div>

      {/* Primary Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 flex items-center shadow-sm">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <Users className="h-5 w-5" />
          </div>
          <div className="ml-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">Players</p>
            <div className="flex items-baseline">
              <h3 className="text-2xl font-semibold text-white">{status?.players || 0}</h3>
              <span className="ml-1.5 text-xs text-zinc-500 font-medium">/ {status?.maxPlayers || 64}</span>
            </div>
          </div>
        </div>

        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 flex items-center shadow-sm">
          <div className="p-3 rounded-xl bg-orange-600/10 text-orange-500 border border-orange-600/20">
            <Cpu className="h-5 w-5" />
          </div>
          <div className="ml-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">CPU Usage</p>
            <div className="flex items-baseline">
              <h3 className="text-2xl font-semibold text-white">{status?.cpuUsage || 0}</h3>
              <span className="ml-1 text-xs font-mono text-zinc-500">%</span>
            </div>
          </div>
        </div>

        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 flex items-center shadow-sm">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <HardDrive className="h-5 w-5" />
          </div>
          <div className="ml-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">Memory</p>
            <div className="flex items-baseline">
              <h3 className="text-2xl font-semibold text-white">{status?.memoryUsage || 0}</h3>
              <span className="ml-1 text-xs font-mono text-zinc-500">%</span>
            </div>
          </div>
        </div>

        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 flex items-center shadow-sm">
          <div className="p-3 rounded-xl bg-green-500/10 text-green-500 border border-green-500/20">
            <Clock className="h-5 w-5" />
          </div>
          <div className="ml-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5">Uptime</p>
            <div className="flex items-baseline">
              <h3 className="text-xl font-semibold text-white">{status?.uptime || '0h'}</h3>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 shrink-0">
        <div className="lg:col-span-2 bg-[#111] border border-zinc-800 rounded-xl p-6 flex flex-col min-h-[320px] shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-6 flex items-center">
            <Activity className="w-3.5 h-3.5 mr-2 text-orange-500" /> Hardware Utilization (Live)
          </h3>
          <div className="flex-1 min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={graphData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ea580c" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ea580c" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#c084fc" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#c084fc" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="name" hide />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#27272a', borderRadius: '8px', fontSize: '12px' }}
                  itemStyle={{ color: '#d4d4d8' }}
                />
                <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#ea580c" strokeWidth={2} fillOpacity={1} fill="url(#colorCpu)" />
                <Area type="monotone" dataKey="ram" name="RAM %" stroke="#c084fc" strokeWidth={2} fillOpacity={1} fill="url(#colorRam)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#111] border border-zinc-800 rounded-xl p-5 flex flex-col shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-6 flex items-center">
            <AlertTriangle className="w-3.5 h-3.5 mr-2 text-yellow-500" /> Server Errors (Weekly)
          </h3>
          <div className="flex-1 min-h-0 w-full min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={errorTrends} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#27272a', borderRadius: '8px', fontSize: '12px' }}
                  cursor={{ fill: '#27272a', opacity: 0.4 }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }} />
                <Bar dataKey="warnings" name="Warnings" stackId="a" fill="#eab308" radius={[0, 0, 4, 4]} />
                <Bar dataKey="errors" name="Errors/Crashes" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6 shrink-0">
        <div className="bg-[#111] border border-zinc-800 rounded-xl p-6 flex flex-col min-h-[320px] shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-6 flex items-center">
            <Users className="w-3.5 h-3.5 mr-2 text-blue-500" /> Player Activity (24H Trend)
          </h3>
          <div className="flex-1 min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={playerHistory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="time" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} tickMargin={10} minTickGap={20} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#27272a', borderRadius: '8px', fontSize: '12px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                <Line type="monotone" dataKey="players" name="Avg Players" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="peak" name="Peak Players" stroke="#0ea5e9" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#111] border border-zinc-800 rounded-xl p-6 flex flex-col shadow-sm">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-6 flex items-center">
            <Server className="w-3.5 h-3.5 mr-2 text-zinc-400" /> Actions & Configuration
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <button className="text-left p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-700 hover:bg-zinc-800/50 transition-colors group">
                <span className="block text-sm font-semibold text-white group-hover:text-orange-500 transition-colors">Restart Server</span>
                <span className="block text-[#8E9299] text-xs mt-1">Gracefully restart the instance and save state.</span>
             </button>
             <button className="text-left p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-700 hover:bg-zinc-800/50 transition-colors group">
                <span className="block text-sm font-semibold text-white group-hover:text-blue-500 transition-colors">Clear Cache</span>
                <span className="block text-[#8E9299] text-xs mt-1">Purge resource cache without stopping.</span>
             </button>
             <button className="text-left p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-zinc-700 hover:bg-zinc-800/50 transition-colors group">
                <span className="block text-sm font-semibold text-white group-hover:text-green-500 transition-colors">Export DB Backup</span>
                <span className="block text-[#8E9299] text-xs mt-1">Generate a quick snapshot of the database.</span>
             </button>
             <button className="text-left p-4 bg-red-950/20 border border-red-900/30 rounded-xl hover:bg-red-900/30 transition-colors group">
                <span className="block text-sm font-semibold text-red-500">Force Kill (Node)</span>
                <span className="block text-red-500/70 text-xs mt-1">Terminate process immediately. Unsaved data lost.</span>
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}
