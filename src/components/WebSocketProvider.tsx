"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface WebSocketContextType {
  socket: Socket | null;
  connected: boolean;
}

const WebSocketContext = createContext<WebSocketContextType>({
  socket: null,
  connected: false
});

export const useWebSocket = () => useContext(WebSocketContext);

interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  useEffect(() => {
    const initSocket = async () => {
      try {
        console.log('Initializing WebSocket connection...');
        
        // Initialize the socket connection
        try {
          const response = await fetch('/api/socket');
          if (!response.ok) {
            throw new Error(`Socket API returned ${response.status}: ${await response.text()}`);
          }
          console.log('Socket API responded successfully');
        } catch (error) {
          console.error('Error calling socket API:', error);
          // Continue anyway as this might just be a Next.js API route issue
        }
        
        // Create socket instance with WebSocket transport only
        const socketInstance = io({
          path: '/api/socket',
          transports: ['websocket'], // Force WebSocket transport only
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          timeout: 20000, // Increased timeout for better connection chance
          autoConnect: true,
        });

        // Set up event listeners
        socketInstance.on('connect', () => {
          console.log('WebSocket connected:', socketInstance.id);
          setConnected(true);
          retryCountRef.current = 0; // Reset retry count on successful connection
          
          // Test connection with a simple ping 
          socketInstance.emit('ping', Date.now(), (serverTime: number) => {
            console.log('Connection verified with server ping, latency:', Date.now() - serverTime, 'ms');
          });
        });

        socketInstance.on('connect_error', (error) => {
          console.error('WebSocket connection error:', error.message);
          setConnected(false);
          
          // Implement retry logic
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            console.log(`Retrying connection (${retryCountRef.current}/${maxRetries})...`);
            
            // Force reconnection
            setTimeout(() => {
              socketInstance.connect();
            }, 2000);
          } else {
            console.error('Maximum connection retries reached');
          }
        });

        socketInstance.on('disconnect', (reason) => {
          console.log('WebSocket disconnected, reason:', reason);
          setConnected(false);
          
          if (reason === 'io server disconnect') {
            // The server has forcefully disconnected the socket
            console.log('Server disconnected socket, attempting to reconnect...');
            socketInstance.connect();
          }
        });

        // Store the socket instance
        setSocket(socketInstance);

        // Store cleanup function
        cleanupRef.current = () => {
          console.log('Cleaning up WebSocket connection');
          socketInstance.disconnect();
        };
      } catch (error) {
        console.error('Error initializing WebSocket:', error);
      }
    };

    initSocket();

    // Clean up function
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  const value = {
    socket,
    connected
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}; 