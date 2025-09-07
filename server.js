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
    console.log(`[DEBUG] Ending room: ${roomId}`);
    console.log(
      `[DEBUG] Current active rooms:`,
      Array.from(activeRooms.keys())
    );

    // Get all connections for this room
    const roomConnections = activeRooms.get(roomId) || new Set();

    console.log(
      `[DEBUG] Found ${roomConnections.size} connections for room ${roomId}`
    );

    let sentCount = 0;
    let closedCount = 0;

    // Send end session message to all connected clients
    roomConnections.forEach((ws, index) => {
      console.log(
        `[DEBUG] Checking client ${index + 1}/${
          roomConnections.size
        } - ReadyState: ${ws.readyState}`
      );

      if (ws.readyState === WebSocket.OPEN) {
        const message = JSON.stringify({
          type: "room-ended",
          roomId: roomId,
          message: "The session has been ended by the host",
          timestamp: new Date().toISOString(),
        });

        console.log(
          `[DEBUG] Sending room-ended message to client ${
            index + 1
          } in room ${roomId}`
        );
        console.log(`[DEBUG] Message content:`, message);

        try {
          ws.send(message);
          sentCount++;
          console.log(`[DEBUG] Successfully sent to client ${index + 1}`);
        } catch (sendError) {
          console.error(
            `[DEBUG] Failed to send to client ${index + 1}:`,
            sendError
          );
        }
      } else {
        closedCount++;
        console.log(
          `[DEBUG] Skipped client ${index + 1} - connection not open (state: ${
            ws.readyState
          })`
        );
      }
    });

    console.log(
      `[DEBUG] Summary - Sent: ${sentCount}, Closed: ${closedCount}, Total: ${roomConnections.size}`
    );

    // Clean up room
    activeRooms.delete(roomId);
    console.log(`[DEBUG] Cleaned up room ${roomId} from active rooms`);

    res.json({
      success: true,
      message: "Room ended successfully",
      notifiedClients: sentCount,
      closedClients: closedCount,
      totalClients: roomConnections.size,
    });
  } catch (error) {
    console.error("[DEBUG] Error ending room:", error);
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
    console.log(`[DEBUG] Connection rejected - no room ID provided`);
    ws.close(1008, "Room ID required");
    return;
  }

  console.log(`[DEBUG] New connection to room: ${roomId}`);
  console.log(`[DEBUG] Connection URL: ${req.url}`);
  console.log(`[DEBUG] Client IP: ${req.socket.remoteAddress}`);

  // Track this connection for the room
  if (!activeRooms.has(roomId)) {
    activeRooms.set(roomId, new Set());
    console.log(`[DEBUG] Created new room: ${roomId}`);
  }
  activeRooms.get(roomId).add(ws);

  console.log(
    `[DEBUG] Room ${roomId} now has ${activeRooms.get(roomId).size} connections`
  );

  // Add connection ID for tracking
  ws.connectionId = Math.random().toString(36).substr(2, 9);
  console.log(
    `[DEBUG] Assigned connection ID: ${ws.connectionId} to room ${roomId}`
  );

  // Basic message forwarding for Y.js (simplified)
  ws.on("message", (message) => {
    console.log(
      `[DEBUG] Message from ${ws.connectionId} in room ${roomId}, size: ${message.length} bytes`
    );

    // Forward Y.js messages to other clients in the same room
    const roomConnections = activeRooms.get(roomId);
    if (roomConnections) {
      let forwardedCount = 0;
      roomConnections.forEach((otherWs) => {
        if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
          otherWs.send(message);
          forwardedCount++;
        }
      });
      console.log(
        `[DEBUG] Forwarded message to ${forwardedCount} other clients in room ${roomId}`
      );
    }
  });

  // Handle connection close
  ws.on("close", () => {
    console.log(
      `[DEBUG] Connection ${ws.connectionId} closed for room: ${roomId}`
    );
    const roomConnections = activeRooms.get(roomId);
    if (roomConnections) {
      roomConnections.delete(ws);
      if (roomConnections.size === 0) {
        activeRooms.delete(roomId);
        console.log(`[DEBUG] Room ${roomId} is now empty and removed`);
      } else {
        console.log(
          `[DEBUG] Room ${roomId} now has ${roomConnections.size} connections`
        );
      }
    }
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(
      `[DEBUG] WebSocket error for connection ${ws.connectionId} in room ${roomId}:`,
      error
    );
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[DEBUG] Custom WebSocket server running on ${HOST}:${PORT}`);
  console.log(
    `[DEBUG] Health check available at http://${HOST}:${PORT}/health`
  );
  console.log(
    `[DEBUG] Room management API available at http://${HOST}:${PORT}/api/rooms/:roomId/end`
  );
  console.log(`[DEBUG] Server started at ${new Date().toISOString()}`);
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
