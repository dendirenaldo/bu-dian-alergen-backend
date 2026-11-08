import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

const STABLE_CODES = ['EMAIL_TAKEN', 'INVALID_CREDENTIALS', 'ACCOUNT_DISABLED', 'TOKEN_EXPIRED'] as const;

function resolveStableCode(message: string, statusCode: number, fields: string[] = []): string | undefined {
  const msg = String(message || '');
  if (/Email already registered|Email sudah terdaftar|email.*(terdaftar|duplikat|already)/i.test(msg)) return 'EMAIL_TAKEN';
  if (fields.map((f) => String(f).toLowerCase()).includes('email') && statusCode === 409) return 'EMAIL_TAKEN';
  if (/Invalid credentials/i.test(msg)) return 'INVALID_CREDENTIALS';
  if (/Account is deactivat|Account is disabl|Akun.*(nonaktif|dinonaktifkan)/i.test(msg)) return 'ACCOUNT_DISABLED';
  if (/Token.*(kedaluwarsa|kadaluwarsa|expired)|Reset.*(kedaluwarsa|expired)|Token.*(tidak valid|invalid)|tautan.*reset/i.test(msg))
    return 'TOKEN_EXPIRED';
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const name = (exception as any)?.name as string | undefined;
    const parent = (exception as any)?.parent as any;
    if (
      name === 'SequelizeUniqueConstraintError' ||
      (Array.isArray((exception as any)?.errors) &&
        (exception as any).errors[0]?.type === 'unique violation')
    ) {
      const fields: string[] = Array.isArray((exception as any)?.errors)
        ? (exception as any).errors.map((e: any) => e?.path).filter(Boolean)
        : [];
      const message = 'Data sudah terdaftar (duplikat)';
      const code = resolveStableCode(message, 409, fields);
      return response.status(HttpStatus.CONFLICT).json({
        statusCode: 409,
        message,
        ...(code ? { code } : {}),
        errors: fields.map((f) => ({ field: f, message: `${f} sudah terdaftar` })),
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
        errors: [],
      });
    }
    if (name === 'MulterError') {
      const code = (exception as any)?.code;
      if (code === 'LIMIT_FILE_SIZE') {
        return response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
          statusCode: 413,
          message: 'Ukuran file terlalu besar (maks 5MB)',
          errors: [],
        });
      }
      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        message: `Upload gagal: ${(exception as any)?.message || code}`,
        errors: [],
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

      const extra =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? { ...(exceptionResponse as Record<string, unknown>) }
          : {};
      const retryAfter =
        typeof (extra as any).retryAfterSec === 'number' ? (extra as any).retryAfterSec : undefined;
      if (status === HttpStatus.TOO_MANY_REQUESTS && retryAfter && retryAfter > 0) {
        response.setHeader('Retry-After', String(retryAfter));
        response.setHeader('X-RateLimit-Remaining', '0');
      }
      const explicitCode =
        typeof (extra as any).code === 'string' &&
        (STABLE_CODES as readonly string[]).includes((extra as any).code)
          ? ((extra as any).code as string)
          : undefined;
      delete (extra as any).message;
      delete (extra as any).code;
      const message =
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        typeof (exceptionResponse as any).message === 'string'
          ? (exceptionResponse as any).message
          : exception.message;
      const resolvedCode = explicitCode ?? resolveStableCode(message, status);
      const errors = Array.isArray((extra as any).errors) ? (extra as any).errors : [];
      delete (extra as any).errors;
      return response.status(status).json({
        statusCode: status,
        ...extra,
        message,
        ...(resolvedCode ? { code: resolvedCode } : {}),
        errors,
      });
    }

    this.logger.error(
      `Unhandled ${request?.method} ${request?.url}: ${(exception as any)?.message || exception}`,
      (exception as any)?.stack,
    );
    const dbMessage = parent?.sqlMessage || (exception as any)?.sqlMessage;
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Terjadi kesalahan server',
      errors: [],
      ...(process.env.NODE_ENV !== 'production' && dbMessage ? { detail: dbMessage } : {}),
    });
  }
}
