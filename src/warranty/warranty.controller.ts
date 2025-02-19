import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
} from '@nestjs/common';
import { WarrantyService } from './warranty.service';
import { CreateWarrantyDto } from './dto/create-warranty.dto';
import { UpdateWarrantyDto } from './dto/update-warranty.dto';
import { RegistroGarantiaDto } from './dto/create-regist-warranty.dto';

@Controller('warranty')
export class WarrantyController {
  constructor(private readonly warrantyService: WarrantyService) {}
  //CREAR UN REGISTRO DE GARANTÍA
  @Post()
  create(@Body() createWarrantyDto: CreateWarrantyDto) {
    console.log('INFORMACION LLEGANDO ES: ', createWarrantyDto);

    return this.warrantyService.create(createWarrantyDto);
  }

  @Post('/create-regist-warranty')
  createRegistWarranty(@Body() createWarrantyDto: RegistroGarantiaDto) {
    return this.warrantyService.createRegistWarranty(createWarrantyDto);
  }

  @Get('/get-regists-warranties')
  findAllRegistWarranties() {
    return this.warrantyService.getAllRegistWarranty();
  }

  @Get('/get-one-regist-final-pdf/:id')
  findOneRegistPDF(@Param('id', ParseIntPipe) id: number) {
    return this.warrantyService.getOneWarrantyFinalForPdf(id);
  }

  @Get()
  findAll() {
    return this.warrantyService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.warrantyService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateWarrantyDto: UpdateWarrantyDto,
  ) {
    return this.warrantyService.update(id, updateWarrantyDto);
  }

  @Delete('/delete-all')
  removeAll() {
    return this.warrantyService.removeAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.warrantyService.remove(+id);
  }
}
