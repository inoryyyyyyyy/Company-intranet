import mongoose, { Schema } from "mongoose";
import { connectToDatabase } from "@/server/db";
import { MongoShopeeProductModel, MongoShopeeOrderModel } from "@/server/db/schema";
import { ImageFeatures, computeImageFeatures, similarity } from "@/server/utils/image-features";

// ------------------------- Lưu đặc trưng ảnh sản phẩm -------------------------
interface IProductImageFeature {
  url: string;
  dhash?: string;
  color?: number[];
  failed?: boolean;
  updatedAt: Date;
}

const ProductImageFeatureSchema = new Schema<IProductImageFeature>(
  {
    url: { type: String, required: true, unique: true, index: true },
    dhash: { type: String },
    color: { type: [Number] },
    failed: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false, collection: "product_image_features" }
);

const ProductImageFeatureModel =
  (mongoose.models.ProductImageFeature as mongoose.Model<IProductImageFeature>) ||
  mongoose.model<IProductImageFeature>("ProductImageFeature", ProductImageFeatureSchema);

// ------------------------- Cấu hình -------------------------
export const MATCH_THRESHOLD = 0.7; // dưới ngưỡng này coi như không giống
const MAX_RESULTS = 12;
const MAX_ORDERS_PER_PRODUCT = 5;
const DOWNLOAD_TIMEOUT_MS = 6000;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 8;
const RETRY_FAILED_AFTER_MS = 24 * 3600 * 1000;

async function downloadImage(url: string): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD_BYTES) throw new Error("Ảnh quá lớn");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tính đặc trưng cho các ảnh sản phẩm còn thiếu, trong giới hạn thời gian (serverless).
 * Phần chưa kịp tính sẽ được tiếp tục ở lần tìm kiếm sau.
 */
async function ensureFeatures(
  urls: string[],
  budgetMs: number
): Promise<{ features: Map<string, ImageFeatures>; pending: number }> {
  const stored = await ProductImageFeatureModel.find({ url: { $in: urls } }).lean();
  const features = new Map<string, ImageFeatures>();
  const skip = new Set<string>();
  const now = Date.now();

  for (const s of stored) {
    if (s.dhash && s.color?.length) {
      features.set(s.url, { dhash: s.dhash, color: s.color });
      skip.add(s.url);
    } else if (s.failed && now - new Date(s.updatedAt).getTime() < RETRY_FAILED_AFTER_MS) {
      skip.add(s.url);
    }
  }

  const queue = urls.filter((u) => !skip.has(u));
  const deadline = Date.now() + budgetMs;
  const ops: Parameters<typeof ProductImageFeatureModel.bulkWrite>[0] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length && Date.now() < deadline) {
      const url = queue[cursor++];
      try {
        const feat = await computeImageFeatures(await downloadImage(url));
        features.set(url, feat);
        ops.push({
          updateOne: {
            filter: { url },
            update: { $set: { ...feat, failed: false, updatedAt: new Date() } },
            upsert: true,
          },
        });
      } catch {
        ops.push({
          updateOne: {
            filter: { url },
            update: { $set: { failed: true, updatedAt: new Date() } },
            upsert: true,
          },
        });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (ops.length) await ProductImageFeatureModel.bulkWrite(ops, { ordered: false });

  return { features, pending: Math.max(0, queue.length - cursor) };
}

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
  score: number; // 0..1
  matchedImage: string;
  product: Record<string, unknown>;
  orderCount: number;
  orders: ImageSearchOrder[];
}

export interface ImageSearchResult {
  matches: ImageSearchMatch[];
  threshold: number;
  indexing: { totalImages: number; pending: number };
}

function fetchRecentOrders(names: string[]) {
  return MongoShopeeOrderModel.find({ "items.product_name": { $in: names } })
    .select("order_sn shop_username customer_name buyer_username total_amount order_status createdAt items")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
}

export async function searchByImage(queryImage: Buffer, budgetMs = 6500): Promise<ImageSearchResult> {
  await connectToDatabase();

  const queryFeat = await computeImageFeatures(queryImage);

  const products = await MongoShopeeProductModel.find({}).lean();

  const urlsByProduct = new Map<string, string[]>();
  const allUrls = new Set<string>();
  for (const p of products) {
    const urls = new Set<string>();
    if (p.image) urls.add(p.image);
    for (const v of p.variations || []) if (v.image) urls.add(v.image);
    urlsByProduct.set(String(p.item_id), [...urls]);
    urls.forEach((u) => allUrls.add(u));
  }

  const { features, pending } = await ensureFeatures([...allUrls], budgetMs);

  const scored: { product: (typeof products)[number]; score: number; image: string }[] = [];
  for (const p of products) {
    let best = 0;
    let bestImg = "";
    for (const u of urlsByProduct.get(String(p.item_id)) || []) {
      const f = features.get(u);
      if (!f) continue;
      const s = similarity(queryFeat, f);
      if (s > best) {
        best = s;
        bestImg = u;
      }
    }
    if (best >= MATCH_THRESHOLD) scored.push({ product: p, score: best, image: bestImg });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, MAX_RESULTS);

  // Đơn hàng chỉ lưu tên sản phẩm (không lưu ảnh) nên khớp đơn theo tên sản phẩm
  const names = [...new Set(top.map((t) => t.product.name).filter(Boolean))];
  let recentOrders: Awaited<ReturnType<typeof fetchRecentOrders>> = [];
  const countByName = new Map<string, number>();
  if (names.length) {
    recentOrders = await fetchRecentOrders(names);
    await Promise.all(
      names.map(async (n) => {
        countByName.set(n, await MongoShopeeOrderModel.countDocuments({ "items.product_name": n }));
      })
    );
  }

  const matches: ImageSearchMatch[] = top.map((t) => {
    const name = t.product.name;
    const orders: ImageSearchOrder[] = [];
    for (const o of recentOrders) {
      const hit = (o.items || []).filter((i) => i.product_name === name);
      if (!hit.length) continue;
      orders.push({
        order_sn: o.order_sn,
        shop_username: o.shop_username,
        customer_name: o.customer_name,
        buyer_username: o.buyer_username,
        total_amount: o.total_amount,
        order_status: o.order_status,
        createdAt: o.createdAt,
        quantity: hit.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0),
      });
      if (orders.length >= MAX_ORDERS_PER_PRODUCT) break;
    }
    const product: Record<string, unknown> = { ...t.product };
    delete product._id;
    return {
      score: Math.round(t.score * 1000) / 1000,
      matchedImage: t.image,
      product,
      orderCount: countByName.get(name) || 0,
      orders,
    };
  });

  return { matches, threshold: MATCH_THRESHOLD, indexing: { totalImages: allUrls.size, pending } };
}
