import { EstadoCuota } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CloseCreditDTO {
  @IsOptional()
  @IsNumber()
  creditID?: string;

  @IsOptional()
  @IsString()
  comentario?: string;

  @IsEnum(EstadoCuota)
  estado: EstadoCuota;
}
