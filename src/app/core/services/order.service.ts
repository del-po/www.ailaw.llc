import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { Order, OrderPlaced, OrderRequest, OrderStatus, PaymentStatus } from '../models/order';
import { DocumentDownload, FolderView } from '../models/document';
import { AuthService } from './auth.service';
import { DOORS, DoorResult } from './doors';

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

  // A folder inside the signed-in client's documents ('' = their top folder)
  folder(folderId = ''): Promise<FolderView> {
    return this.call('getFolder', { folderId });
  }

  // One file from those folders; the backend checks it belongs to this client
  document(fileId: string): Promise<DocumentDownload> {
    return this.call('getDocument', { fileId });
  }

  // ---------- Admin ----------

  adminList(): Promise<Order[]> {
    return this.call('adminListOrders', {}, DOORS.admin);
  }

  adminGet(orderId: string): Promise<Order> {
    return this.call('adminGetOrder', { orderId }, DOORS.admin);
  }

  adminUpdate(
    orderId: string,
    changes: { orderStatus?: OrderStatus; paymentStatus?: PaymentStatus },
  ): Promise<Order> {
    return this.call('adminUpdateOrder', { orderId, ...changes }, DOORS.admin);
  }

  // ---------- Helpers ----------

  private async call<T>(action: string, data: object = {}, door: string = DOORS.client): Promise<T> {
    const body = { action, idToken: await this.auth.idToken(), data };
    return firstValueFrom(
      this.http.post<DoorResult<T>>(door, body).pipe(
        map((result) => {
          if (!result.ok) throw new Error(result.error);
          return result.data;
        }),
      ),
    );
  }
}
