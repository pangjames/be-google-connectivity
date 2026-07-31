import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  type: 'mysql',
  host: process.env.DB_HOST || '',
  port: parseInt(process.env.DB_PORT || '', 10),
  username: process.env.DB_USERNAME || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || '',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false, // Use migrations in production
}));
