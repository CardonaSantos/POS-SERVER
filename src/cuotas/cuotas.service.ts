import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateCuotaDto } from './dto/create-cuota.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateVentaCuotaDto } from './dto/update-cuota.dto';
import { CreateVentaCuotaDto } from './dto/create-ventacuota.dto';
import { CreatePlantillaComprobanteDto } from './dto/plantilla-comprobante.dt';
import { CuotaDto } from './dto/registerNewPay';
import { CloseCreditDTO } from './dto/close-credit.dto';
import { CreditoRegistro, Testigo } from './TypeCredit';
import { DeleteOneRegistCreditDto } from './dto/delete-one-regist.dto';

import * as bcrypt from 'bcryptjs';
import * as dayjs from 'dayjs';
import { DeleteCuotaPaymentDTO } from './dto/delete-one-payment-cuota.dto';

@Injectable()
export class CuotasService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createVentaCuotaDto: CreateVentaCuotaDto) {
    try {
      console.log('Los datos entrantes son: ', createVentaCuotaDto);

      // Convertir las fechas a UTC para evitar problemas de zona horaria, solo la parte de la fecha (sin hora)
      const fechaIniciox = dayjs(createVentaCuotaDto.fechaInicio)
        .startOf('day')
        .toDate(); // Aseguramos que la hora sea 00:00
      const fechaContrato = createVentaCuotaDto.fechaContrato
        ? dayjs(createVentaCuotaDto.fechaContrato).startOf('day').toDate()
        : null;

      console.log('Fecha de inicio convertida: ', fechaIniciox);
      console.log('Fecha de contrato convertida: ', fechaContrato);

      // 1. Consolidar productos para evitar duplicados
      const productosConsolidados = createVentaCuotaDto.productos.reduce(
        (acc, prod) => {
          const existingProduct = acc.find(
            (p) => p.productoId === prod.productoId,
          );
          if (existingProduct) {
            existingProduct.cantidad += prod.cantidad;
          } else {
            acc.push(prod);
          }
          return acc;
        },
        [],
      );

      console.log('Productos consolidados: ', productosConsolidados);

      // 2. Verificar disponibilidad de stock
      const stockUpdates = [];
      for (const prod of productosConsolidados) {
        const stocks = await this.prisma.stock.findMany({
          where: {
            productoId: prod.productoId,
            sucursalId: createVentaCuotaDto.sucursalId,
          },
          orderBy: { fechaIngreso: 'asc' },
        });

        let cantidadRestante = prod.cantidad;

        for (const stock of stocks) {
          if (cantidadRestante <= 0) break;

          if (stock.cantidad >= cantidadRestante) {
            stockUpdates.push({
              id: stock.id,
              cantidad: stock.cantidad - cantidadRestante,
            });
            cantidadRestante = 0;
          } else {
            stockUpdates.push({ id: stock.id, cantidad: 0 });
            cantidadRestante -= stock.cantidad;
          }
        }

        if (cantidadRestante > 0) {
          throw new Error(
            `No hay suficiente stock para el producto ${prod.productoId}`,
          );
        }
      }

      console.log('Actualizaciones de stock: ', stockUpdates);

      // 3. Actualizar stock en la base de datos
      await this.prisma.$transaction(
        stockUpdates.map((stock) =>
          this.prisma.stock.update({
            where: { id: stock.id },
            data: { cantidad: stock.cantidad },
          }),
        ),
      );

      // 4. Crear la venta (productos se crean aquí para evitar duplicados)
      const venta = await this.prisma.venta.create({
        data: {
          clienteId: Number(createVentaCuotaDto.clienteId),
          sucursalId: Number(createVentaCuotaDto.sucursalId),
          totalVenta: Number(createVentaCuotaDto.totalVenta),
          productos: {
            create: productosConsolidados.map((prod) => ({
              producto: { connect: { id: prod.productoId } },
              cantidad: prod.cantidad,
              precioVenta: prod.precioVenta,
            })),
          },
        },
      });

      console.log('La venta creada es: ', venta);

      // 5. Registrar el pago inicial
      const pago = await this.prisma.pago.create({
        data: {
          ventaId: venta.id,
          monto: createVentaCuotaDto.cuotaInicial,
          metodoPago: 'CREDITO',
          fechaPago: new Date(),
        },
      });

      console.log('El pago inicial registrado es: ', pago);

      // 6. Crear el registro de crédito (VentaCuota)
      const ventaCuota = await this.prisma.ventaCuota.create({
        data: {
          clienteId: Number(createVentaCuotaDto.clienteId),
          usuarioId: Number(createVentaCuotaDto.usuarioId),
          sucursalId: Number(createVentaCuotaDto.sucursalId),
          totalVenta: Number(createVentaCuotaDto.totalVenta),
          cuotaInicial: Number(createVentaCuotaDto.cuotaInicial),
          cuotasTotales: Number(createVentaCuotaDto.cuotasTotales),
          fechaInicio: fechaIniciox,
          diasEntrePagos: Number(createVentaCuotaDto.diasEntrePagos),
          interes: Number(createVentaCuotaDto.interes),
          estado: createVentaCuotaDto.estado,
          dpi: createVentaCuotaDto.dpi,
          ventaId: venta.id,
          montoTotalConInteres: createVentaCuotaDto.montoTotalConInteres,
          testigos: createVentaCuotaDto.testigos ?? null,
          fechaContrato: fechaIniciox,
          montoVenta: Number(createVentaCuotaDto.montoVenta),
          garantiaMeses: Number(createVentaCuotaDto.garantiaMeses),
          totalPagado: Number(createVentaCuotaDto.cuotaInicial),
        },
      });

      console.log('El registro de venta a crédito es: ', ventaCuota);

      // CREAR LAS CUOTAS Y DEMÁS
      const montoTotalConInteres = Number(
        createVentaCuotaDto.montoTotalConInteres,
      );
      const cuotaInicial = Number(createVentaCuotaDto.cuotaInicial);
      const cuotasTotales = Number(createVentaCuotaDto.cuotasTotales);
      const diasEntrePagos = Number(createVentaCuotaDto.diasEntrePagos);
      const fechaInicio = dayjs(fechaIniciox);

      const montoPorCuota =
        (montoTotalConInteres - cuotaInicial) / cuotasTotales;

      for (let i = 1; i <= cuotasTotales; i++) {
        const fechaVencimiento = fechaInicio
          .add(diasEntrePagos * i, 'day')
          .toDate();

        let s = await this.prisma.cuota.create({
          data: {
            ventaCuotaId: ventaCuota.id,
            montoEsperado: montoPorCuota,
            fechaVencimiento: fechaVencimiento,
            estado: 'PENDIENTE',
            monto: 0, // Inicializar en 0 hasta que se pague
          },
        });
        console.log('La fecha creada es: ', s);
      }

      console.log('Incrementando saldo');

      const saldos = await this.prisma.sucursalSaldo.update({
        where: {
          sucursalId: createVentaCuotaDto.sucursalId,
        },
        data: {
          saldoAcumulado: {
            increment: createVentaCuotaDto.totalVenta,
          },
          totalIngresos: {
            increment: createVentaCuotaDto.totalVenta,
          },
        },
      });
      console.log('Incrementando saldo', saldos);

      return ventaCuota;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error al crear el registro de crédito');
    }
  }

  async createPlantilla(
    createPlantillaComprobanteDto: CreatePlantillaComprobanteDto,
  ) {
    try {
      const plantilla = await this.prisma.plantillaComprobante.create({
        data: {
          nombre: createPlantillaComprobanteDto.nombre,
          texto: createPlantillaComprobanteDto.texto,
          sucursalId: createPlantillaComprobanteDto.sucursalId || null,
        },
      });
      return plantilla;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error');
    }
  }

  // async registerNewPay(createCuotaDto: CuotaDto) {
  //   try {
  //     // const hoy = dayjs();
  //     const cuotaID = createCuotaDto.ventaCuotaId;
  //     const CreditoID = createCuotaDto.CreditoID;
  //     // 1. Crear el registro del pago
  //     const cuotaA_Actualizar = await this.prisma.cuota.update({
  //       where: {
  //         id: cuotaID,
  //       },
  //       data: {
  //         monto: createCuotaDto.monto,
  //         estado: createCuotaDto.estado,
  //         usuarioId: createCuotaDto.usuarioId,
  //         comentario: createCuotaDto.comentario,
  //         fechaPago: new Date(),
  //       },
  //     });

  //     // 2. Actualizar el total pagado en la VentaCuota
  //     const ventaCuotaActualizada = await this.prisma.ventaCuota.update({
  //       where: {
  //         id: createCuotaDto.CreditoID,
  //       },
  //       data: {
  //         totalPagado: {
  //           increment: createCuotaDto.monto,
  //         },
  //       },
  //       include: {
  //         venta: true, // Incluir la venta asociada
  //       },
  //     });

  //     if (!ventaCuotaActualizada) {
  //       throw new NotFoundException('Registro no encontrado');
  //     }

  //     // 3. Actualizar el totalVenta en la Venta asociada (si existe)
  //     if (ventaCuotaActualizada.venta) {
  //       await this.prisma.venta.update({
  //         where: {
  //           id: ventaCuotaActualizada.venta.id, // Usar la relación directa con Venta
  //         },
  //         data: {
  //           totalVenta: {
  //             increment: createCuotaDto.monto,
  //           },
  //         },
  //       });
  //     }
  //     return cuotaA_Actualizar;
  //   } catch (error) {
  //     console.error('Error en registerNewPay:', error);
  //     throw new BadRequestException('Error al registrar pago de cuota');
  //   }
  // }

  async registerNewPay(createCuotaDto: CuotaDto) {
    try {
      // 1. Update the cuota (payment) record
      const cuotaA_Actualizar = await this.prisma.cuota.update({
        where: { id: createCuotaDto.ventaCuotaId },
        data: {
          monto: createCuotaDto.monto,
          estado: createCuotaDto.estado,
          usuarioId: createCuotaDto.usuarioId,
          comentario: createCuotaDto.comentario,
          fechaPago: new Date(),
        },
      });

      // 2. Update the total paid in VentaCuota
      const ventaCuotaActualizada = await this.prisma.ventaCuota.update({
        where: { id: createCuotaDto.CreditoID },
        data: {
          totalPagado: { increment: createCuotaDto.monto },
        },
        include: { venta: true },
      });

      if (!ventaCuotaActualizada) {
        throw new NotFoundException('Registro no encontrado');
      }

      // 3. Update the totalVenta in the associated Venta (if exists)
      if (ventaCuotaActualizada.venta) {
        await this.prisma.venta.update({
          where: { id: ventaCuotaActualizada.venta.id },
          data: {
            totalVenta: { increment: createCuotaDto.monto },
          },
        });
      }

      // 4. Search for the most recent active meta for the user
      let metaMasReciente = await this.prisma.metaUsuario.findFirst({
        where: {
          usuarioId: Number(createCuotaDto.usuarioId),
          estado: { in: ['ABIERTO', 'FINALIZADO'] },
        },
        orderBy: { fechaInicio: 'desc' },
      });

      // If a meta is found, update its montoActual
      if (metaMasReciente) {
        const metaTienda = await this.prisma.metaUsuario.update({
          where: {
            id: metaMasReciente.id,
            estado: { in: ['ABIERTO', 'FINALIZADO'] },
          },
          data: { montoActual: { increment: createCuotaDto.monto } },
        });

        const metaActualizada = await this.prisma.metaUsuario.findUnique({
          where: { id: metaMasReciente.id },
        });

        if (metaActualizada.montoActual >= metaActualizada.montoMeta) {
          await this.prisma.metaUsuario.update({
            where: { id: metaActualizada.id },
            data: {
              cumplida: true,
              estado: 'FINALIZADO',
              fechaCumplida: new Date(),
            },
          });
        }
        console.log(
          'El registro de meta de tienda actualizado es: ',
          metaTienda,
        );
      } else {
        console.warn(
          `No se encontró ninguna meta activa para el usuario con ID ${createCuotaDto.usuarioId}`,
        );
        // Continue normally without updating any meta
      }

      return cuotaA_Actualizar;
    } catch (error) {
      console.error('Error en registerNewPay:', error);
      throw new BadRequestException('Error al registrar pago de cuota');
    }
  }

  async getCredutsWithoutPaying() {
    const credits = await this.prisma.ventaCuota.findMany({
      where: {
        estado: {
          notIn: ['CANCELADA', 'COMPLETADA'],
        },
      },
      orderBy: {
        creadoEn: 'desc',
      },
      include: {
        cuotas: {
          select: {
            id: true,
            creadoEn: true,
            estado: true,
            monto: true,
            fechaPago: true,
            fechaVencimiento: true,
          },
        },
        cliente: {
          select: {
            id: true,
            nombre: true,
          },
        },
        // productos: {
        //   orderBy: {
        //     precioVenta: 'desc',
        //   },
        //   include: {
        //     producto: {
        //       select: {
        //         id: true,
        //         nombre: true,
        //         codigoProducto: true,
        //       },
        //     },
        //   },
        // },
        sucursal: {
          select: {
            id: true,
            nombre: true,
            direccion: true,
          },
        },
        usuario: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
    });
    return credits;
  }

  async getPlantillas() {
    try {
      const plantillas = await this.prisma.plantillaComprobante.findMany({
        orderBy: {
          creadoEn: 'desc',
        },
      });
      return plantillas;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al conseguir la plantilla');
    }
  }

  async getAllCredits(): Promise<CreditoRegistro[]> {
    try {
      const credits = await this.prisma.ventaCuota.findMany({
        orderBy: {
          creadoEn: 'desc',
        },
        include: {
          cliente: {
            select: {
              id: true,
              nombre: true,
              telefono: true,
              direccion: true,
              dpi: true,
            },
          },
          sucursal: {
            select: {
              id: true,
              nombre: true,
              direccion: true,
            },
          },
          usuario: {
            select: {
              id: true,
              nombre: true,
            },
          },
          cuotas: {
            select: {
              id: true,
              creadoEn: true,
              estado: true,
              fechaPago: true,
              monto: true,
              comentario: true,
              usuario: {
                select: {
                  id: true,
                  nombre: true,
                },
              },
            },
          },
          venta: {
            include: {
              productos: {
                include: {
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
        },
      });

      // Transformar los datos
      const formattedCredits: CreditoRegistro[] = credits.map((credit) => ({
        id: credit.id,
        clienteId: credit.clienteId,
        usuarioId: credit.usuarioId,
        sucursalId: credit.sucursalId,
        totalVenta: credit.totalVenta,
        cuotaInicial: credit.cuotaInicial,
        cuotasTotales: credit.cuotasTotales,
        fechaInicio: credit.fechaInicio.toISOString(),
        estado: credit.estado,
        creadoEn: credit.creadoEn.toISOString(),
        actualizadoEn: credit.actualizadoEn.toISOString(),
        dpi: credit.cliente.dpi,
        testigos: Array.isArray(credit.testigos)
          ? (credit.testigos as unknown as Testigo[])
          : [],
        fechaContrato: credit.fechaContrato.toISOString(),
        montoVenta: credit.montoVenta,
        garantiaMeses: credit.garantiaMeses,
        totalPagado: credit.totalPagado,
        cliente: credit.cliente,
        productos:
          credit.venta?.productos.map((vp) => ({
            id: vp.id,
            ventaId: vp.ventaId,
            productoId: vp.productoId,
            cantidad: vp.cantidad,
            creadoEn: vp.creadoEn.toISOString(),
            precioVenta: vp.precioVenta,
            producto: {
              id: vp.producto.id,
              nombre: vp.producto.nombre,
              codigoProducto: vp.producto.codigoProducto,
            },
          })) || [],
        sucursal: credit.sucursal,
        usuario: credit.usuario,
        cuotas: credit.cuotas.map((cuota) => ({
          id: cuota.id,
          creadoEn: cuota.creadoEn.toISOString(),
          estado: cuota.estado,
          fechaPago: cuota.fechaPago?.toISOString() || null,
          monto: cuota.monto,
          comentario: cuota.comentario,
          usuario: cuota.usuario
            ? {
                id: cuota.usuario.id,
                nombre: cuota.usuario.nombre,
              }
            : null,
        })),
        diasEntrePagos: credit.diasEntrePagos,
        interes: credit.interes,
        comentario: credit.comentario,
        montoTotalConInteres: credit.montoTotalConInteres,
      }));

      return formattedCredits;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error al recuperar los créditos');
    }
  }

  async getPlantilla(id: number) {
    try {
      const plantilla = await this.prisma.plantillaComprobante.findUnique({
        where: {
          id,
        },
      });
      return plantilla.texto;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al conseguir la plantilla');
    }
  }

  async getPlantillaToEdit(id: number) {
    try {
      const plantilla = await this.prisma.plantillaComprobante.findUnique({
        where: {
          id,
        },
      });
      return plantilla;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al conseguir la plantilla');
    }
  }

  async getCuota(id: number): Promise<{
    id: number;
    fechaContrato: string;
    cliente: {
      id: number;
      nombre: string;
      telefono: string;
      direccion: string;
      dpi: string;
    };
    usuario: {
      id: number;
      nombre: string;
    };
    testigos: {
      nombre: string;
      telefono: string;
      direccion: string;
    }[];
    sucursal: {
      id: number;
      nombre: string;
      direccion: string;
    };
    productos: {
      id: number;
      ventaId: number;
      productoId: number;
      cantidad: number;
      creadoEn: string;
      precioVenta: number;
      producto: {
        id: number;
        nombre: string;
        codigoProducto: string;
      };
    }[];
    montoVenta: number;
    cuotaInicial: number;
    cuotasTotales: number;
    garantiaMeses: number;
    dpi: string;
    diasEntrePagos: number;
    interes: number;
    totalVenta: number;
    montoTotalConInteres: number;
    totalPagado: number;

    //-----------------
    // id, // Código único del contrato
    // fechaContrato, // Fecha del contrato
    // cliente, // Información del cliente
    // usuario, // Información del vendedor
    // testigos, // Lista de testigos
    // sucursal, // Sucursal involucrada
    // productos, // Lista de productos vendidos
    // montoVenta, // Monto total de la venta
    // cuotaInicial, // Pago inicial
    // cuotasTotales, // Número total de cuotas
    // garantiaMeses, // Meses de garantía
    // dpi, // DPI del cliente
    // diasEntrePagos,
    // interes,
    // totalVenta,
  }> {
    try {
      const cuota = await this.prisma.ventaCuota.findUnique({
        where: {
          id,
        },
        include: {
          cliente: {
            select: {
              id: true,
              nombre: true,
              telefono: true,
              direccion: true,
              dpi: true,
            },
          },
          sucursal: {
            select: {
              id: true,
              nombre: true,
              direccion: true,
            },
          },
          usuario: {
            select: {
              id: true,
              nombre: true,
            },
          },
          venta: {
            include: {
              productos: {
                include: {
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
        },
      });

      if (!cuota) {
        throw new Error('No se encontró la cuota solicitada');
      }

      return {
        id: cuota.id,
        fechaContrato: cuota.fechaContrato.toISOString(),
        cliente: {
          id: cuota.cliente.id,
          nombre: cuota.cliente.nombre,
          telefono: cuota.cliente.telefono,
          direccion: cuota.cliente.direccion,
          dpi: cuota.cliente.dpi,
        },
        usuario: {
          id: cuota.usuario.id,
          nombre: cuota.usuario.nombre,
        },
        testigos: Array.isArray(cuota.testigos)
          ? (cuota.testigos as {
              nombre: string;
              telefono: string;
              direccion: string;
            }[])
          : [],
        sucursal: {
          id: cuota.sucursal.id,
          nombre: cuota.sucursal.nombre,
          direccion: cuota.sucursal.direccion,
        },
        productos:
          cuota.venta?.productos.map((vp) => ({
            id: vp.id,
            ventaId: vp.ventaId,
            productoId: vp.productoId,
            cantidad: vp.cantidad,
            creadoEn: vp.creadoEn.toISOString(),
            precioVenta: vp.precioVenta,
            producto: {
              id: vp.producto.id,
              nombre: vp.producto.nombre,
              codigoProducto: vp.producto.codigoProducto,
            },
          })) || [],
        montoVenta: cuota.montoVenta,
        cuotaInicial: cuota.cuotaInicial,
        cuotasTotales: cuota.cuotasTotales,
        garantiaMeses: cuota.garantiaMeses,
        dpi: cuota.dpi,
        diasEntrePagos: cuota.diasEntrePagos,
        interes: cuota.interes,
        totalVenta: cuota.totalVenta,
        montoTotalConInteres: cuota.montoTotalConInteres,
        totalPagado: cuota.totalPagado,
      };
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error al recuperar los datos de la cuota');
    }
  }

  async deleteAll() {
    try {
      const regists = await this.prisma.ventaCuota.deleteMany({});
      return regists;
    } catch (error) {
      console.log(error);

      throw new BadRequestException('Error');
    }
  }

  async deleteAllPlantillas() {
    try {
      const regists = await this.prisma.plantillaComprobante.deleteMany({});
      return regists;
    } catch (error) {
      console.log(error);

      throw new BadRequestException('Error');
    }
  }

  async deleteOnePlaceholder(id: number) {
    try {
      const response = await this.prisma.plantillaComprobante.delete({
        where: {
          id,
        },
      });
      return response;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al eliminar registro');
    }
  }

  async updatePlantilla(
    id: number,
    createPlantillaComprobanteDto: CreatePlantillaComprobanteDto,
  ) {
    console.log('los datos son: ', createPlantillaComprobanteDto);

    try {
      const placeholderToUpdate = await this.prisma.plantillaComprobante.update(
        {
          where: {
            id,
          },
          data: {
            nombre: createPlantillaComprobanteDto.nombre,
            texto: createPlantillaComprobanteDto.texto,
          },
        },
      );

      return placeholderToUpdate;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al actualizar registro');
    }
  }

  async closeCreditRegist(id: number, closeCreditDto: CloseCreditDTO) {
    try {
      const creditToClose = await this.prisma.ventaCuota.update({
        where: {
          id,
        },
        data: {
          estado: closeCreditDto.estado,
          comentario: closeCreditDto.comentario,
        },
      });
      return creditToClose;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al actualizar y cerrar credito');
    }
  }

  async getComprobanteCuota(id: number): Promise<any> {
    try {
      const cuota = await this.prisma.cuota.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          monto: true,
          fechaPago: true,
          estado: true,
          comentario: true,
          usuario: {
            select: {
              id: true,
              nombre: true,
              rol: true,
            },
          },
          ventaCuota: {
            select: {
              cliente: {
                select: {
                  id: true,
                  nombre: true,
                  dpi: true,
                },
              },
              venta: {
                select: {
                  productos: {
                    select: {
                      producto: {
                        select: {
                          id: true,
                          nombre: true,
                          descripcion: true,
                          codigoProducto: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!cuota) {
        throw new BadRequestException('Cuota no encontrada');
      }

      // Transformar los datos para facilitar su uso en el front
      return {
        id: cuota.id,
        monto: cuota.monto,
        fechaPago: cuota.fechaPago,
        estado: cuota.estado,
        comentario: cuota.comentario,
        usuario: cuota.usuario,
        cliente: cuota.ventaCuota?.cliente,
        productos:
          cuota.ventaCuota?.venta?.productos.map((p) => ({
            id: p.producto.id,
            nombre: p.producto.nombre,
            descripcion: p.producto.descripcion,
            codigoProducto: p.producto.codigoProducto,
          })) || [],
      };
    } catch (error) {
      console.error('Error al conseguir comprobante de cuota', error);
      throw new BadRequestException('Error al conseguir comprobante');
    }
  }

  async deleteAllCreditosPrueba() {
    try {
      const registrosEliminados = await this.prisma.ventaCuota.deleteMany({});
      return registrosEliminados;
    } catch (error) {
      console.log(error);
      throw new BadRequestException('Error al eliminar');
    }
  }

  async deleteOneCreditRegist(deleteOneCreditDto: DeleteOneRegistCreditDto) {
    console.log('Entrando a la eliminación de registro de crédito');
    console.log('Datos recibidos:', deleteOneCreditDto);

    const { creditId, passwordAdmin, sucursalId, userId } = deleteOneCreditDto;
    console.log('El id de la sucursal es: ', sucursalId);

    try {
      const userAdmin = await this.prisma.usuario.findUnique({
        where: { id: userId },
        select: { rol: true, contrasena: true },
      });

      if (!userAdmin) {
        throw new NotFoundException('Usuario administrador no encontrado');
      }

      if (!['ADMIN', 'SUPER_ADMIN'].includes(userAdmin.rol)) {
        throw new UnauthorizedException('El usuario no es administrador');
      }

      const isValidPassword = await bcrypt.compare(
        passwordAdmin,
        userAdmin.contrasena,
      );
      if (!isValidPassword) {
        throw new UnauthorizedException('Contraseña incorrecta');
      }

      const sucursal = await this.prisma.sucursal.findUnique({
        where: { id: sucursalId },
      });

      if (!sucursal) {
        throw new NotFoundException('Sucursal no encontrada');
      }

      const creditToDelete = await this.prisma.ventaCuota.findUnique({
        where: { id: creditId },
        include: {
          venta: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!creditToDelete) {
        throw new NotFoundException('No se encontró el registro de crédito');
      }

      // Obtener todas las cuotas asociadas
      const cuotas = await this.prisma.cuota.findMany({
        where: { ventaCuotaId: creditId },
      });

      const total = cuotas.reduce(
        (acc, c) => acc + c.monto,
        creditToDelete.cuotaInicial,
      );
      console.log('El total de todas las cuotas es:', total);

      // Actualizar el saldo de la sucursal
      const x = await this.prisma.sucursalSaldo.findUnique({
        where: { sucursalId: sucursal.id },
      });
      console.log('El saldo actual es: ', x);

      await this.prisma.sucursalSaldo.update({
        where: { sucursalId: sucursal.id },
        data: {
          saldoAcumulado: { decrement: total },
          totalEgresos: { increment: total },
        },
      });

      const l = await this.prisma.sucursalSaldo.findUnique({
        where: { sucursalId: sucursal.id },
      });
      console.log('El saldo actual es: ', l);

      await this.prisma.cuota.deleteMany({
        where: { ventaCuotaId: creditId },
      });

      await this.prisma.ventaCuota.delete({
        where: { id: creditId },
      });

      const ventaToDelete = await this.prisma.venta.findUnique({
        where: {
          id: creditToDelete.venta.id,
        },
      });

      if (!ventaToDelete) {
        throw new NotFoundException('Venta no encontrada, error');
      }

      await this.prisma.venta.delete({
        where: {
          id: ventaToDelete.id,
        },
      });

      console.log('La venta a eliminar es: ', ventaToDelete);

      console.log('Crédito eliminado correctamente');

      // const creditosActualizados = await this.getAllCredits();

      return;
    } catch (error) {
      console.error('Error al eliminar crédito:', error);

      if (
        error instanceof NotFoundException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      throw new InternalServerErrorException('Ocurrió un error inesperado');
    }
  }

  async deleteOnePaymentCuota(deleteOnePayment: DeleteCuotaPaymentDTO) {
    // Buscar al usuario y verificar su rol y contraseña
    const userAdmin = await this.prisma.usuario.findUnique({
      where: { id: deleteOnePayment.userId },
      select: { contrasena: true, rol: true },
    });

    const validPassword = await bcrypt.compare(
      deleteOnePayment.password,
      userAdmin?.contrasena || '',
    );

    if (!['ADMIN', 'SUPER_ADMIN'].includes(userAdmin?.rol) || !validPassword) {
      throw new UnauthorizedException('No tienes permisos para esta acción.');
    }

    return await this.prisma.$transaction(async (prisma) => {
      // Buscar la cuota y su relación con el crédito y la venta
      const cuota = await prisma.cuota.findUnique({
        where: { id: deleteOnePayment.cuotaID },
        include: {
          ventaCuota: {
            include: {
              venta: true,
            },
          },
        },
      });

      if (!cuota) throw new NotFoundException('Error al encontrar la cuota.');

      const { monto, ventaCuota } = cuota;
      console.log('EL monto pagado que borraremos es: ', monto);

      const { id: ventaCuotaId, totalPagado, venta } = ventaCuota;

      if (!venta) {
        throw new NotFoundException(
          'No se encontró la venta asociada al crédito.',
        );
      }

      if (!cuota.fechaPago || cuota.monto === 0) {
        throw new BadRequestException(
          'Esta cuota ya ha sido modificada o no ha sido pagada.',
        );
      }

      // Nuevo total pagado de la ventaCuota
      const nuevoTotalPagado = totalPagado - monto;

      // Nuevo total en la venta asociada al crédito, aqui para poder reasingnar en lugar de solo quitar o restarle al monto pagado, asi verificaremos sino es negativo abajo
      const nuevoTotalVenta = venta.totalVenta - monto;

      if (nuevoTotalPagado < 0 || nuevoTotalVenta < 0) {
        throw new BadRequestException(
          'El ajuste excede el total pagado o el total de la venta.',
        );
      }

      await prisma.cuota.update({
        where: { id: cuota.id },
        data: {
          fechaPago: null,
          monto: 0,
          estado: 'PENDIENTE',
          comentario: null,
        },
      });

      // Actualizar la ventaCuota restando el monto de la cuota eliminada
      await prisma.ventaCuota.update({
        where: { id: ventaCuotaId },
        data: {
          totalPagado: nuevoTotalPagado,
        },
      });

      // Actualizar la venta asociada al crédito
      await prisma.venta.update({
        where: { id: venta.id },
        data: {
          totalVenta: nuevoTotalVenta,
        },
      });

      let x = await prisma.sucursalSaldo.findUnique({
        where: {
          sucursalId: ventaCuota.sucursalId,
        },
      });

      console.log('el monto actual de la sucursal es: ', x);

      await prisma.sucursalSaldo.updateMany({
        where: { sucursalId: ventaCuota.sucursalId },
        data: {
          saldoAcumulado: { decrement: monto }, // Restar el monto pagado
          totalIngresos: { decrement: monto },
        },
      });

      console.log(
        'El saldo de la sucursal debería ser: ',
        x.saldoAcumulado - monto,
      );

      return {
        message:
          'Pago eliminado correctamente y datos actualizados en todas las entidades.',
      };
    });
  }
}
