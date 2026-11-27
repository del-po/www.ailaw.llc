import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { Profile, ProfileUpdate } from '../models/profile';
import { DOORS, DoorResult } from './doors';

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

  // Creates or refreshes the client record after every sign-in
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

  // Step 3, after the Firebase account is gone: unlinks the client record
  finalizeDeletion(ticket: DeletionTicket): Observable<{ deleted: boolean }> {
    return this.post<{ deleted: boolean }>({ action: 'finalizeAccountDeletion', ticket });
  }

  private post<T>(body: object): Observable<T> {
    return this.http
      .post<DoorResult<T>>(DOORS.client, body)
      .pipe(
        map((result) => {
          if (!result.ok) throw new ProfileApiError(result.error);
          return result.data;
        }),
      );
  }
}
