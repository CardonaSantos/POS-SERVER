import { PrismaClient, TipoSucursal } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const sucursal = await prisma.sucursal.create({
    data: {
      nombre: 'Sucursal Central',
      direccion: 'Av. Principal #123, Ciudad',
      telefono: '1234-5678',
      pbx: '5678-1234',
      tipoSucursal: TipoSucursal.TIENDA, // Cambia 'TuTipoAqui' por el valor correcto según tu enum
      estadoOperacion: true,
      // Puedes agregar relaciones si quieres, por ejemplo usuarios o productos
    },
  });

  console.log('Sucursal creada:', sucursal);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
