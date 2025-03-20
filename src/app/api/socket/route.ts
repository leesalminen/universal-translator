import { Server as SocketIOServer } from 'socket.io';
import { NextRequest, NextResponse } from 'next/server';

// This is a global variable to store the Socket.io instance
let io: SocketIOServer;

export async function GET(_req: NextRequest) {
  try {
    // Check if Socket.io server is already running
    if ((globalThis as unknown as { io?: SocketIOServer }).io) {
      console.log('Socket is already running');
    } else {
      // Create a new Socket.io server
      console.log('Initializing Socket.io server');
      
      // Since Next.js App Router doesn't expose the underlying HTTP server directly,
      // we'll use a workaround to store the io instance globally
      
      // Store the io instance globally
      io = new SocketIOServer({
        path: '/api/socket',
        addTrailingSlash: false,
        cors: {
          origin: '*',
          methods: ['GET', 'POST']
        }
      });
      
      // Set up WebSocket events
      io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);
        
        // Handle audio chunk events
        socket.on('audioChunk', async (_audioChunk) => {
          try {
            // Process the audio chunk and get transcription
            // This is a simplified version - we'll implement the full logic later
            console.log('Received audio chunk, processing...');
            
            // Broadcast the transcription to all clients
            io.emit('transcription', { 
              text: 'Processing audio...',
              final: false
            });
          } catch (error) {
            console.error('Error processing audio chunk:', error);
          }
        });
        
        // Handle language selection changes
        socket.on('changeLanguage', (data) => {
          console.log('Language changed:', data);
          socket.broadcast.emit('languageChanged', data);
        });
        
        // Handle disconnection
        socket.on('disconnect', () => {
          console.log('Client disconnected:', socket.id);
        });
      });
      
      // Store the io instance globally
      (globalThis as unknown as { io?: SocketIOServer }).io = io;
    }
    
    return new NextResponse('WebSocket server is running', { status: 200 });
  } catch (error) {
    console.error('Error setting up WebSocket server:', error);
    return new NextResponse('Failed to set up WebSocket server', { status: 500 });
  }
} 