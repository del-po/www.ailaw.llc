import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { readUpload } from '../../../core/services/read-upload';
import { saveDownload } from '../../../core/services/save-download';
import { StorageFolder, StoredFile } from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

// Documents: one explorer over all of Storage (clients' folders, their
// orders, lawyers' Internal folders …), with search, upload, replace,
// rename, move, new folder and delete (to the trash folder). Files stay
// where they are: nothing is copied into a second store.
@Component({
  selector: 'app-admin-documents-page',
  imports: [DatePipe, Shape],
  templateUrl: './admin-documents-page.html',
  styleUrl: './admin-documents-page.scss',
})
export class AdminDocumentsPage {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly folder = signal<StorageFolder | null>(null);
  protected readonly results = signal<StoredFile[] | null>(null);
  protected readonly versions = signal<{ path: string; list: StoredFile[] } | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    const start = inject(ActivatedRoute).snapshot.queryParamMap.get('path') ?? 'clients';
    if (this.isBrowser) this.open(start);
  }

  protected async open(path: string): Promise<void> {
    this.error.set(null);
    this.results.set(null);
    this.versions.set(null);
    try {
      this.folder.set(await this.admin.listFiles(path));
      this.router.navigate([], { queryParams: { path: path || null }, replaceUrl: true });
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  private here(): string {
    return this.folder()?.path ?? '';
  }

  // ---------- Search ----------

  protected async search(query: string, from: string, to: string): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      this.results.set(await this.admin.searchFiles(query, { from, to }));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  // The folder a file is in
  protected parent(path: string): string {
    return path.split('/').slice(0, -1).join('/');
  }

  // ---------- Files ----------

  protected async download(path: string): Promise<void> {
    this.error.set(null);
    try {
      saveDownload(await this.admin.getFile(path));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async showVersions(file: StoredFile): Promise<void> {
    if (this.versions()?.path === file.path) {
      this.versions.set(null);
      return;
    }
    this.error.set(null);
    try {
      this.versions.set({ path: file.path, list: await this.admin.fileVersions(file.path) });
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // Runs one change, then shows the folder again
  private async run(change: () => Promise<unknown>, done: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await change();
      this.folder.set(await this.admin.listFiles(this.here()));
      this.results.set(null);
      this.notice.set(done);
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async upload(input: HTMLInputElement, replace: boolean): Promise<void> {
    const file = input.files?.[0];
    if (!file) {
      this.error.set('Choose a file first.');
      return;
    }
    const upload = await readUpload(file);
    const done = await this.run(
      () => this.admin.uploadFile(this.here(), upload, replace),
      replace ? 'Uploaded; an older file of that name is kept in Versions.' : 'Uploaded.',
    );
    if (done) input.value = '';
  }

  protected newFolder(): void {
    const name = prompt('Name of the new folder:');
    if (name?.trim()) {
      this.run(
        () => this.admin.newFolder(this.here(), name.trim()),
        `Folder "${name.trim()}" made.`,
      );
    }
  }

  protected rename(file: StoredFile): void {
    const name = prompt('New name, with its extension:', file.name);
    if (name?.trim() && name.trim() !== file.name) {
      this.run(() => this.admin.renameFile(file.path, name.trim()), 'Renamed.');
    }
  }

  protected move(file: StoredFile): void {
    const folder = prompt('Move into which folder? (its full path)', this.parent(file.path));
    if (folder?.trim() && folder.trim() !== this.parent(file.path)) {
      this.run(() => this.admin.moveFile(file.path, folder.trim()), `Moved to ${folder.trim()}.`);
    }
  }

  protected remove(file: StoredFile): void {
    if (
      confirm(`Delete "${file.name}"? It moves to the trash folder, where it can still be found.`)
    ) {
      this.run(() => this.admin.deleteFile(file.path), 'Moved to the trash.');
    }
  }

  protected size(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
}
