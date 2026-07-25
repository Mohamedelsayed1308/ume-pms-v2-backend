import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { TasksService } from './tasks.service';

@Controller('api/tasks')
export class TasksController {
  constructor(private svc: TasksService) {}

  @Get()    findAll() { return this.svc.findAll(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post()   create(@Body() body: any) { return this.svc.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @Body() body: { body: string; author?: string }) {
    return this.svc.addComment(id, body.body, body.author || 'M.Elsayed');
  }

  @Delete('comments/:commentId')
  deleteComment(@Param('commentId') id: string) { return this.svc.deleteComment(id); }
}
