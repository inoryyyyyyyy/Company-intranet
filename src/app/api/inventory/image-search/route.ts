import { NextRequest } from "next/server";
import { getAuthUserFromCookies } from "@/server/utils/auth";
import { apiError, apiSuccess } from "@/server/utils/response";
import { searchByImage } from "@/server/services/image-search.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // giới hạn body của Vercel ~4.5MB

/**
 * POST /api/inventory/image-search
 * multipart/form-data: image=<file>
 * Tìm sản phẩm (và các đơn hàng chứa sản phẩm đó) có ảnh giống ảnh tải lên.
 */
export async function POST(request: NextRequest) {
  try {
    const authUser = await getAuthUserFromCookies();
    if (!authUser) {
      return apiError("Bạn cần đăng nhập để tìm kiếm bằng hình ảnh", 401);
    }

    const formData = await request.formData();
    const file = formData.get("image");
    if (!file || typeof file === "string") {
      return apiError("Vui lòng chọn một ảnh để tìm kiếm", 400);
    }
    if (!file.type.startsWith("image/")) {
      return apiError("Tệp tải lên không phải là hình ảnh", 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return apiError("Ảnh vượt quá 4MB, vui lòng chọn ảnh nhỏ hơn", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let result;
    try {
      result = await searchByImage(buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Input buffer|unsupported image|corrupt/i.test(msg)) {
        return apiError("Không đọc được ảnh, vui lòng thử ảnh JPG/PNG khác", 400);
      }
      throw err;
    }

    return apiSuccess(result, "Tìm kiếm bằng hình ảnh thành công");
  } catch (err: unknown) {
    console.error("[Image Search] Lỗi:", err);
    return apiError(err instanceof Error ? err.message : "Lỗi tìm kiếm bằng hình ảnh", 500);
  }
}
