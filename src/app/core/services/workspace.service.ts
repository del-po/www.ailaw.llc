import { Service, inject } from '@angular/core';
import { Assignment, StaffMe } from '../models/lawyer';
import { AuthService } from './auth.service';

// The chat function also serves the Workspace (staff: actions)
const CHAT_API = 'https://europe-west1-website-ai-law.cloudfunctions.net/chat';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

@Service()
export class WorkspaceService {
  private readonly auth = inject(AuthService);

  // The signed-in lawyer; the first visit also activates their record
  me(): Promise<StaffMe> {
    return this.call('staff:me');
  }

  // Assignments given to this lawyer, newest first
  assignments(): Promise<Assignment[]> {
    return this.call('staff:assignments');
  }

  private async call<T>(action: string, data: object = {}): Promise<T> {
    const res = await fetch(CHAT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, idToken: await this.auth.idToken(), data }),
    });
    const result = (await res.json()) as ApiResult<T>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
}
