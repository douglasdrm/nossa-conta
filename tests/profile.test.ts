import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { profileSchema, avatarLimit } from "../lib/profile";
import { prepareAvatar } from "../lib/avatar";
test("profile names validate and usernames normalize without changing unrelated fields", () => {
  assert.deepEqual(
    profileSchema.parse({
      name: " Douglas ",
      username: "DOUGLAS_123",
      email: "ignored@test.com",
    }),
    { name: "Douglas", username: "douglas_123" },
  );
  assert.equal(
    profileSchema.safeParse({ name: "Douglas", username: "" }).success,
    true,
  );
  for (const username of [
    "ab",
    "with space",
    "ação",
    "<script>",
    "a".repeat(31),
  ])
    assert.equal(
      profileSchema.safeParse({ name: "Name", username }).success,
      false,
    );
  assert.equal(
    profileSchema.safeParse({ name: " ", username: "valid" }).success,
    false,
  );
});
test("profile photo processing produces a bounded WebP and rejects invalid content", async () => {
  const original = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#286653" },
  })
    .jpeg()
    .toBuffer();
  const result = await prepareAvatar(original),
    meta = await sharp(result).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.exif, undefined);
  await assert.rejects(() => prepareAvatar(Buffer.from("not an image")));
  await assert.rejects(() => prepareAvatar(Buffer.alloc(avatarLimit + 1)));
  await assert.rejects(() =>
    prepareAvatar(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
      ),
    ),
  );
});
