declare module "pngjs" {
  export const PNG: { sync: { read(buf: Buffer): { width: number; height: number; data: Buffer } } };
}
