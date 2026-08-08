import { SetMetadata } from '@nestjs/common';

// يحدّد الشاشة/الشاشات المطلوبة للوصول لموجّه أو تحكّم. يُقرأ بواسطة ScreenGuard.
export const REQUIRE_SCREEN = 'require_screen';
export const RequireScreen = (...hrefs: string[]) => SetMetadata(REQUIRE_SCREEN, hrefs);
