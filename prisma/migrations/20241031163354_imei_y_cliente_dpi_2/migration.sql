/*
  Warnings:

  - A unique constraint covering the columns `[dpi,id]` on the table `Cliente` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Cliente_dpi_key";

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_dpi_id_key" ON "Cliente"("dpi", "id");
