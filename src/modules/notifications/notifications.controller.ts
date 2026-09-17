import { Controller, Get, Put, Param, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

/**
 * إشعارات المستخدم المحفوظة.
 *
 * كلّ مسارٍ هنا مقصورٌ على صاحب الإشعار: المعرّف يأتي من الرمز لا من الطلب،
 * فلا يقرأ أحدٌ إشعارات غيره ولا يُعلّمها مقروءة.
 */
@Controller('api/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Get()
  list(@Request() req: any) {
    return this.svc.listFor(req.user.id);
  }

  @Put('read-all')
  readAll(@Request() req: any) {
    return this.svc.markAllRead(req.user.id);
  }

  @Put(':id/read')
  read(@Request() req: any, @Param('id') id: string) {
    return this.svc.markRead(req.user.id, id);
  }
}
