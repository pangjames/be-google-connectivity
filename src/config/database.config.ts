import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  type: 'mysql',
  // host: process.env.DB_HOST || '',
  // port: parseInt(process.env.DB_PORT || '', 10),
  // username: process.env.DB_USERNAME || '',
  // password: process.env.DB_PASSWORD || '',
  // database: process.env.DB_DATABASE || '',
  replication: {
    master: {
      host: process.env.DB_WRITER_HOST || process.env.DB_CORE_HOST || '',
      port: parseInt(process.env.DB_WRITER_PORT || process.env.DB_CORE_PORT || '3306', 10),
      username: process.env.DB_WRITER_USERNAME || process.env.DB_CORE_USERNAME || '',
      password: process.env.DB_WRITER_PASSWORD || process.env.DB_CORE_PASSWORD || '',
      database: process.env.DB_WRITER_DATABASE || process.env.DB_CORE_DATABASE || '',
    },
    slaves: [
      {
        host: process.env.DB_READER_HOST || process.env.DB_CORE_HOST || '',
        port: parseInt(process.env.DB_READER_PORT || process.env.DB_CORE_PORT || '3306', 10),
        username: process.env.DB_READER_USERNAME || process.env.DB_CORE_USERNAME || '',
        password: process.env.DB_READER_PASSWORD || process.env.DB_CORE_PASSWORD || '',
        database: process.env.DB_READER_DATABASE || process.env.DB_CORE_DATABASE || '',
      },
    ],
  },
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: false, // Use migrations in production
}));
