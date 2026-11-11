import { coverCrop, MAX_AVATAR_BYTES } from "@shared/accounts";

const SIZE = 128;

/**
 * Turns a picture the user chose into a small square JPEG `data:` URL: cropped to the center and
 * scaled to 128 px, which stays sharp at the sizes avatars are shown and keeps the accounts file
 * small. Throws a readable error for files that are not images.
 */
export async function fileToAvatar(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file is not a picture MiniMail can read. Try a PNG, JPEG or WebP image.");
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the picture.");
    // JPEG has no transparency: a light background keeps transparent pictures readable.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, SIZE, SIZE);
    const crop = coverCrop(bitmap.width, bitmap.height);
    context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, SIZE, SIZE);

    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (((url.length - url.indexOf(",") - 1) * 3) / 4 <= MAX_AVATAR_BYTES) return url;
    }
    throw new Error("That picture is too detailed to shrink enough. Try a simpler one.");
  } finally {
    bitmap.close();
  }
}
