import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import 'dotenv/config';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory logger for demonstration (simulating real-time output and external logging)
  const logs = [];
  const addLog = (level, message, source = 'system') => {
    const timestamp = new Date().toISOString();
    const log = { id: Date.now().toString(), timestamp, level, message, source };
    logs.push(log);
    if (logs.length > 500) logs.shift(); // Keep last 500 logs
    // In a real app we might also send this to Datadog/ELK
    console.log(`[${timestamp}] [${level}] [${source}] ${message}`);
  };

  addLog('INFO', 'Portside Server starting...');

  // Database Connection
  let dbPool;
  try {
    if (process.env.DB_HOST && process.env.DB_USER) {
      dbPool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'fivem',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
      addLog('INFO', 'Database pool created successfully', 'database');
    } else {
      addLog('WARN', 'Database credentials not provided, running in mock DB mode', 'database');
    }
  } catch (error) {
    addLog('ERROR', `Database connection failed: ${error.message}`, 'database');
  }

  // Middleware: Auth Protection
  const authenticateToken = (req, res, next) => {
    // Debug bypass
    if (process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true') {
      req.user = { username: 'admin', role: 'owner' };
      return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-for-dev', (err, user) => {
      if (err) return res.status(403).json({ error: 'Forbidden' });
      // @ts-ignore
      req.user = user;
      next();
    });
  };

  // --- API ROUTES ---

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      // Fixed admin account for demo. In production, query the DB pool.
      const validUsername = "admin";
      // Plain text check for demo purposes
      if (username === validUsername && password === 'portside') {
        const token = jwt.sign({ username }, process.env.JWT_SECRET || 'fallback-secret-for-dev', { expiresIn: '24h' });
        addLog('INFO', `User ${username} logged in successfully`, 'auth');
        res.json({ token, user: { username, role: 'owner' } });
      } else {
        addLog('WARN', `Failed login attempt for user ${username}`, 'auth');
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch(err) {
      addLog('ERROR', `Login error: ${err.message}`, 'auth');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Verify Auth
  app.get("/api/auth/verify", authenticateToken, (req, res) => {
    // @ts-ignore
    res.json({ user: req.user });
  });

  // Dashboard Stats & Server Status
  app.get("/api/server/status", authenticateToken, async (req, res) => {
    try {
      let players = 0;
      let maxPlayers = 64;
      let online = false;

      // Try external API if configured
      if (process.env.FIVEM_SERVER_URL) {
        try {
          const fetchObj = await fetch(`${process.env.FIVEM_SERVER_URL}/info.json`);
          if (fetchObj.ok) {
             const info = await fetchObj.json();
             maxPlayers = info.vars?.sv_maxClients || 64;
             online = true;
          }
          const dynObj = await fetch(`${process.env.FIVEM_SERVER_URL}/dynamic.json`);
          if (dynObj.ok) {
             const dyn = await dynObj.json();
             players = dyn.clients || 0;
          }
        } catch(e) {
          addLog('WARN', `Could not connect to external FiveM server at ${process.env.FIVEM_SERVER_URL}`, 'system');
        }
      } else {
        // Mock data
        online = true;
        players = 42;
      }

      res.json({
        online,
        players,
        maxPlayers,
        cpuUsage: Math.floor(Math.random() * 40) + 10,
        memoryUsage: Math.floor(Math.random() * 60) + 30,
        uptime: '14h 22m'
      });
    } catch(err) {
      addLog('ERROR', `Could not fetch server status: ${err.message}`, 'system');
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  // Get Players
  app.get("/api/players", authenticateToken, async (req, res) => {
     // Mocking real-time synchronization from external FiveM players.json
     const mockPlayers = [
       { id: 1, name: "thevindu", ping: 42, identifiers: ["steam:11000010abc1234"], role: "owner" },
       { id: 2, name: "john_doe", ping: 120, identifiers: ["steam:1100001bcdef987"], role: "player" },
       { id: 4, name: "gamer99", ping: 15, identifiers: ["steam:110000155555555"], role: "admin" }
     ];
     res.json(mockPlayers);
  });

  // Kick Player
  app.post("/api/players/:id/kick", authenticateToken, (req, res) => {
    const { id } = req.params;
    addLog('INFO', `Kicked player with ID ${id}`, 'system');
    res.json({ success: true, message: `Player ${id} kicked successfully` });
  });

  // Ban Player
  app.post("/api/players/:id/ban", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { reason, duration } = req.body;
    addLog('INFO', `Banned player with ID ${id}. Reason: ${reason}, Duration: ${duration}`, 'system');
    res.json({ success: true, message: `Player ${id} banned successfully` });
  });

  // Get Logs
  app.get("/api/logs", authenticateToken, (req, res) => {
    res.json(logs.slice(-100).reverse());
  });

  // DB Test / Schema fetching
  app.get("/api/db/tables", authenticateToken, async (req, res) => {
    if (!dbPool) {
      if (process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true') {
        return res.json({ tables: ['users', 'owned_vehicles', 'characters', 'addon_inventory', 'datastore', 'datastore_data'] });
      }
      return res.status(503).json({ error: 'Database not connected' });
    }
    try {
      const [rows] = await dbPool.query('SHOW TABLES');
      res.json({ tables: rows.map(r => Object.values(r)[0]) });
    } catch(err) {
      addLog('ERROR', `DB Query failed: ${err.message}`, 'database');
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post("/api/db/query", authenticateToken, async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });
    
    if (!dbPool) {
      if (process.env.DEBUG === 'true' || process.env.VITE_DEBUG === 'true') {
        addLog('INFO', `Mock Executed Query: ${query}`, 'database');
        return res.json({ 
          success: true, 
          columns: ['id', 'identifier', 'group', 'money', 'bank'], 
          rows: [
            { id: 1, identifier: 'steam:1100001bcdef987', group: 'superadmin', money: 500, bank: 150000 },
            { id: 2, identifier: 'license:123456789abc', group: 'user', money: 200, bank: 500 }
          ] 
        });
      }
      return res.status(503).json({ error: 'Database not connected' });
    }
    
    try {
      addLog('INFO', `Executed Query: ${query}`, 'database');
      const [rows, fields] = await dbPool.query(query);
      if (Array.isArray(rows)) {
        res.json({
          success: true,
          columns: fields ? fields.map((f: any) => f.name) : [],
          rows: rows
        });
      } else {
        // For UPDATE, INSERT, DELETE
        res.json({ success: true, affectedRows: (rows as any).affectedRows, message: 'Query executed successfully' });
      }
    } catch(err: any) {
      addLog('ERROR', `DB Query failed: ${err.message}`, 'database');
      res.status(500).json({ error: err.message });
    }
  });
  
  // Scripts / Resources mock
  let mockResources = [
    { name: "es_extended", state: "started", version: "1.8.5", author: "ESX", description: "The core ESX server framework.", dependencies: ["mysql-async"], logs: "es_extended: Loaded successfully." },
    { name: "qs-inventory", state: "started", version: "2.1.0", author: "Quasar", description: "Advanced inventory system with drag & drop.", dependencies: ["es_extended"], logs: "qs-inventory: Connected to DB." },
    { name: "custom-cars", state: "stopped", version: "1.0.0", author: "Admin", description: "Custom vehicle pack.", dependencies: ["vMenu"], logs: "custom-cars: Initialized 12 vehicles." },
    { name: "vMenu", state: "started", version: "3.5.0", author: "Vesura", description: "Server sidemenu for players and admins.", dependencies: [], logs: "vMenu: Permissions loaded." }
  ];

  app.get("/api/resources", authenticateToken, (req, res) => {
    res.json(mockResources);
  });

  app.post("/api/resources/:name/start", authenticateToken, (req, res) => {
    const { name } = req.params;
    const resource = mockResources.find(r => r.name === name);
    if (resource) {
      resource.state = "started";
      addLog('INFO', `Resource ${name} started`, 'system');
      res.json({ success: true, resource });
    } else {
      res.status(404).json({ error: 'Resource not found' });
    }
  });

  app.post("/api/resources/:name/stop", authenticateToken, (req, res) => {
    const { name } = req.params;
    const resource = mockResources.find(r => r.name === name);
    if (resource) {
      resource.state = "stopped";
      addLog('INFO', `Resource ${name} stopped`, 'system');
      res.json({ success: true, resource });
    } else {
      res.status(404).json({ error: 'Resource not found' });
    }
  });

  app.post("/api/resources/:name/restart", authenticateToken, (req, res) => {
    const { name } = req.params;
    const resource = mockResources.find(r => r.name === name);
    if (resource) {
      resource.state = "started";
      addLog('INFO', `Resource ${name} restarted`, 'system');
      res.json({ success: true, resource });
    } else {
      res.status(404).json({ error: 'Resource not found' });
    }
  });

  // --- CONFIG APIs ---
  const mockConfigs: Record<string, string> = {
    'server.cfg': 'endpoint_add_tcp "0.0.0.0:30120"\nendpoint_add_udp "0.0.0.0:30120"\n\nsv_maxclients 64\nsv_hostname "Portside Managed Server"\nsets tags "default, deployer, portside"\nsv_licenseKey "portside_license_123"\n\nensure mapmanager\nensure chat\nensure spawnmanager\nensure sessionmanager\nensure hardcap\nensure rconlog\n',
    'permissions.cfg': 'add_ace group.admin command allow # allow all commands\nadd_ace group.admin command.quit deny # but don\'t allow quit\nadd_principal identifier.steam:11000010abc1234 group.admin\n',
    'es_extended/config.lua': 'Config = {}\nConfig.Locale = \'en\'\n\nConfig.Accounts = {\n  bank = \'Bank\',\n  black_money = \'Black Money\'\n}\n\nConfig.StartingAccountMoney = {bank = 50000}\n'
  };

  app.get("/api/config", authenticateToken, (req, res) => {
    const file = req.query.file as string;
    if (!file) {
      return res.json({ files: Object.keys(mockConfigs) });
    }
    if (mockConfigs[file] !== undefined) {
      res.json({ content: mockConfigs[file] });
    } else {
      res.status(404).json({ error: 'Config not found' });
    }
  });

  app.put("/api/config", authenticateToken, (req, res) => {
    const file = req.query.file as string;
    const { content } = req.body;
    if (file && mockConfigs[file] !== undefined && typeof content === 'string') {
      mockConfigs[file] = content;
      addLog('INFO', `Configuration updated: ${file}`, 'system');
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid config payload' });
    }
  });

  // --- ROLES & PERMISSIONS APIs ---
  let mockRoles = [
    { id: '1', name: 'Super Admin', permissions: ['all'] },
    { id: '2', name: 'Moderator', permissions: ['console.read', 'players.kick', 'players.ban'] },
    { id: '3', name: 'Developer', permissions: ['console.read', 'resources.restart', 'resources.start', 'resources.stop'] }
  ];

  let mockPlatformUsers = [
    { id: '1', username: 'admin_portside', roleId: '1' },
    { id: '2', username: 'mod_john', roleId: '2' },
    { id: '3', username: 'dev_sarah', roleId: '3' },
  ];

  app.get("/api/roles", authenticateToken, (req, res) => {
    res.json(mockRoles);
  });

  app.post("/api/roles", authenticateToken, (req, res) => {
    const newRole = { id: Date.now().toString(), name: req.body.name, permissions: req.body.permissions || [] };
    mockRoles.push(newRole);
    addLog('INFO', `Role created: ${newRole.name}`, 'system');
    res.json(newRole);
  });

  app.put("/api/roles/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const role = mockRoles.find(r => r.id === id);
    if (role) {
      if (req.body.name) role.name = req.body.name;
      if (req.body.permissions) role.permissions = req.body.permissions;
      addLog('INFO', `Role updated: ${role.name}`, 'system');
      res.json(role);
    } else {
      res.status(404).json({ error: 'Role not found' });
    }
  });

  app.delete("/api/roles/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    mockRoles = mockRoles.filter(r => r.id !== id);
    addLog('INFO', `Role deleted: ${id}`, 'system');
    res.json({ success: true });
  });

  app.get("/api/platform-users", authenticateToken, (req, res) => {
    res.json(mockPlatformUsers);
  });

  app.put("/api/platform-users/:id/role", authenticateToken, (req, res) => {
    const { id } = req.params;
    const user = mockPlatformUsers.find(u => u.id === id);
    if (user) {
      user.roleId = req.body.roleId;
      addLog('INFO', `User role updated: ${user.username}`, 'system');
      res.json(user);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });

  // --- VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Note: process.cwd() handles vercel/ai environment
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Portside running on http://localhost:${PORT}`);
    addLog('INFO', `Web panel ready on port ${PORT}`);
  });
}

startServer().catch(console.error);
