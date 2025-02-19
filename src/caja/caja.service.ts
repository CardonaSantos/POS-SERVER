import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateCajaDto } from './dto/create-caja.dto';
import { UpdateCajaDto } from './dto/update-caja.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DepositoDto } from './dto/deposito.dto';
import { EgresoDto } from './dto/egreso.dto';
import { OpenRegistDTO } from './dto/open-regist.dto';

@Injectable()
export class CajaService {
  constructor(private readonly prisma: PrismaService) {}

  //CERRAR EL REGISTRO DE CAJA
  async createCajaRegist(createCajaDto: CreateCajaDto) {
    try {
      console.log('los ids de ventas son: ', createCajaDto.ventasIds);

      console.log(
        'Los datos para crear el cierre de caja son: ',
        createCajaDto,
      );

      if (!createCajaDto.id || createCajaDto.saldoFinal === undefined) {
        throw new BadRequestException(
          'Faltan datos requeridos para cerrar el registro de caja',
        );
      }

      const registUpdate = await this.prisma.registroCaja.update({
        where: {
          id: createCajaDto.id,
        },
        data: {
          comentario: createCajaDto.comentario,
          estado: 'CERRADO',
          fechaCierre: new Date(),
          saldoFinal: Number(createCajaDto.saldoFinal),
        },
      });

      // Actualizar depósitos asociados
      if (createCajaDto.depositosIds?.length) {
        await this.prisma.deposito.updateMany({
          where: { id: { in: createCajaDto.depositosIds } },
          data: { registroCajaId: registUpdate.id },
        });
      }

      // Actualizar egresos asociados
      if (createCajaDto.egresosIds?.length) {
        await this.prisma.egreso.updateMany({
          where: { id: { in: createCajaDto.egresosIds } },
          data: { registroCajaId: registUpdate.id },
        });
      }

      //ACTUALIZAR Y LIGAR LAS VENTAS
      if (createCajaDto.ventasIds?.length) {
        await this.prisma.venta.updateMany({
          where: { id: { in: createCajaDto.ventasIds } },
          data: { registroCajaId: registUpdate.id },
        });
      }

      // Buscar la meta más reciente no cumplida o no finalizada
      let metaMasReciente = await this.prisma.metaUsuario.findFirst({
        where: {
          usuarioId: Number(createCajaDto.usuarioId),
          cumplida: false,
          estado: 'ABIERTO', // Meta activa
        },
        orderBy: {
          fechaInicio: 'desc', // Ordena por la fecha más reciente
        },
      });

      // Si no encuentra una meta activa, buscar las más antiguas abiertas
      while (!metaMasReciente) {
        metaMasReciente = await this.prisma.metaUsuario.findFirst({
          where: {
            usuarioId: Number(createCajaDto.usuarioId),
            cumplida: false,
            estado: 'ABIERTO', // Meta activa
          },
          orderBy: {
            fechaInicio: 'desc', // Ordena por la fecha más reciente
          },
        });

        if (!metaMasReciente) {
          throw new BadRequestException(
            `No se encontró ninguna meta activa para el usuario con ID ${createCajaDto.usuarioId}`,
          );
        }
      }

      // Actualiza la meta encontrada
      const metaTienda = await this.prisma.metaUsuario.update({
        where: {
          id: metaMasReciente.id,
        },
        data: {
          montoActual: {
            increment: Number(createCajaDto.saldoFinal) || 0, // Incrementa el monto actual
          },
        },
      });

      // Si la meta ya se cumplió, finalízala
      // Actualiza la meta encontrada
      // await this.prisma.metaUsuario.update({
      //   where: {
      //     id: metaMasReciente.id,
      //   },
      //   data: {
      //     montoActual: {
      //       increment: Number(createCajaDto.saldoFinal) || 0, // Incrementa el monto actual
      //     },
      //   },
      // });

      // Vuelve a consultar la meta actualizada
      const metaActualizada = await this.prisma.metaUsuario.findUnique({
        where: {
          id: metaMasReciente.id,
        },
      });

      // Si la meta ya se cumplió, finalízala
      if (metaActualizada.montoActual >= metaActualizada.montoMeta) {
        await this.prisma.metaUsuario.update({
          where: {
            id: metaActualizada.id,
          },
          data: {
            cumplida: true,
            estado: 'FINALIZADO',
            fechaCumplida: new Date(),
          },
        });
      }

      console.log('El registro de meta de tienda actualizado es: ', metaTienda);
      return registUpdate;
    } catch (error) {
      console.error('Error al cerrar el registro de caja:', error);
      throw new BadRequestException('Error al cerrar el registro de caja');
    }
  }

