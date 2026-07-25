import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './task.entity';
import { TaskComment } from './task-comment.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private repo: Repository<Task>,
    @InjectRepository(TaskComment) private commentRepo: Repository<TaskComment>,
  ) {}

  findAll() {
    return this.repo.find({ relations: ['comments'], order: { created_at: 'DESC' } });
  }

  findOne(id: string) {
    return this.repo.findOne({ where: { id }, relations: ['comments'] });
  }

  create(data: any) {
    const task = this.repo.create(data);
    return this.repo.save(task);
  }

  async update(id: string, data: any) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.repo.delete(id);
    return { deleted: true };
  }

  async addComment(taskId: string, body: string, author: string) {
    const task = await this.repo.findOne({ where: { id: taskId } });
    if (!task) throw new Error('Task not found');
    const comment = this.commentRepo.create({ task, body, author });
    return this.commentRepo.save(comment);
  }

  async deleteComment(commentId: string) {
    await this.commentRepo.delete(commentId);
    return { deleted: true };
  }
}
