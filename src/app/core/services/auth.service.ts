import { PLATFORM_ID, Service, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type { User } from 'firebase/auth';
import { Profile, ProfileUpdate } from '../models/profile';
import { ProfileApiError, ProfileService } from './profile.service';

type FirebaseSdk = typeof import('./firebase-sdk');

// Firebase signs people in; the Profiles API keeps their row in the Clients sheet.
// Staff (lawyers) carry { staff: true, lawyerId } on their login instead and get
// no client row: they work in the Workspace.
// Firebase runs in the browser only: on the server nobody is signed in.
@Service()
export class AuthService {
  private readonly profiles = inject(ProfileService);

  // Starts downloading straight away, in parallel with the page
  private readonly sdkPromise: Promise<FirebaseSdk> | null = isPlatformBrowser(inject(PLATFORM_ID))
    ? import('./firebase-sdk')
    : null;

  readonly user = signal<User | null>(null);
  readonly profile = signal<Profile | null>(null);

  // Set when an admin approves their lawyer application
  readonly isStaff = signal(false);
  readonly lawyerId = signal<string | null>(null);

  // False until Firebase has said whether someone is signed in
  readonly ready = signal(false);

  readonly signedIn = computed(() => !!this.user());

  // Signed up with email and password (as opposed to Google only)
  readonly hasPassword = computed(
    () => this.user()?.providerData.some((p) => p.providerId === 'password') ?? false,
  );

  // Email/password accounts must confirm their email; Google ones already have
  readonly needsVerification = computed(() => {
    const user = this.user();
    return !!user && !user.emailVerified;
  });

  private readonly readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      if (!this.sdkPromise) {
        this.ready.set(true);
        resolve();
        return;
      }

      this.sdkPromise.then(({ auth, onAuthStateChanged }) =>
        onAuthStateChanged(auth, async (user) => {
          this.user.set(user);
          if (!user) this.profile.set(null);
          // Known before the guards run, so staff land in the Workspace
          await this.loadStaff().catch(() => undefined);
          this.ready.set(true);
          resolve();
        }),
      );
    });
  }

  // For guards: wait until the signed-in state is known
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  async idToken(): Promise<string> {
    const { auth } = await this.sdk();
    if (!auth.currentUser) throw new Error('auth/no-current-user');
    return auth.currentUser.getIdToken();
  }

  // ---------- Sign in / out ----------

  async signIn(email: string, password: string): Promise<void> {
    const { auth, signInWithEmailAndPassword } = await this.sdk();
    await signInWithEmailAndPassword(auth, email, password);
    await this.loadStaff(true);
    await this.syncProfile();
  }

  async signInWithGoogle(): Promise<void> {
    const { auth, signInWithPopup, GoogleAuthProvider } = await this.sdk();
    await signInWithPopup(auth, new GoogleAuthProvider());
    await this.loadStaff(true);
    await this.syncProfile();
  }

  // Where someone goes right after signing in
  homeUrl(): string {
    return this.isStaff() ? '/workspace' : '/profile';
  }

  async register(name: string, email: string, password: string): Promise<void> {
    const { auth, createUserWithEmailAndPassword, updateProfile, sendEmailVerification } =
      await this.sdk();

    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(user, { displayName: name });
    await sendEmailVerification(user, this.linkSettings());

    const [firstName = '', ...rest] = name.split(/\s+/).filter(Boolean);
    await this.syncProfile({ displayName: name, firstName, lastName: rest.join(' ') });
  }

  async signOut(): Promise<void> {
    const { auth, signOut } = await this.sdk();
    await signOut(auth);
    this.isStaff.set(false);
    this.lawyerId.set(null);
  }

  // ---------- Email verification ----------

  async resendVerification(): Promise<void> {
    const { auth, sendEmailVerification } = await this.sdk();
    if (auth.currentUser) await sendEmailVerification(auth.currentUser, this.linkSettings());
  }

  // Opened from the link in the email
  async applyVerification(code: string): Promise<void> {
    const { auth, applyActionCode } = await this.sdk();
    await applyActionCode(auth, code);
    await this.refreshUser();
  }

  // "I've confirmed" button: asks Firebase again whether the email is confirmed
  async refreshUser(): Promise<boolean> {
    const { auth, reload } = await this.sdk();
    const user = auth.currentUser;
    if (!user) return false;

    await reload(user);
    // reload() updates the same object, so the signal is told it changed
    this.user.set(null);
    this.user.set(user);

    if (user.emailVerified) await this.syncProfile();
    return user.emailVerified;
  }

  // ---------- Password reset ----------

  async sendPasswordReset(email: string): Promise<void> {
    const { auth, sendPasswordResetEmail } = await this.sdk();
    await sendPasswordResetEmail(auth, email, this.linkSettings());
  }

  // Returns the email the reset link belongs to
  async checkResetCode(code: string): Promise<string> {
    const { auth, verifyPasswordResetCode } = await this.sdk();
    return verifyPasswordResetCode(auth, code);
  }

  async resetPassword(code: string, password: string): Promise<void> {
    const { auth, confirmPasswordReset } = await this.sdk();
    await confirmPasswordReset(auth, code, password);
  }

  // ---------- Profile ----------

  // The Users row; loaded once per visit, then kept in the profile signal
  async loadProfile(force = false): Promise<Profile> {
    const current = this.profile();
    if (current && !force) return current;

    const profile = await firstValueFrom(this.profiles.get(await this.idToken()));
    this.profile.set(profile);
    return profile;
  }

  async updateProfile(data: ProfileUpdate): Promise<void> {
    const profile = await firstValueFrom(this.profiles.update(await this.idToken(), data));
    this.profile.set(profile);
  }

  // ---------- Password + account (email accounts confirm with their password) ----------

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const { auth, updatePassword } = await this.sdk();
    await this.reauthenticate(currentPassword);
    await updatePassword(auth.currentUser!, newPassword);
  }

  // 1. fresh login  2. Profiles API issues a one-time ticket
  // 3. Firebase account deleted  4. ticket removes the Users row
  async deleteAccount(currentPassword?: string): Promise<void> {
    const { auth, deleteUser } = await this.sdk();
    await this.reauthenticate(currentPassword);

    const user = auth.currentUser!;
    const token = await user.getIdToken(true); // new token carries the fresh login time
    const ticket = await firstValueFrom(this.profiles.prepareDeletion(token));

    await deleteUser(user);

    // The Firebase account is already gone, so retry the cleanup a couple of times
    for (let attempt = 1; ; attempt++) {
      try {
        await firstValueFrom(this.profiles.finalizeDeletion(ticket));
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  // Firebase asks for a recent login before sensitive changes
  private async reauthenticate(password?: string): Promise<void> {
    const sdk = await this.sdk();
    const user = sdk.auth.currentUser;
    if (!user) throw new Error('auth/no-current-user');

    if (this.hasPassword()) {
      const credential = sdk.EmailAuthProvider.credential(user.email ?? '', password ?? '');
      await sdk.reauthenticateWithCredential(user, credential);
    } else {
      await sdk.reauthenticateWithPopup(user, new sdk.GoogleAuthProvider());
    }
  }

  // ---------- Helpers ----------

  // Staff and lawyer code from the login itself. force = fresh token, needed
  // right after signing in, when the approval may be newer than the token.
  private async loadStaff(force = false): Promise<void> {
    const { auth } = await this.sdk();
    const user = auth.currentUser;
    if (!user) {
      this.isStaff.set(false);
      this.lawyerId.set(null);
      return;
    }
    const { claims } = await user.getIdTokenResult(force);
    this.isStaff.set(claims['staff'] === true);
    this.lawyerId.set(typeof claims['lawyerId'] === 'string' ? claims['lawyerId'] : null);
  }

  // Writes the Clients row. A suspended account is signed out again; any other
  // failure doesn't block the sign-in and is retried at the next one.
  // Staff have no client row.
  private async syncProfile(data = {}): Promise<void> {
    if (this.isStaff()) return;
    try {
      const profile = await firstValueFrom(this.profiles.sync(await this.idToken(), data));
      this.profile.set(profile);
    } catch (error) {
      if (error instanceof ProfileApiError && error.message === 'ACCOUNT_SUSPENDED') {
        await this.signOut();
        throw error;
      }
      console.error('Profile sync failed', error);
    }
  }

  // Where "Continue" in Firebase's emails leads back to
  private linkSettings() {
    return { url: `${location.origin}/login` };
  }

  private sdk(): Promise<FirebaseSdk> {
    if (!this.sdkPromise) throw new Error('Firebase Authentication runs in the browser only.');
    return this.sdkPromise;
  }
}
