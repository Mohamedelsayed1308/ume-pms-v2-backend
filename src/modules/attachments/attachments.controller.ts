import { Controller, Post, Get, Delete, Param, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AttachmentsService } from './attachments.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private svc: AttachmentsService) {}

  @Post('invoice/:id')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  upload(@Param('id') invoiceId: string, @UploadedFile() file: Express.Multer.File) {
    console.log('Upload request:', invoiceId, file?.originalname, file?.size);
    if (!file) throw new Error('No file received');
    return this.svc.create(invoiceId, file);
  }

  @Get('invoice/:id')
  findByInvoice(@Param('id') id: string) {
    return this.svc.findByInvoice(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
