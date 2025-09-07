import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import { createServer } from "http";
import dotenv from "dotenv";

// Load environment variables from .env.local
dotenv.config({ path: ".env.local" });

const PORT = process.env.PORT || 1234;
const HOST = process.env.HOST || "0.0.0.0";

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

    // Get all connections for this room
    const roomConnections = activeRooms.get(roomId) || new Set();

    let sentCount = 0;
    let closedCount = 0;

    // Send end session message to all connected clients
    roomConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
          type: "room-ended",
          roomId: roomId,
          message: "The session has been ended by the host",
          timestamp: new Date().toISOString(),
        });

        try {
          ws.send(message);
          sentCount++;
        } catch (sendError) {
          console.error("Failed to send to client:", sendError);
        }
      } else {
        closedCount++;
      }
    });

    // Clean up room
    activeRooms.delete(roomId);

    res.json({
      success: true,
      message: "Room ended successfully",
      notifiedClients: sentCount,
      closedClients: closedCount,
      totalClients: roomConnections.size,
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

  // Track this connection for the room
  if (!activeRooms.has(roomId)) {
    activeRooms.set(roomId, new Set());
  }
  activeRooms.get(roomId).add(ws);

  // Add connection ID for tracking
  ws.connectionId = Math.random().toString(36).substr(2, 9);

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
  // Connection closed for room
    const roomConnections = activeRooms.get(roomId);
    if (roomConnections) {
      roomConnections.delete(ws);
      if (roomConnections.size === 0) {
        activeRooms.delete(roomId);
    // Room is now empty and removed
      } else {
    // Room has remaining connections
      }
    }
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`WebSocket error for connection ${ws.connectionId} in room ${roomId}:`, error);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Custom WebSocket server running on ${HOST}:${PORT}`);
  console.log(`Health check available at http://${HOST}:${PORT}/health`);
  console.log(`Room management API available at http://${HOST}:${PORT}/api/rooms/:roomId/end`);
  console.log(`Server started at ${new Date().toISOString()}`);
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
