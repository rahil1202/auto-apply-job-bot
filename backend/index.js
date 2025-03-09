import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { startMonitoringJobs, stopMonitoringJobs, isJobMonitorRunning } from './src/monitorJobs.js';

const app = express();
const PORT = 8002;
const clients = new Set();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send("Amazon Jobs Monitor Backend");
});

// Create a single HTTP server instance
const server = createServer(app);

// Create WebSocket server using the same server instance
const wss = new WebSocketServer({ server, path: '/ws' });

// Store original console.log and console.error
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Modified broadcast function to avoid infinite loops
export const broadcastLog = (message) => {
    const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
    
    // Only log to console if message doesn't indicate it's already being broadcast
    if (!logMessage.includes("[BROADCAST]")) {
        originalConsoleLog(logMessage);
    }
    
    clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            try {
                client.send(JSON.stringify({ log: logMessage }));
            } catch (err) {
                originalConsoleError("[BROADCAST] Error sending to client:", err);
            }
        }
    });
};

// Override console.log but use originalConsoleLog inside
console.log = function(...args) {
    // Call original first
    originalConsoleLog(...args);
    
    // Don't broadcast logs that indicate they're already broadcast messages
    const message = args.join(' ');
    if (!message.includes("[BROADCAST]")) {
        broadcastLog(message);
    }
};

// Override console.error
console.error = function(...args) {
    // Call original first
    originalConsoleError(...args);
    
    // Don't broadcast logs that indicate they're already broadcast messages
    const message = args.join(' ');
    if (!message.includes("[BROADCAST]")) {
        broadcastLog(`ERROR: ${message}`);
    }
};

// Handle WebSocket connections with improved reliability
wss.on('connection', (ws) => {
    originalConsoleLog("[BROADCAST] New WebSocket client connected");
    clients.add(ws);
    
    // Initialize connection health check
    ws.isAlive = true;
    
    // Handle pong responses
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    // Handle messages from client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'heartbeat') {
                // Respond to heartbeat
                ws.send(JSON.stringify({ type: 'heartbeat_response' }));
            }
        } catch (err) {
            originalConsoleError("[BROADCAST] Error parsing client message:", err);
        }
    });
    
    // Handle errors
    ws.on('error', (error) => {
        originalConsoleError("[BROADCAST] WebSocket error:", error);
        // Don't remove client here, let close handler do it
    });
    
    // Handle disconnections
    ws.on('close', (code, reason) => {
        originalConsoleLog(`[BROADCAST] WebSocket client disconnected. Code: ${code}, Reason: ${reason || 'None provided'}`);
        clients.delete(ws);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({ log: "Connected to Amazon Jobs Monitor" }));
});

// Health check interval for WebSocket connections
const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            originalConsoleLog("[BROADCAST] Terminating inactive connection");
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, 30000); // Check every 30 seconds

// Clean up interval on server close
wss.on('close', () => {
    clearInterval(pingInterval);
    originalConsoleLog("[BROADCAST] WebSocket server closed");
});

// Route to start job monitoring
app.post('/start', async (req, res) => {
    const { links, positions } = req.body;
    
    if (!Array.isArray(links) || !Array.isArray(positions)) {
        return res.status(400).json({ message: 'Invalid input format' });
    }
    
    if (isJobMonitorRunning()) {
        return res.status(400).json({ message: 'Script is already running' });
    }
    
    const jobLinks = links.filter(link => link.trim().startsWith('https://hiring.amazon'));
    const targetPositions = positions.map(pos => pos.trim()).filter(pos => pos.length > 0);

    if (jobLinks.length === 0 || targetPositions.length === 0) {
        return res.status(400).json({ message: 'Provide valid Amazon job links and target positions' });
    }

    // Create configuration object
    const config = {
        USER_DATA_DIR: path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'),   // Path to Chrome user data
        CHROME_PROFILES: ['Profile 11'],     // Chrome profile to use
        REFRESH_INTERVAL: 30000,          // Refresh interval in ms
        TARGET_JOBS: targetPositions,     // User-provided positions
        AMAZON_JOBS_URL: jobLinks[0]      // User-provided job URL (first valid one)
    };

    broadcastLog(`🚀 Starting with job link: ${config.AMAZON_JOBS_URL}`);
    broadcastLog(`🔍 Looking for positions: ${config.TARGET_JOBS.join(', ')}`);
    
    try {
        // Start monitoring but don't await it to allow the server to respond
        startMonitoringJobs(config, broadcastLog).catch(error => {
            console.error(`Monitor jobs error: ${error.message}`);
        });
        
        res.json({ message: 'Script started', config });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error starting script', error: error.message });
    }
});

// Route to stop job monitoring
app.post('/stop', (req, res) => {
    if (!isJobMonitorRunning()) {
        return res.status(400).json({ message: 'Script is not running' });
    }

    stopMonitoringJobs();
    broadcastLog("🛑 Script stopped");
    res.json({ message: 'Script stopped' });
});

// Route to get current status
app.get('/status', (req, res) => {
    const status = {
        isRunning: isJobMonitorRunning()
    };
    
    res.json(status);
});

// Graceful shutdown handler
process.on('SIGINT', () => {
    originalConsoleLog("[BROADCAST] Shutting down server...");
    clearInterval(pingInterval);
    
    wss.close(() => {
        originalConsoleLog("[BROADCAST] WebSocket server closed");
        server.close(() => {
            originalConsoleLog("[BROADCAST] HTTP server closed");
            process.exit(0);
        });
    });
});

// Start the server - only need to start one server that handles both HTTP and WebSocket
server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});