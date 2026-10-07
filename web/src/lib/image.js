/** Centre-crops any browser-decodable image to a size×size WebP (PNG if the browser can't encode WebP). */
export async function squareAvatar(file, size = 256) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("unreadable"); }
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.85));
  if (!blob) throw new Error("unreadable");
  return blob;
}
