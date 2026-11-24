import { OrderStatus, PaymentStatus } from './order';

// The signed-in client's documents, browsed like Drive folders, as the
// Orders API returns them

// The order behind an order folder
export interface FolderOrder {
  orderNumber: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
}

export interface DocumentFolder {
  folderId: string;
  name: string;
  updatedAt: string;
  order?: FolderOrder;
}

export interface DocumentFile {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  updatedAt: string;
}

// One step of the path; folderId '' is the client's top folder ("Documents")
export interface PathStep {
  folderId: string;
  name: string;
}

export interface FolderView {
  folderId: string;
  path: PathStep[];
  // Set when this folder is an order folder
  order: FolderOrder | null;
  folders: DocumentFolder[];
  files: DocumentFile[];
}

// One file's content, base64-encoded
export interface DocumentDownload {
  name: string;
  mimeType: string;
  data: string;
}
