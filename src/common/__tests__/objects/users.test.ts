import { INestApplication } from '@nestjs/common';
import { AuthService } from '../../../modules/auth/auth.service';
import { setupApp } from '../helpers/setup-app';
import { adminUser } from './users';

let app: INestApplication;
let authService: AuthService;

beforeAll(async () => {
    app = await setupApp();
    authService = app.get(AuthService);
});

afterAll(async () => {
    await app.close();
});

describe('validate user', () => {
    it('returns true if admin is valid', async () => {
        const userWithRoles = await authService.validateUser({
            email: adminUser.email,
            password: adminUser.password,
        });

        expect(userWithRoles).toBeDefined();
        expect(userWithRoles?.id).toBeDefined();
    });
});
