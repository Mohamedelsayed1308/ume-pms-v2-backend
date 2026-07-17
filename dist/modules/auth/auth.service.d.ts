import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User } from './user.entity';
export declare class AuthService {
    private userRepo;
    private jwt;
    constructor(userRepo: Repository<User>, jwt: JwtService);
    login(email: string, password: string): Promise<{
        access_token: string;
        user: {
            id: string;
            email: string;
            full_name: string;
            role: string;
        };
    }>;
    createUser(data: {
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
    seedAdmin(): Promise<void>;
}
