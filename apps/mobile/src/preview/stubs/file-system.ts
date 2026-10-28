/**
 * Browser UI preview stub for expo-file-system: files are virtual; uploads
 * succeed immediately (the fake backend never receives real bytes).
 */
export const UploadType = { BINARY_CONTENT: 0, MULTIPART: 1 } as const;
export const Paths = { cache: 'preview://cache', document: 'preview://documents' };

const written = new Map<string, string>();

export class File {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  }
  get exists() {
    return true;
  }
  delete() {
    written.delete(this.uri);
  }
  write(content: string) {
    written.set(this.uri, content);
  }
  arrayBuffer() {
    // A tiny JPEG header so size/type checks behave.
    return Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).buffer);
  }
  async upload(_url: string, options: { onProgress?: (event: { bytesSent: number; totalBytes: number }) => void } = {}) {
    for (let sent = 0; sent <= 4; sent++) {
      options.onProgress?.({ bytesSent: sent, totalBytes: 4 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return { status: 200, headers: {}, body: '' };
  }
}
