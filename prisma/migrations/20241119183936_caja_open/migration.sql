-- AlterTable
ALTER TABLE "RegistroCaja" ALTER COLUMN "sucursalId" DROP NOT NULL,
ALTER COLUMN "saldoInicial" DROP NOT NULL,
ALTER COLUMN "saldoFinal" DROP NOT NULL,
ALTER COLUMN "fechaInicio" DROP NOT NULL,
ALTER COLUMN "estado" DROP NOT NULL;