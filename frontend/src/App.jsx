import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Loader, RefreshCw, Plus, X, AlertCircle } from 'lucide-react';

// Use environment variables or a configuration file in production
const API_URL = 'http://localhost:8002';
const WS_URL = "ws://localhost:8002/ws";

function App() {
  const [jobLinks, setJobLinks] = useState(['']);
  const [positions, setPositions] = useState(['']);
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errors, setErrors] = useState({ links: [], positions: [] });

  const logEndRef = useRef(null);
  const ws = useRef(null);
  const retryCount = useRef(0);
  const MAX_RETRIES = 10; // Increased from 5 to 10
  const retryTimeoutRef = useRef(null);

  // Establish WebSocket connection on mount
  useEffect(() => {
    connectWebSocket();
    
    // Add a delay before first status check to ensure server has time to start
    setTimeout(() => {
      fetchStatus();
    }, 3000);

    return () => {
      console.log("🔌 Closing WebSocket...");
      if (ws.current) ws.current.close();
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const connectWebSocket = () => {
    // Clear any existing retry timeout
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    if (retryCount.current >= MAX_RETRIES) {
      console.error("WebSocket: Max retries reached.");
      setStatusMessage('Failed to connect to WebSocket. Please check if the server is running.');
      setIsConnected(false);
      return;
    }

    try {
      // Close existing connection if open
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        ws.current.close();
      }

      // Add local log message for connection attempt
      setLogs(prevLogs => [...prevLogs, {
        message: `Connecting to WebSocket (attempt ${retryCount.current + 1}/${MAX_RETRIES})...`,
        timestamp: new Date().toLocaleTimeString()
      }]);

      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => {
        console.log("✅ WebSocket connected.");
        setIsConnected(true);
        setStatusMessage('Connected to server');
        retryCount.current = 0;  // Reset retries

        const heartbeatInterval = setInterval(() => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'heartbeat' }));
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000); // Every 30 seconds
        
        // Add local log for successful connection
        setLogs(prevLogs => [...prevLogs, {
          message: "✅ WebSocket connected successfully",
          timestamp: new Date().toLocaleTimeString()
        }]);
        
        // Fetch status after successful connection
        fetchStatus();
      };

      ws.current.onclose = (event) => {
        console.warn(`⚠️ WebSocket disconnected (code: ${event.code}). Retrying...`);
        // eslint-disable-next-line no-undef
        clearInterval(heartbeatInterval);
        setIsConnected(false);
        setStatusMessage(`Disconnected from server (code: ${event.code})`);
        retryCount.current++;

        // Add local log for disconnection
        setLogs(prevLogs => [...prevLogs, {
          message: `⚠️ WebSocket disconnected. Retrying (${retryCount.current}/${MAX_RETRIES})...`,
          timestamp: new Date().toLocaleTimeString()
        }]);

        // Exponential backoff for retries (1s, 2s, 4s, etc.)
        const retryDelay = Math.min(1000 * Math.pow(2, retryCount.current - 1), 30000);
        retryTimeoutRef.current = setTimeout(connectWebSocket, retryDelay);
      };

      ws.current.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        // Don't close here, let the onclose handler handle reconnection
        
        // Add local log for error
        setLogs(prevLogs => [...prevLogs, {
          message: "❌ WebSocket connection error",
          timestamp: new Date().toLocaleTimeString()
        }]);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.log) {
            setLogs(prevLogs => [...prevLogs, { message: data.log, timestamp: new Date().toLocaleTimeString() }]);
          }
        } catch (err) {
          console.error("⚠️ Error parsing WebSocket message:", err);
        }
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
      setStatusMessage('Failed to create WebSocket connection');
      
      // Retry with backoff
      retryCount.current++;
      const retryDelay = Math.min(1000 * Math.pow(2, retryCount.current - 1), 30000);
      retryTimeoutRef.current = setTimeout(connectWebSocket, retryDelay);
    }
  };

  const fetchStatus = async () => {
    try {
      setLogs(prevLogs => [...prevLogs, {
        message: "🔍 Checking server status...",
        timestamp: new Date().toLocaleTimeString()
      }]);
      
      const response = await fetch(`${API_URL}/status`, {
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(5000)
      });
      
      const data = await response.json();
      setIsRunning(data.isRunning);
      
      setLogs(prevLogs => [...prevLogs, {
        message: `📊 Server status: ${data.isRunning ? 'Running' : 'Stopped'}`,
        timestamp: new Date().toLocaleTimeString()
      }]);
    } catch (error) {
      console.error('Error fetching status:', error);
      setStatusMessage('Error connecting to server. Please ensure the backend is running.');
      
      setLogs(prevLogs => [...prevLogs, {
        message: `❌ Error fetching status: ${error.message}`,
        timestamp: new Date().toLocaleTimeString()
      }]);
      
      // If we can't fetch status, we're likely not connected
      setIsConnected(false);
    }
  };

  const validateInputs = () => {
    let isValid = true;
    const linkErrors = [];
    const positionErrors = [];

    // Validate job links - changed to match backend validation
    jobLinks.forEach((link, index) => {
      if (link.trim() === '') {
        if (jobLinks.length > 1) { // Only validate non-empty fields if there are multiple
          linkErrors[index] = '';
        } else {
          linkErrors[index] = 'Job link cannot be empty';
          isValid = false;
        }
      } else if (!link.trim().startsWith('https://hiring.amazon')) {
        linkErrors[index] = 'Must be a valid Amazon hiring link';
        isValid = false;
      } else {
        linkErrors[index] = '';
      }
    });

    // Validate positions
    positions.forEach((position, index) => {
      if (position.trim() === '') {
        if (positions.length > 1) { // Only validate non-empty fields if there are multiple
          positionErrors[index] = '';
        } else {
          positionErrors[index] = 'Position cannot be empty';
          isValid = false;
        }
      } else {
        positionErrors[index] = '';
      }
    });

    setErrors({ links: linkErrors, positions: positionErrors });
    return isValid;
  };

  const startMonitoring = async () => {
    if (!validateInputs()) {
      setStatusMessage('Please fix the errors before starting');
      return;
    }

    const filteredLinks = jobLinks.filter(link => link.trim() !== '');
    const filteredPositions = positions.filter(pos => pos.trim() !== '');

    if (filteredLinks.length === 0) {
      setStatusMessage('Please add at least one Amazon job link');
      return;
    }

    if (filteredPositions.length === 0) {
      setStatusMessage('Please add at least one position to monitor');
      return;
    }

    try {
      setStatusMessage('Starting job monitor...');
      setLogs(prevLogs => [
        ...prevLogs, 
        { 
          message: `🚀 Attempting to start monitoring with ${filteredLinks.length} links and ${filteredPositions.length} positions...`, 
          timestamp: new Date().toLocaleTimeString() 
        }
      ]);
      
      const response = await fetch(`${API_URL}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: filteredLinks, positions: filteredPositions }),
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to start monitoring');
      }

      // eslint-disable-next-line no-unused-vars
      const data = await response.json();
      setIsRunning(true);
      setStatusMessage('Job monitoring started');
      
      // Add a log entry for successful start
      setLogs(prevLogs => [
        ...prevLogs, 
        { 
          message: `✅ Monitoring started with ${filteredLinks.length} links and ${filteredPositions.length} positions`, 
          timestamp: new Date().toLocaleTimeString() 
        }
      ]);
      
    } catch (error) {
      console.error('Error starting monitoring:', error);
      setStatusMessage(`Error: ${error.message || 'Failed to connect to server'}`);
      
      setLogs(prevLogs => [
        ...prevLogs, 
        { 
          message: `❌ Error starting monitoring: ${error.message}`, 
          timestamp: new Date().toLocaleTimeString() 
        }
      ]);
    }
  };

  const stopMonitoring = async () => {
    try {
      setStatusMessage('Stopping job monitor...');
      setLogs(prevLogs => [
        ...prevLogs, 
        { 
          message: '🛑 Attempting to stop monitoring...', 
          timestamp: new Date().toLocaleTimeString() 
        }
      ]);
      
      const response = await fetch(`${API_URL}/stop`, { 
        method: 'POST',
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to stop monitoring');
      }

      // eslint-disable-next-line no-unused-vars
      const data = await response.json();
      setIsRunning(false);
      setStatusMessage('Job monitoring stopped');
      
      // Add a log entry for successful stop
      setLogs(prevLogs => [
        ...prevLogs, 
        { 
          message: '✅ Monitoring stopped successfully', 
          timestamp: new Date().toLocaleTimeString() 
        }
      ]);
      
    } catch (error) {
      console.error('Error stopping monitoring:', error);
      setStatusMessage(`Error: ${error.message || 'Failed to connect to server'}`);
      
      setLogs(prevLogs => [
        ...prevLogs, 
        { 
          message: `❌ Error stopping monitoring: ${error.message}`, 
          timestamp: new Date().toLocaleTimeString() 
        }
      ]);
    }
  };

  const handleCheckConnection = () => {
    // Manual connection check triggered by user
    setLogs(prevLogs => [
      ...prevLogs, 
      { 
        message: '🔄 Manual connection check initiated...', 
        timestamp: new Date().toLocaleTimeString() 
      }
    ]);
    
    // Reset retry count to allow fresh connection attempts
    retryCount.current = 0;
    connectWebSocket();
    fetchStatus();
  };

  const handleLinkChange = (index, value) => {
    const newLinks = [...jobLinks];
    newLinks[index] = value;
    setJobLinks(newLinks);
  };

  const handlePositionChange = (index, value) => {
    const newPositions = [...positions];
    newPositions[index] = value;
    setPositions(newPositions);
  };

  const addLink = () => {
    setJobLinks([...jobLinks, '']);
  };

  const removeLink = (index) => {
    if (jobLinks.length > 1) {
      const newLinks = jobLinks.filter((_, i) => i !== index);
      setJobLinks(newLinks);
      
      // Update errors array too
      const newErrors = { ...errors };
      newErrors.links = newErrors.links.filter((_, i) => i !== index);
      setErrors(newErrors);
    }
  };

  const addPosition = () => {
    setPositions([...positions, '']);
  };

  const removePosition = (index) => {
    if (positions.length > 1) {
      const newPositions = positions.filter((_, i) => i !== index);
      setPositions(newPositions);
      
      // Update errors array too
      const newErrors = { ...errors };
      newErrors.positions = newErrors.positions.filter((_, i) => i !== index);
      setErrors(newErrors);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-r from-blue-700 to-blue-500 text-white p-4 shadow-lg">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center">
            <RefreshCw className="mr-2" size={24} />
            Amazon Jobs Monitor
          </h1>
          <div className="flex items-center space-x-4">
            <button 
              onClick={handleCheckConnection}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-3 rounded-md transition-colors flex items-center"
              title="Check connection"
            >
              <RefreshCw size={14} className="mr-1" /> Reconnect
            </button>
            <div className="flex items-center bg-blue-800 bg-opacity-30 px-3 py-1 rounded-full">
              <div className={`h-3 w-3 rounded-full mr-2 ${isConnected ? 'bg-green-400' : 'bg-red-500'} animate-pulse`}></div>
              <span className="text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1 space-y-4">
          <div className="bg-white rounded-lg shadow-md p-4">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Job Links</h2>
            <div className="space-y-3">
              {jobLinks.map((link, index) => (
                <div key={`link-${index}`} className="flex items-start space-x-2">
                  <div className="flex-grow">
                    <input
                      type="text"
                      value={link}
                      onChange={(e) => handleLinkChange(index, e.target.value)}
                      placeholder="Enter Amazon hiring link (https://hiring.amazon...)"
                      className={`w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.links[index] ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                    {errors.links[index] && (
                      <p className="text-red-500 text-xs mt-1 flex items-center">
                        <AlertCircle size={12} className="mr-1" /> {errors.links[index]}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removeLink(index)}
                    className="p-2 text-red-500 hover:bg-red-100 rounded-md"
                    disabled={jobLinks.length === 1}
                    title="Remove link"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                onClick={addLink}
                className="flex items-center text-blue-600 hover:text-blue-800 font-medium text-sm"
              >
                <Plus size={16} className="mr-1" /> Add another link
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-4">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Positions to Monitor</h2>
            <div className="space-y-3">
              {positions.map((position, index) => (
                <div key={`position-${index}`} className="flex items-start space-x-2">
                  <div className="flex-grow">
                    <input
                      type="text"
                      value={position}
                      onChange={(e) => handlePositionChange(index, e.target.value)}
                      placeholder="Enter position title"
                      className={`w-full p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.positions[index] ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                    {errors.positions[index] && (
                      <p className="text-red-500 text-xs mt-1 flex items-center">
                        <AlertCircle size={12} className="mr-1" /> {errors.positions[index]}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removePosition(index)}
                    className="p-2 text-red-500 hover:bg-red-100 rounded-md"
                    disabled={positions.length === 1}
                    title="Remove position"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                onClick={addPosition}
                className="flex items-center text-blue-600 hover:text-blue-800 font-medium text-sm"
              >
                <Plus size={16} className="mr-1" /> Add another position
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-4">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 border-b pb-2">Control Panel</h2>
            {isRunning ? (
              <button 
                onClick={stopMonitoring} 
                className={`w-full ${!isConnected ? 'bg-red-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'} text-white font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center`}
                disabled={!isConnected}
              >
                <Square className="mr-2" size={20} /> Stop Monitoring
              </button>
            ) : (
              <button 
                onClick={startMonitoring} 
                className={`w-full ${!isConnected ? 'bg-green-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'} text-white font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center`}
                disabled={!isConnected}
              >
                <Play className="mr-2" size={20} /> Start Monitoring
              </button>
            )}
            <div className="mt-4 text-sm">
              <div className={`p-2 rounded ${statusMessage.includes('Error') ? 'bg-red-100 text-red-800' : 'bg-blue-50 text-blue-800'}`}>
                <p className="font-medium">Status: {statusMessage || (isRunning ? 'Running' : 'Stopped')}</p>
                {isRunning && (
                  <div className="flex items-center text-green-600 mt-2">
                    <Loader className="animate-spin mr-2" size={16} />
                    Monitoring active
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="bg-white rounded-lg shadow-md p-4 h-full">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h2 className="text-xl font-semibold text-gray-800">Activity Logs</h2>
              <button 
                onClick={() => setLogs([])} 
                className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-2 rounded"
              >
                Clear
              </button>
            </div>
            <div className="bg-gray-900 text-gray-100 rounded-md p-3 overflow-y-auto h-[calc(100vh-12rem)] font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-gray-500 italic flex items-center justify-center h-32">
                  No logs yet. Start monitoring to see logs here.
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1 hover:bg-gray-800 p-1 rounded">
                    <span className="text-gray-400">[{log.timestamp}]</span> {log.message}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-8 bg-gray-800 text-center p-4 text-gray-400 text-sm">
        Amazon Jobs Monitor &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}

export default App;