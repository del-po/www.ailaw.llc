import { Service, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Profile, ProfileUpdate } from '../models/profile';

// Google Apps Script web app writing the Users sheet (Drive → Profiles)
const PROFILES_API =
  'https://script.google.com/macros/s/AKfycbx_Vvn6RD5TcfudfTzLA8AuqD3i7xo5l0VPos1nOOZ-1yl3TdQy9mqQ2qpBpXk-7cTVtQ/exec';

// Sent as plain text: Apps Script can't answer the browser's CORS pre-check,
// and plain text requests skip it
const HEADERS = new HttpHeaders({ 'Content-Type': 'text/plain;charset=utf-8' });

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface DeletionTicket {
  userId: string;
  secret: string;
  expiresAt: string;
}

// Error codes from the API, e.g. ACCOUNT_SUSPENDED, are kept as the message
export class ProfileApiError extends Error {}

@Service()
export class ProfileService {
  private readonly http = inject(HttpClient);

  // Creates or refreshes the Users row after every sign-in
  sync(
    idToken: string,
    data: { firstName?: string; lastName?: string; displayName?: string } = {},
  ): Observable<Profile> {
    return this.post<Profile>({ action: 'syncProfile', idToken, data });
  }

  get(idToken: string): Observable<Profile> {
    return this.post<Profile>({ action: 'getProfile', idToken });
  }

  update(idToken: string, data: ProfileUpdate): Observable<Profile> {
    return this.post<Profile>({ action: 'updateProfile', idToken, data });
  }

  // Step 1 of account deletion: needs a login from the last 5 minutes
  prepareDeletion(idToken: string): Observable<DeletionTicket> {
    return this.post<DeletionTicket>({ action: 'prepareAccountDeletion', idToken });
  }

  // Step 3, after the Firebase account is gone: removes the Users row
  finalizeDeletion(ticket: DeletionTicket): Observable<{ deleted: boolean }> {
    return this.post<{ deleted: boolean }>({ action: 'finalizeAccountDeletion', ticket });
  }

  private post<T>(body: object): Observable<T> {
    return this.http
      .post<ApiResult<T>>(PROFILES_API, JSON.stringify(body), { headers: HEADERS })
      .pipe(
        map((result) => {
          if (!result.ok) throw new ProfileApiError(result.error);
          return result.data;
        }),
      );
  }
}
