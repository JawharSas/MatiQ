/**
 * Browser UI preview stub for expo-file-system: files are virtual; uploads
 * succeed immediately (the fake backend never receives real bytes). Every
 * file reads as a tiny real JPEG (frames) or MP4 (recordings), so the
 * app's file checks run as they do on a phone.
 */
export const UploadType = { BINARY_CONTENT: 0, MULTIPART: 1 } as const;
export const FileMode = { ReadOnly: 'r', ReadWrite: 'rw', WriteOnly: 'w', Append: 'wa', Truncate: 'wt' } as const;
export const Paths = { cache: 'preview://cache', document: 'preview://documents' };

const decode = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
// 16x16 grey JPEG and a 1-second, 2-frame H.264 MP4 (ffmpeg test patterns).
const JPEG = decode(
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgUFBcUFxsbGxsbGyAeICEhISAgICAhISEkJCQqKiok' +
  'JCQhISQkKCgqKi4vLisrKisvLzIyMjw8OTlGRkhWVmf/xABKAAEAAAAAAAAAAAAAAAAAAAAAAQEAAAAAAAAAAAAAAAAAAAAAEAEA' +
  'AAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAEAAQAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AAA//2Q==',
);
const MP4 = decode(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMEbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAA' +
  'AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA' +
  'AlN0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA' +
  'AAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHLbWRpYQAAACBtZGhk' +
  'AAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABdm1p' +
  'bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATZzdGJsAAAAtnN0c2QA' +
  'AAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMAQPEiagEABGjOD8gAAAAQcGFzcAAAAAEA' +
  'AAABAAAAFGJ0cnQAAAAAAAATcAAAE3AAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNj' +
  'AAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAAmUAAAAJAAAAFHN0Y28AAAAAAAAAAQAAAzQAAAA9dWR0' +
  'YQAAADVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAAhpbHN0AAAACGZyZWUAAAJ2bWRhdAAAAlMG' +
  'Bf//T9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMg' +
  'LSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0w' +
  'IHJlZj0xIGRlYmxvY2s9MDowOjAgYW5hbHlzZT0wOjAgbWU9ZGlhIHN1Ym1lPTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhl' +
  'ZF9yZWY9MCBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTAgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFz' +
  'dF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9MCB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0w' +
  'IG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0w' +
  'IHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MiBzY2VuZWN1dD0wIGludHJhX3JlZnJlc2g9MCByYz1jcmYgbWJ0cmVl' +
  'PTAgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MACAAAAACmWI' +
  'hDomKAAJAuAAAAAFQZogEqU=',
);
const isVideo = (uri: string) => /\.(mp4|mov)$/i.test(uri);

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
  get size() {
    return (isVideo(this.uri) ? MP4 : JPEG).byteLength;
  }
  arrayBuffer() {
    return Promise.resolve((isVideo(this.uri) ? MP4 : JPEG).slice().buffer);
  }
  open(_mode?: string) {
    const bytes = isVideo(this.uri) ? MP4 : JPEG;
    return {
      offset: 0,
      size: bytes.byteLength,
      readBytes(length: number) {
        const chunk = bytes.slice(this.offset, this.offset + length);
        this.offset += chunk.byteLength;
        return Promise.resolve(chunk);
      },
      close() {},
    };
  }
  async upload(_url: string, options: { onProgress?: (event: { bytesSent: number; totalBytes: number }) => void } = {}) {
    for (let sent = 0; sent <= 4; sent++) {
      options.onProgress?.({ bytesSent: sent, totalBytes: 4 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return { status: 200, headers: {}, body: '' };
  }
}
