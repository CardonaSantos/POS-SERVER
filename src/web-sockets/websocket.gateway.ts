import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { NotificationToEmit } from './Types/NotificationTypeSocket';
import { nuevaSolicitud } from './Types/SolicitudType';
import { solicitudTransferencia } from './Types/TransferenciaType';

@Injectable()
@WebSocketGateway()
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Mantenemos tres mapas separados para diferentes roles
  private vendedores: Map<number, string> = new Map();
  private admins: Map<number, string> = new Map();
  private usuarios: Map<number, string> = new Map();

  // Método para extraer userID desde client
  private getUserIDFromClient(client: Socket): number {
    return parseInt(client.handshake.query.userID as string, 10);
  }

  // Método para extraer el rol del cliente
  private getUserRoleFromClient(client: Socket): string {
    return client.handshake.query.rol as string;
  }

  handleConnection(client: Socket) {
    const userID = this.getUserIDFromClient(client);
    const rol = this.getUserRoleFromClient(client);

    // Validamos que el userID sea un número y que no esté duplicado
    if (!isNaN(userID)) {
      if (this.usuarios.has(userID)) {
        console.log(`Conexión duplicada detectada para el usuario ${userID}.`);
        client.disconnect(); // Desconecta el socket duplicado
      } else {
        this.usuarios.set(userID, client.id); // Guardamos en el mapa general

        // Asignamos al mapa correspondiente según el rol
        if (rol === 'ADMIN') {
          this.admins.set(userID, client.id);
        } else {
          this.vendedores.set(userID, client.id);
        }

        console.log(
          `Cliente conectado: UserID: ${userID}, SocketID: ${client.id}`,
        );
        this.logUsuarios(); // Log de los usuarios conectados
      }
    } else {
      console.log(`ID de usuario inválido: ${userID}`);
    }
  }

  handleDisconnect(client: Socket) {
    const userID = this.getUserIDFromClient(client);
    const rol = this.getUserRoleFromClient(client);

    // Eliminamos el cliente de todos los mapas
    if (!isNaN(userID)) {
      this.usuarios.delete(userID);
      if (rol === 'ADMIN') {
        this.admins.delete(userID);
      } else {
        this.vendedores.delete(userID);
      }
      console.log(
        `Cliente desconectado: UserID: ${userID}, SocketID: ${client.id}`,
      );
      this.logUsuarios();
    }
  }

  @SubscribeMessage('enviarNotificacion')
  handleEnviarNotificacion(
    notificacion: NotificationToEmit,
    usuarioId: number,
  ) {
    const socketID = this.usuarios.get(usuarioId);

    console.log('Notificación recibida:', notificacion);

    if (socketID) {
      this.server.to(socketID).emit('recibirNotificacion', notificacion);
      console.log(
        `Notificación enviada a usuario: ${usuarioId} en SocketID: ${socketID}`,
      );
    } else {
      console.log(`No se encontró el SocketID para el usuario ${usuarioId}`);
    }
  }

  //ENVIAR LAS SOLICITUDES A LOS ADMINS:::::::::::
  handleEnviarSolicitudPrecio(solicitud: nuevaSolicitud, userID: number) {
    const SOCKEID_ADMIN = this.admins.get(userID);

    if (SOCKEID_ADMIN) {
      this.server.to(SOCKEID_ADMIN).emit('recibirSolicitud', solicitud);
    } else {
      console.log(
        `No se encontró el SocketID para el usuario administrador ${userID}`,
      );
    }
  }

  //ENVIAR SOLICITUD DE TRANSFERENCIA
  handleEnviarSolicitudTransferencia(
    solicitudTransferencia: solicitudTransferencia,
    userID: number,
  ) {
    const SOCKEID_ADMIN = this.admins.get(userID);

    if (SOCKEID_ADMIN) {
      this.server
        .to(SOCKEID_ADMIN)
        .emit('recibirSolicitudTransferencia', solicitudTransferencia);
    } else {
      console.log(
        `No se encontró el SocketID para el usuario administrador ${userID}`,
      );
    }
  }

  // Funciones para loggear el estado de los mapas
  private logUsuarios() {
    console.log(`Usuarios conectados: ${this.usuarios.size}`);
    console.log(`Admins conectados: ${this.admins.size}`);
    console.log(`Vendedores conectados: ${this.vendedores.size}`);
  }
}
