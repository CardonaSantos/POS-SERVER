import { Module } from '@nestjs/common';
import { TransferenciaProductoService } from './transferencia-producto.service';
import { TransferenciaProductoController } from './transferencia-producto.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationService } from 'src/notification/notification.service';
import { WebsocketGateway } from 'src/web-sockets/websocket.gateway';

@Module({
  controllers: [TransferenciaProductoController],
  providers: [
    TransferenciaProductoService,
    PrismaService,
    NotificationService,
    WebsocketGateway,
  ],
})
export class TransferenciaProductoModule {}
