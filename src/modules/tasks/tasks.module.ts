import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { TaskComment } from './task-comment.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TasksAssistantController } from './tasks-assistant.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Task, TaskComment])],
  providers: [TasksService],
  controllers: [TasksController, TasksAssistantController],
})
export class TasksModule {}
