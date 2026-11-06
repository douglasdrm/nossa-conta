import sharp from "sharp";
import { avatarLimit } from "./profile";
export async function prepareAvatar(bytes: Buffer) {
  if (!bytes.length || bytes.length > avatarLimit)
    throw new Error("invalid_image");
  const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "error" });
  const info = await image.metadata();
  if (
    !["jpeg", "png", "webp"].includes(info.format || "") ||
    (info.pages || 1) > 1
  )
    throw new Error("invalid_image");
  return image
    .rotate()
    .resize(512, 512, { fit: "cover" })
    .webp({ quality: 85 })
    .toBuffer();
}
