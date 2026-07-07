import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const validToken = this.configService.get<string>('ADMIN_API_TOKEN', 'default-secret-token');

    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== validToken) {
      throw new UnauthorizedException('Access Denied: Invalid or missing token');
    }
    return true;
  }
}