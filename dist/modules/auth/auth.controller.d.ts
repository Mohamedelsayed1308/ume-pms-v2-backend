import { AuthService } from './auth.service';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    login(body: {
        email: string;
        password: string;
    }): Promise<{
        access_token: string;
        user: {
            id: string;
            email: string;
            full_name: string;
            role: string;
        };
    }>;
    seed(): Promise<void>;
    createUser(body: {
        email: string;
        password: string;
        full_name: string;
        role?: string;
    }): Promise<{
        id: string;
        email: string;
        full_name: string;
        role: string;
    }>;
}
