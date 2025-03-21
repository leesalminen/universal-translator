import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  return new NextResponse('WebSocket server is running through the main server.js, not this API route. Please connect to the WebSocket at ws://localhost:3000/api/socket', 
    { status: 200 }
  );
} 