  //ABRIR EL REGISTRO DE CAJA CON DATOS PRIMARIOS
  async createRegistCash(createCajaDto: OpenRegistDTO) {
    try {
      console.log('Datos: ', createCajaDto);

      if (
        !createCajaDto.sucursalId ||
        !createCajaDto.usuarioId ||
        createCajaDto.saldoInicial === undefined
      ) {
        throw new BadRequestException(
          'Faltan datos requeridos para abrir el registro de caja',
        );
      }

      const firstCashRegist = await this.prisma.registroCaja.create({
        data: {
          sucursalId: createCajaDto.sucursalId,
          usuarioId: createCajaDto.usuarioId,
          saldoInicial: Number(createCajaDto.saldoInicial),
          estado: 'ABIERTO',
          comentario: createCajaDto.comentario,
        },
      });

      return firstCashRegist;
    } catch (error) {
      console.error('Error al abrir el registro de caja:', error);
      throw new InternalServerErrorException(
        'No se pudo abrir el registro de caja',
      );
    }
  }

  //CONSEGUIR EL ULTIMO REGISTRO DE CAJA ABIERTO DE MI SUCURSAL, CON ESTE USUARIO LOGUEADO - PARA EL TERNARIO
  async findOpenCashRegist(sucursalId: number, userId: number) {
    try {
      const openCashRegist = await this.prisma.registroCaja.findFirst({
        where: {
          sucursalId: sucursalId,
          usuarioId: userId,
          // fechaCierre: null,
          estado: 'ABIERTO',
        },
        orderBy: {
          fechaInicio: 'desc', // Ordenar para obtener el más reciente
        },
        include: {
          usuario: {
            select: {
              nombre: true,
              id: true,
              rol: true,
            },
          },
        },
      });

      console.log('El registro abierto es: ', openCashRegist);

      return openCashRegist;
    } catch (error) {
      console.error('Error al conseguir el registro de caja abierto:', error);
      throw new InternalServerErrorException(
        'No se pudo encontrar el registro de caja abierto',
      );
    }
  }

  //FALTA INCREMENTAR EL SALDO-YA VINCULADO
  async registDeposit(depositoDto: DepositoDto) {
    try {
      console.log('Los datos del deposito son: ', depositoDto);

      const deposito = await this.prisma.deposito.create({
        data: {
          banco: depositoDto.banco,
          monto: Number(depositoDto.monto),
          numeroBoleta: depositoDto.numeroBoleta,
          usadoParaCierre: depositoDto.usadoParaCierre || false,
          sucursalId: depositoDto.sucursalId,
          descripcion: depositoDto.descripcion,
          usuarioId: depositoDto.usuarioId,
        },
      });

      await this.prisma.sucursalSaldo.update({
        where: {
          sucursalId: depositoDto.sucursalId,
        },
        data: {
          totalEgresos: {
            //INCREMENTARLAS PERDIDAS
            increment: Number(depositoDto.monto),
          },
          saldoAcumulado: {
            //DECREMENTAR EL SALDO ACTUAL
            decrement: Number(depositoDto.monto),
          },
        },
      });

      return deposito;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al crear registro de deposito');
    }
  }

