import { Controller, Post, Get, Delete, Param, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AttachmentsService } from './attachments.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private svc: AttachmentsService) {}

  @Post('invoice/:id')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + extname(file.originalname));
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }))
  upload(@Param('id') invoiceId: string, @UploadedFile() file: Express.Multer.File) {
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
