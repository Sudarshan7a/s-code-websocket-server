import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import { createServer } from "http";

const PORT = process.env.PORT || 1234;

console.log(`Starting server with PORT: ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// Track active rooms and their connections
const activeRooms = new Map();

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  next();
});

// Room ending API endpoint
app.post("/api/rooms/:roomId/end", (req, res) => {
  try {
    const { roomId } = req.params;
    console.log(`Ending room: ${roomId}`);

    // Get all connections for this room
    const roomConnections = activeRooms.get(roomId) || new Set();

    console.log(`Found ${roomConnections.size} connections for room ${roomId}`);

    // Send end session message to all connected clients
    roomConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log(`Sending room-ended message to client in room ${roomId}`);
        ws.send(
          JSON.stringify({
            type: "room-ended",
            roomId: roomId,
            message: "The session has been ended by the host",
          })
        );
      }
    });

    // Clean up room
    activeRooms.delete(roomId);

    res.json({
      success: true,
      message: "Room ended successfully",
      notifiedClients: roomConnections.size,
    });
  } catch (error) {
    console.error("Error ending room:", error);
    res.status(500).json({ error: "Failed to end room" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    activeRooms: activeRooms.size,
    uptime: process.uptime(),
  });
});

// Create HTTP server with Express app
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  // Extract room ID from URL path
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.pathname.slice(1); // Remove leading slash

  if (!roomId) {
    ws.close(1008, "Room ID required");
    return;
  }

  console.log(`New connection to room: ${roomId}`);

  // Track this connection for the room
  if (!activeRooms.has(roomId)) {
    activeRooms.set(roomId, new Set());
  }
  activeRooms.get(roomId).add(ws);

  console.log(
    `Room ${roomId} now has ${activeRooms.get(roomId).size} connections`
  );

  // Basic message forwarding for Y.js (simplified)
  ws.on("message", (message) => {
    // Forward Y.js messages to other clients in the same room
    const roomConnections = activeRooms.get(roomId);
    if (roomConnections) {
      roomConnections.forEach((otherWs) => {
        if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
          otherWs.send(message);
        }
      });
    }
  });

  // Handle connection close
  ws.on("close", () => {
    console.log(`Connection closed for room: ${roomId}`);
    const roomConnections = activeRooms.get(roomId);
    if (roomConnections) {
      roomConnections.delete(ws);
      if (roomConnections.size === 0) {
        activeRooms.delete(roomId);
        console.log(`Room ${roomId} is now empty`);
      } else {
        console.log(
          `Room ${roomId} now has ${roomConnections.size} connections`
        );
      }
    }
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error for room ${roomId}:`, error);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Custom WebSocket server running on port ${PORT}`);
  console.log(`Health check endpoint: /health`);
  console.log(`Room management API endpoint: /api/rooms/:roomId/end`);
});

// Handle server startup errors
server.on('error', (error) => {
  console.error('Server startup error:', error);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down WebSocket server...");
  wss.close(() => {
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
});

export { server, wss };
