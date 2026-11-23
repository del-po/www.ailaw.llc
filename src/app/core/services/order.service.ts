import { Service, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { Order, OrderPlaced, OrderRequest, OrderStatus, PaymentStatus } from '../models/order';
import { AuthService } from './auth.service';

// Google Apps Script web app writing the Orders spreadsheet (Drive → Orders)
const ORDERS_API =
  'https://script.google.com/macros/s/AKfycbykRh1tVoibXj9UDwtX2DOZBrp0EOo6-kuS7Xit_mFNmBzLMZznbX2CU64KGQOWRvt-/exec';

// Plain text skips the browser's CORS pre-check, which Apps Script can't answer
const HEADERS = new HttpHeaders({ 'Content-Type': 'text/plain;charset=utf-8' });

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

@Service()
export class OrderService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  // ---------- Client ----------

  place(order: OrderRequest): Promise<OrderPlaced> {
    return this.call('placeOrder', order);
  }

  // The signed-in client's orders, newest first (without their lines)
  list(): Promise<Order[]> {
    return this.call('getOrders');
  }

  get(orderId: string): Promise<Order> {
    return this.call('getOrder', { orderId });
  }

  // ---------- Admin ----------

  adminList(): Promise<Order[]> {
    return this.call('adminListOrders');
  }

  adminGet(orderId: string): Promise<Order> {
    return this.call('adminGetOrder', { orderId });
  }

  adminUpdate(
    orderId: string,
    changes: { orderStatus?: OrderStatus; paymentStatus?: PaymentStatus },
  ): Promise<Order> {
    return this.call('adminUpdateOrder', { orderId, ...changes });
  }

  // ---------- Helpers ----------

  private async call<T>(action: string, data: object = {}): Promise<T> {
    const body = { action, idToken: await this.auth.idToken(), data };
    return firstValueFrom(
      this.http.post<ApiResult<T>>(ORDERS_API, JSON.stringify(body), { headers: HEADERS }).pipe(
        map((result) => {
          if (!result.ok) throw new Error(result.error);
          return result.data;
        }),
      ),
    );
  }
}
