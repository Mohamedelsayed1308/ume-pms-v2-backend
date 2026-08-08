import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// قائمة سماح CORS صريحة (بدل origin:true). تُضبط عبر البيئة + الإنتاج المعروف.
// FRONTEND_ORIGINS = قائمة مفصولة بفواصل (اختياري) لإضافة أصول إضافية.
function buildCorsOrigins(): (string | RegExp)[] {
  const list: (string | RegExp)[] = [
    'https://ume-pms-v2-frontend.vercel.app',                 // إنتاج الفرونت
    /^https:\/\/ume-pms-v2-frontend[a-z0-9-]*\.vercel\.app$/, // Vercel Preview لنفس المشروع فقط
    /^http:\/\/localhost:\d+$/,                                // تطوير محلي
    /^http:\/\/127\.0\.0\.1:\d+$/,
  ];
  const extra = (process.env.FRONTEND_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return [...list, ...extra];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowed = buildCorsOrigins();
  app.enableCors({
    origin: (origin, cb) => {
      // بدون Origin (طلبات غير متصفّح: curl/خادم-لخادم/same-origin) — مسموح؛ CORS يخصّ المتصفّح فقط
      if (!origin) return cb(null, true);
      const ok = allowed.some((a) => (a instanceof RegExp ? a.test(origin) : a === origin));
      return cb(null, ok); // أصل غير مسموح → بدون ترويسة ACAO (المتصفّح يمنعه)
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
  console.log(`Backend running on http://localhost:${process.env.PORT ?? 3001}`);
}
bootstrap();
