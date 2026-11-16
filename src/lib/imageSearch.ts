import { ShopeeProduct } from "@/types";

export interface ImageSearchOrder {
  order_sn: string;
  shop_username?: string;
  customer_name?: string;
  buyer_username?: string;
  total_amount?: number;
  order_status?: string;
  createdAt?: string;
  quantity: number;
}

export interface ImageSearchMatch {
  score: number;
  matchedImage: string;
  product: ShopeeProduct;
  orderCount: number;
  orders: ImageSearchOrder[];
}

export interface ImageSearchResult {
  matches: ImageSearchMatch[];
  threshold: number;
  indexing: { totalImages: number; pending: number };
}

const MAX_SIDE = 1024;

/** Thu nhỏ ảnh ở trình duyệt để upload nhanh và không vượt giới hạn dung lượng. */
export async function downscaleImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Không đọc được ảnh"));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Không xử lý được ảnh"))), "image/jpeg", 0.85)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Gửi ảnh lên server để tìm sản phẩm (và đơn hàng) có ảnh giống. */
export async function searchProductsByImage(file: File): Promise<ImageSearchResult> {
  const blob = await downscaleImage(file);
  const form = new FormData();
  form.append("image", blob, "search.jpg");
  const res = await fetch("/api/inventory/image-search", { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || json.error || "Tìm kiếm bằng hình ảnh thất bại");
  }
  return json.data as ImageSearchResult;
}
