import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true },
  transports: ['websocket'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly redisSub: Redis;

  constructor() {
    this.redisSub = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
    this.redisSub.subscribe('telemetry:broadcast');
    this.redisSub.on('message', (ch, msg) => {
      if (ch === 'telemetry:broadcast') {
        if (!this.server) return;
        const evt = JSON.parse(msg);
        const room = evt.payload?.organizationId ? `org:${evt.payload.organizationId}` : 'global';
        this.server.to(room).to('global').emit('telemetry', {
          type: evt.type,
          payload: evt.payload,
          timestamp: evt.timestamp,
        });
      }
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected ${client.id}`);
    client.join('global');
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected ${client.id}`);
  }

  @SubscribeMessage('subscribe:organization')
  handleSubOrg(client: Socket, orgId: string) {
    client.join(`org:${orgId}`);
    this.logger.debug(`Client ${client.id} joined org:${orgId}`);
  }
}
