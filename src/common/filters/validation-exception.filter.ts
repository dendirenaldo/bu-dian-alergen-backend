import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'object' && 'message' in exceptionResponse) {
        const messages = exceptionResponse['message'];
        if (Array.isArray(messages)) {
          const formattedErrors = messages.map((msg: string) => {
            const field = msg.split(' ')[0];
            return { field, message: msg };
          });
          response.status(status).json({
            statusCode: status,
            message: 'Validation failed',
            errors: formattedErrors,
          });
          return;
        }
      }
      
      response.status(status).json({
        statusCode: status,
        message: exception.message,
      });
    } else {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: 500,
        message: 'Internal server error',
      });
    }
  }
}
