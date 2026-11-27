import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { IncomeEntry, IncomeSaved, MyDeclarations } from '../models/declarations';
import { AuthService } from './auth.service';
import { DOORS, DoorResult } from './doors';

// 1% declarations for the signed-in client: their months, reporting last
// month's income, and the drafts the chat prepares
@Service()
export class DeclarationsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  mine(year?: string): Promise<MyDeclarations> {
    return this.call('declarations:my', year ? { year } : {});
  }

  // entries for a month with income, or zero: true for a month without
  report(input: { entries?: IncomeEntry[]; zero?: boolean }): Promise<IncomeSaved> {
    return this.call('declarations:report', input);
  }

  // What the chat read from the client's message, to fill the form
  draft(draftId: string): Promise<{ month: string; status: string; entries: IncomeEntry[] }> {
    return this.call('declarations:draft', { draftId });
  }

  // The client pressed Confirm on the chat's card
  confirm(draftId: string): Promise<IncomeSaved> {
    return this.call('declarations:confirm', { draftId });
  }

  private async call<T>(action: string, data: object = {}): Promise<T> {
    const body = { action, idToken: await this.auth.idToken(), data };
    return firstValueFrom(
      this.http.post<DoorResult<T>>(DOORS.client, body).pipe(
        map((result) => {
          if (!result.ok) throw new Error(result.error);
          return result.data;
        }),
      ),
    );
  }
}
