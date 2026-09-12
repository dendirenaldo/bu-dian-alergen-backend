import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    // Sequelize ORM errors → 409/400 (bukan 500).
    const name = (exception as any)?.name as string | undefined;
    const parent = (exception as any)?.parent as any;
    if (
      name === 'SequelizeUniqueConstraintError' ||
      (Array.isArray((exception as any)?.errors) &&
        (exception as any).errors[0]?.type === 'unique violation')
    ) {
      const fields = Array.isArray((exception as any)?.errors)
        ? (exception as any).errors.map((e: any) => e?.path).filter(Boolean)
        : undefined;
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: 409,
        message: 'Data sudah terdaftar (duplikat)',
        fields,
      });
    }
    if (name === 'SequelizeValidationError') {
      const errors = Array.isArray((exception as any)?.errors)
        ? (exception as any).errors.map((e: any) => ({
            field: e?.path ?? 'unknown',
            message: e?.message ?? 'Validasi gagal',
          }))
        : [];
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        message: 'Validasi gagal',
        errors,
      });
    }
    if (name === 'SequelizeForeignKeyConstraintError') {
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        message: 'Relasi data tidak valid (foreign key)',
      });
    }
    if (name === 'MulterError') {
      const code = (exception as any)?.code;
      if (code === 'LIMIT_FILE_SIZE') {
        return response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
          statusCode: 413,
          message: 'Ukuran file terlalu besar (maks 5MB)',
        });
      }
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        message: `Upload gagal: ${(exception as any)?.message || code}`,
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null && 'message' in exceptionResponse) {
        const messages = (exceptionResponse as any)['message'];
        if (Array.isArray(messages)) {
          const formattedErrors = messages.map((msg: unknown) => {
            if (typeof msg === 'string') {
              const field = msg.split(' ')[0] || 'unknown';
              return { field, message: msg };
            }
            if (typeof msg === 'object' && msg !== null) {
              const m = msg as any;
              return {
                field: m.property ?? 'unknown',
                message: m.constraints ? Object.values(m.constraints).join(', ') : JSON.stringify(m),
              };
            }
            return { field: 'unknown', message: String(msg) };
          });
          return response.status(status).json({
            statusCode: status,
            message: status === 400 ? 'Validasi gagal' : exception.message,
            errors: formattedErrors,
          });
        }
      }

      return response.status(status).json({
        statusCode: status,
        message: exception.message,
      });
    }

    this.logger.error(
      `Unhandled ${request?.method} ${request?.url}: ${(exception as any)?.message || exception}`,
      (exception as any)?.stack,
    );
    // Jangan bocorkan detail internal + kode DB ke klien.
    const dbMessage = parent?.sqlMessage || (exception as any)?.sqlMessage;
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Terjadi kesalahan server',
      ...(process.env.NODE_ENV !== 'production' && dbMessage ? { detail: dbMessage } : {}),
    });
  }
}
