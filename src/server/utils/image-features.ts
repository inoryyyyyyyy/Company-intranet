import sharp from "sharp";

/**
 * Đặc trưng ảnh dùng cho tìm kiếm ảnh tương tự (không cần dịch vụ AI bên ngoài):
 *  - dhash : "difference hash" 64-bit mô tả cấu trúc sáng/tối (bền với đổi kích thước, nén, chỉnh sáng nhẹ)
 *  - color : lưới màu 4x4 (48 giá trị RGB) mô tả bố cục màu tổng thể
 */
export interface ImageFeatures {
  dhash: string; // 16 ký tự hex
  color: number[]; // 48 giá trị 0-255
}

export async function computeImageFeatures(input: Buffer): Promise<ImageFeatures> {
  const base = sharp(input, { failOn: "none", limitInputPixels: 80_000_000 })
    .rotate() // áp dụng EXIF orientation (ảnh chụp từ điện thoại)
    .flatten({ background: "#ffffff" }); // ảnh PNG trong suốt -> nền trắng

  const grey = await base
    .clone()
    .greyscale()
    .normalise()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();

  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += grey[y * 9 + x] > grey[y * 9 + x + 1] ? "1" : "0";
    }
  }
  let dhash = "";
  for (let i = 0; i < 64; i += 4) {
    dhash += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  const rgb = await base.clone().resize(4, 4, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return { dhash, color: Array.from(rgb) };
}

function hammingHex(a: string, b: string): number {
  let dist = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

/**
 * Độ giống nhau 0..1 (1 = giống hệt).
 */
export function similarity(a: ImageFeatures, b: ImageFeatures): number {
  const structure = 1 - hammingHex(a.dhash, b.dhash) / 64;

  let diff = 0;
  const n = Math.min(a.color.length, b.color.length);
  for (let i = 0; i < n; i++) diff += Math.abs(a.color[i] - b.color[i]);
  const color = Math.max(0, 1 - diff / n / 96);

  return 0.6 * structure + 0.4 * color;
}