  //FALTA RESTAR EL SALDO-YA VINCULADO
  async registEgreso(egresoDto: EgresoDto) {
    try {
      const nuevoRegistroEgreso = await this.prisma.egreso.create({
        data: {
          descripcion: egresoDto.descripcion,
          monto: Number(egresoDto.monto),
          sucursalId: egresoDto.sucursalId,
          usuarioId: egresoDto.usuarioId,
        },
      });

      await this.prisma.sucursalSaldo.update({
        where: {
          sucursalId: egresoDto.sucursalId,
        },
        data: {
          totalEgresos: {
            increment: Number(egresoDto.monto),
          },
          saldoAcumulado: {
            decrement: Number(egresoDto.monto),
          },
        },
      });

      return nuevoRegistroEgreso;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al crear registro de egreso');
    }
  }

  async findAllMyDeposti(idSucursal: number) {
    try {
      const misRegistrosDepositos = await this.prisma.deposito.findMany({
        orderBy: {
          fechaDeposito: 'desc',
        },
        where: {
          sucursalId: idSucursal,
          registroCajaId: null,
        },
        include: {
          usuario: {
            select: {
              id: true,
              nombre: true,
              rol: true,
            },
          },
          sucursal: {
            select: {
              id: true,
              nombre: true,
            },
          },
        },
      });
      return misRegistrosDepositos;
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        'Error al encontrart registros no vinculador de esta sucursal',
      );
    }
  }

  async findAllMyEgresos(idSucursal: number) {
    try {
      const misRegistrosDepositos = await this.prisma.egreso.findMany({
        where: {
          sucursalId: idSucursal,
          registroCajaId: null,
        },
        include: {
          usuario: {
            select: {
              id: true,
              nombre: true,
              rol: true,
            },
          },
        },
      });
      console.log('buscando egresos');

      return misRegistrosDepositos;
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        'Error al encontrart registros no vinculador de esta sucursal',
      );
    }
  }

  async findAllCashRegister(idSucursal: number) {
    try {
      const data = await this.prisma.registroCaja.findMany({
        orderBy: {
          fechaCierre: 'desc',
        },
        where: {
          sucursalId: idSucursal,
        },
        include: {
          ventas: {
            orderBy: {
              fechaVenta: 'desc',
            },
            select: {
              fechaVenta: true,
              id: true,
              productos: {
                select: {
                  cantidad: true,
                  producto: {
                    select: {
                      id: true,
                      nombre: true,
                      codigoProducto: true,
                    },
                  },
                },
              },
            },
          },
          depositos: {
            orderBy: {
              fechaDeposito: 'desc',
            },
            select: {
              banco: true,
              descripcion: true,
              fechaDeposito: true,
              id: true,
              monto: true,
              numeroBoleta: true,
              usadoParaCierre: true,
              usuario: {
                select: {
                  id: true,
                  nombre: true,
                  rol: true,
                },
              },
            },
          },
          egresos: {
            orderBy: {
              fechaEgreso: 'desc',
            },
            select: {
              id: true,
              descripcion: true,
              fechaEgreso: true,
              monto: true,
              usuario: {
                select: {
                  id: true,
                  nombre: true,
                  rol: true,
                },
              },
            },
          },
          sucursal: {
            select: {
              id: true,
              nombre: true,
            },
          },
          usuario: {
            select: {
              id: true,
              nombre: true,
              rol: true,
            },
          },
        },
      });
      return data;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'Error al conseguir datos de registros de cajas',
      );
    }
  }

  async setNull(sucursalId: number) {
    try {
      const saldoSucursal = await this.prisma.sucursalSaldo.update({
        where: {
          sucursalId: sucursalId,
        },
        data: {
          saldoAcumulado: {
            set: 0,
          },
          totalEgresos: {
            set: 0,
          },
          totalIngresos: {
            set: 0,
          },
        },
      });

      console.log('El registro actualizado es: ', saldoSucursal);
    } catch (error) {}
  }

  findAll() {
    return `This action returns all caja`;
  }

  findOne(id: number) {
    return `This action returns a #${id} caja`;
  }

  update(id: number, updateCajaDto: UpdateCajaDto) {
    return `This action updates a #${id} caja`;
  }

  remove(id: number) {
    return `This action removes a #${id} caja`;
  }
}
