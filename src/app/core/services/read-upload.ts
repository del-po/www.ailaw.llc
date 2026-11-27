import { Upload } from '../models/admin';

// A chosen file → { name, type, data (base64) }, ready to send to a door
export function readUpload(file: File): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type,
        data: String(reader.result).split(',')[1] ?? '',
      });
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}
