import { Service, inject } from '@angular/core';
import { Upload } from '../models/admin';
import { ActionState, ChatMessage } from '../models/chat';
import {
  Assignment,
  CaseFolder,
  CaseView,
  Earnings,
  LawyerProfile,
  StaffMe,
} from '../models/lawyer';
import { AuthService } from './auth.service';
import { DOORS, DoorResult } from './doors';

// Events streamed by the case chat, one JSON object per line
export type CaseChatEvent =
  | { type: 'start'; conversationId: string; userMessage: ChatMessage }
  | { type: 'text'; text: string }
  | { type: 'done'; reply: ChatMessage }
  | { type: 'error'; error: string };

// Everything the Workspace asks of the lawyer door
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

  // ---------- One case ----------

  // Details, steps, documents and the chat thread; marks it "in progress"
  openCase(assignmentId: string): Promise<CaseView> {
    return this.call('staff:case', { assignmentId });
  }

  download(
    assignmentId: string,
    path: string,
  ): Promise<{ name: string; mimeType: string; data: string }> {
    return this.call('staff:document', { assignmentId, path });
  }

  // A working file → the lawyer's own folder (never shown to the client)
  upload(assignmentId: string, file: Upload): Promise<CaseFolder[]> {
    return this.call('staff:upload', { assignmentId, file });
  }

  // The result → the client (their Documents page and email); lead lawyer only
  deliver(assignmentId: string, file: Upload, note: string): Promise<CaseView> {
    return this.call('staff:deliver', { assignmentId, file, note });
  }

  // ---------- Profile ----------

  profile(): Promise<{ profile: LawyerProfile; earnings: Earnings }> {
    return this.call('staff:profile');
  }

  updateProfile(
    changes: Partial<Omit<LawyerProfile, 'lawyerId' | 'email' | 'status'>>,
  ): Promise<{ profile: LawyerProfile; earnings: Earnings }> {
    return this.call('staff:updateProfile', changes);
  }

  // ---------- Case chat ----------

  // Sends one question about the case; the answer arrives word by word
  async ask(
    assignmentId: string,
    text: string,
    onEvent: (event: CaseChatEvent) => void,
  ): Promise<void> {
    const res = await fetch(DOORS.lawyer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'chat:send',
        idToken: await this.auth.idToken(),
        data: { assignmentId, text },
      }),
    });
    if (!res.ok || !res.body) throw new Error('SERVER_ERROR');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as CaseChatEvent;
        if (event.type === 'done' || event.type === 'error') finished = true;
        onEvent(event);
      }
      if (done) break;
    }
    // The connection closed before the answer was complete
    if (!finished) throw new Error('SERVER_ERROR');
  }

  // ---------- Proposed actions (cards with Confirm / Cancel) ----------

  confirmAction(actionId: string): Promise<ActionState> {
    return this.call('chat:confirmAction', { actionId });
  }

  cancelAction(actionId: string): Promise<ActionState> {
    return this.call('chat:cancelAction', { actionId });
  }

  actionStatus(actionId: string): Promise<ActionState> {
    return this.call('chat:actionStatus', { actionId });
  }

  private async call<T>(action: string, data: object = {}): Promise<T> {
    const res = await fetch(DOORS.lawyer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, idToken: await this.auth.idToken(), data }),
    });
    const result = (await res.json()) as DoorResult<T>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
}
