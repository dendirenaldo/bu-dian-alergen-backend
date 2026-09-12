import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(map(data => {
      if (data && typeof data === 'object' && 'data' in data) {
        // Normalisasi pagination: { data, total, page, limit, totalPages }
        // → tambah `meta` standar tanpa merusak kompatibilitas lama.
        const d = data as any;
        if (Array.isArray(d.data) && typeof d.total === 'number') {
          return {
            data: d.data,
            total: d.total,
            page: d.page,
            limit: d.limit,
            totalPages: d.totalPages,
            meta: { total: d.total, page: d.page, limit: d.limit, totalPages: d.totalPages },
          };
        }
        return data;
      }
      return { data };
    }));
  }
}
