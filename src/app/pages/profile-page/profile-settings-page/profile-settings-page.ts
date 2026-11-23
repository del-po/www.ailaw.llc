import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Shape } from '../../../shared/kit/shapes/shape';
import { MIN_PASSWORD } from '../../auth-page/auth-utils';

// Typed by the person to confirm deleting the account
const DELETE_WORD = 'DELETE';

// One status per form, so each shows its own message
interface FormState {
  busy: boolean;
  error: string | null;
  done: string | null;
}

const IDLE: FormState = { busy: false, error: null, done: null };

@Component({
  selector: 'app-profile-settings-page',
  imports: [Shape],
  templateUrl: './profile-settings-page.html',
  styleUrl: './profile-settings-page.scss',
})
export class ProfileSettingsPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly minPassword = MIN_PASSWORD;
  protected readonly deleteWord = DELETE_WORD;

  protected readonly details = signal<FormState>(IDLE);
  protected readonly password = signal<FormState>(IDLE);
  protected readonly removal = signal<FormState>(IDLE);
  protected readonly confirmingDelete = signal(false);

  // ---------- Details ----------

  protected saveDetails(event: Event, form: HTMLFormElement): void {
    event.preventDefault();
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).value.trim();

    this.run(this.details, 'Your details are saved.', () =>
      this.auth.updateProfile({
        firstName: value('firstName'),
        lastName: value('lastName'),
        displayName: value('displayName'),
        phone: value('phone'),
      }),
    );
  }

  // ---------- Password ----------

  protected changePassword(
    event: Event,
    current: string,
    next: string,
    repeat: string,
    form: HTMLFormElement,
  ): void {
    event.preventDefault();

    if (next !== repeat) {
      this.password.set({ ...IDLE, error: "The two new passwords don't match." });
      return;
    }

    this.run(this.password, 'Your password is changed.', async () => {
      await this.auth.changePassword(current, next);
      form.reset();
    });
  }

  // ---------- Delete account ----------

  protected deleteAccount(event: Event, form: HTMLFormElement): void {
    event.preventDefault();
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
    const confirmWord = field('confirm')?.value ?? '';
    const currentPassword = field('password')?.value;

    if (confirmWord.trim().toUpperCase() !== DELETE_WORD) {
      this.removal.set({ ...IDLE, error: `Type ${DELETE_WORD} to confirm.` });
      return;
    }

    this.run(this.removal, null, async () => {
      await this.auth.deleteAccount(currentPassword);
      await this.router.navigateByUrl('/');
    });
  }

  // ---------- Helpers ----------

  private async run(
    state: ReturnType<typeof signal<FormState>>,
    doneMessage: string | null,
    action: () => Promise<void>,
  ): Promise<void> {
    state.set({ busy: true, error: null, done: null });
    try {
      await action();
      state.set({ ...IDLE, done: doneMessage });
    } catch (error) {
      state.set({ ...IDLE, error: authErrorMessage(error) });
    }
  }
}
