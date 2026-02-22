// backend/src/index.ts
export interface Env {
  ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('roomId');
    if (!roomId) {
      return new Response('Missing roomId', { status: 400 });
    }

    // Get or create the Durable Object for this room
    const id = env.ROOM.idFromName(roomId);
    const room = env.ROOM.get(id);

    // Forward the request to the Durable Object
    return room.fetch(request);
  }
};

// Durable Object that holds room state and WebSocket connections
export class Room implements DurableObject {
  private sessions: Map<WebSocket, any> = new Map();
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // Check if it's a WebSocket upgrade request
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.sessions.set(server, {});
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Otherwise, it's a REST API call (optional, not used)
    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string);

    // Broadcast to all other clients in the room
    this.sessions.forEach((_, client) => {
      if (client !== ws && client.readyState === WebSocket.READY_STATE_OPEN) {
        client.send(JSON.stringify(data));
      }
    });

    // If it's a state update (sync), persist it
    if (data.type === 'sync') {
      await this.state.storage?.put('roomState', data.payload);
    }

    // If it's a WebRTC signaling message, forward only to the intended peer
    if (data.type === 'signal') {
      const targetClient = this.getClientById(data.targetId);
      if (targetClient && targetClient.readyState === WebSocket.READY_STATE_OPEN) {
        targetClient.send(JSON.stringify(data));
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.sessions.delete(ws);
    // Notify others that user left
    this.broadcast({ type: 'user-left', userId: this.getUserId(ws) });
  }

  // Helper methods
  private getClientById(id: string): WebSocket | undefined {
    for (let [client] of this.sessions) {
      if (this.getUserId(client) === id) return client;
    }
  }

  private getUserId(ws: WebSocket): string {
    return this.sessions.get(ws)?.userId;
  }

  private broadcast(message: any) {
    const msg = JSON.stringify(message);
    this.sessions.forEach((_, client) => {
      if (client.readyState === WebSocket.READY_STATE_OPEN) {
        client.send(msg);
      }
    });
  }
}
