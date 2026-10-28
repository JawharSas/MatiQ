/** Browser UI preview stub for react-native-nitro-image (avatar re-encoding). */
class PreviewImage {
  readonly width: number;
  readonly height: number;
  private readonly source: string;
  constructor(width: number, height: number, source: string) {
    this.width = width;
    this.height = height;
    this.source = source;
  }
  resizeAsync(width: number, height: number) {
    return Promise.resolve(new PreviewImage(width, height, this.source));
  }
  cropAsync(startX: number, startY: number, endX: number, endY: number) {
    return Promise.resolve(new PreviewImage(endX - startX, endY - startY, this.source));
  }
  saveToTemporaryFileAsync() {
    return Promise.resolve(this.source);
  }
  dispose() {}
}

export const Images = {
  loadFromFileAsync: (path: string) => Promise.resolve(new PreviewImage(1024, 1024, path)),
};
export type Image = PreviewImage;
