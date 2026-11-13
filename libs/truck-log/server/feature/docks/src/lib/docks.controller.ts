import { TruckLogAdminWrites } from '@truck-log/server/auth/admin';
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CreateDockDto } from './dto/create-dock.dto';
import { SetDockActiveDto } from './dto/set-dock-active.dto';
import { DocksService } from './docks.service';

@TruckLogAdminWrites()
@Controller('docks')
export class DocksController {
  constructor(private readonly service: DocksService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: CreateDockDto) {
    return this.service.create(dto);
  }

  @Patch(':id/active')
  setActive(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetDockActiveDto,
  ) {
    return this.service.setActive(id, body.active);
  }
}
