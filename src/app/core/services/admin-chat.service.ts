import { Service } from '@angular/core';
import { ChatService } from './chat.service';
import { DOORS } from './doors';

// The admin's own chat: the same conversations and streaming as the website
// chat, through the admin door (admin instructions, admin tools)
@Service()
export class AdminChatService extends ChatService {
  protected override readonly door = DOORS.admin;
}
