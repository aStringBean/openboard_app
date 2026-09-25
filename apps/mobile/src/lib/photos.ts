/**
 * Wall photos on the phone. They live in the app's document directory, one
 * folder per wall: the image picker hands back a cache path the system may
 * clear at any time, and a wall must not lose its photo.
 */
import { Directory, File, Paths } from "expo-file-system";

import type { PhotoStore } from "./sync";

function wallDir(wallId: string): Directory {
  const dir = new Directory(Paths.document, "walls", wallId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const extOf = (uri: string) => /\.(jpe?g|png|webp|heic)$/i.exec(uri)?.[1]?.toLowerCase() ?? "jpg";

/** Copies a picked photo somewhere it will stay, and returns its new URI. */
export async function keepPhoto(wallId: string, uri: string): Promise<string> {
  const to = new File(wallDir(wallId), `${Date.now()}.${extOf(uri)}`);
  await new File(uri).copy(to);
  return to.uri;
}

export const photoStore: PhotoStore = {
  read: (uri) => new File(uri).bytes(),
  async save(wallId, name, bytes) {
    const file = new File(wallDir(wallId), name);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return file.uri;
  },
};

/** Deletes a wall's photos, for a wall this phone no longer has. */
export function forgetPhotos(wallId: string): void {
  const dir = new Directory(Paths.document, "walls", wallId);
  if (dir.exists) dir.delete();
}
