const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { setupSocketHandlers } = require('./server/handlers');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Get OpenAI API key from Next.js environment variables
const openaiApiKey = process.env.OPENAI_API_KEY;

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });
  
  // Initialize Socket.io
  const io = new Server(server, {
    path: '/api/socket',
    maxHttpBufferSize: 100 * 1024 * 1024, // 100 MB for large audio files
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['websocket'], // Force WebSocket transport only
  });

  // Log when Socket.io server starts
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected: ${socket.id}. Reason: ${reason}`);
    });
  });

  // Apply socket handlers and pass the API key
  setupSocketHandlers(io, { openaiApiKey });

  // Log any Socket.io errors
  io.engine.on('connection_error', (err) => {
    console.error('Socket.io connection error:', err);
  });
  
  // Start the server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${PORT}`);
    console.log(`> WebSocket server running on ws://localhost:${PORT}/api/socket`);
    console.log(`> Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}); 