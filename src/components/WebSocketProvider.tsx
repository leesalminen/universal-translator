"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface WebSocketContextType {
  socket: Socket | null;
  connected: boolean;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
  socket: null,
  connected: false,
  reconnect: () => {}
});

export const useWebSocket = () => useContext(WebSocketContext);

interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  // Initialize socket connection
  const initSocket = () => {
    try {
      console.log('Initializing WebSocket connection...');
      
      // Create socket instance with WebSocket transport only
      const socketInstance = io({
        path: '/api/socket',
        transports: ['websocket'], // Force WebSocket transport only
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000, // Increased timeout for better connection chance
        autoConnect: true,
      });

      // Store the socket instance in both state and ref
      setSocket(socketInstance);
      socketRef.current = socketInstance;

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

      // Store cleanup function
      cleanupRef.current = () => {
        console.log('Cleaning up WebSocket connection');
        socketInstance.disconnect();
      };
      
      return socketInstance;
    } catch (error) {
      console.error('Error initializing WebSocket:', error);
      return null;
    }
  };

  // Function to manually reconnect (can be called by consumers)
  const reconnect = () => {
    if (socketRef.current) {
      console.log('Manual reconnection requested');
      
      if (!socketRef.current.connected) {
        console.log('Socket disconnected, attempting to reconnect...');
        socketRef.current.connect();
      } else {
        console.log('Socket already connected, no need to reconnect');
      }
    } else {
      console.log('No socket instance, creating new connection');
      const newSocket = initSocket();
      setSocket(newSocket);
      socketRef.current = newSocket;
    }
  };

  useEffect(() => {
    const socketInstance = initSocket();
    
    // Clean up function
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  const value = {
    socket,
    connected: connected && (socket?.connected || false),
    reconnect
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}; 