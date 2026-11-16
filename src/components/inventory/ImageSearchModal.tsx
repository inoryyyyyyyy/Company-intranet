"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ShopeeProduct } from "@/types";

interface ImageSearchOrder {
  order_sn: string;
  shop_username?: string;
  customer_name?: string;
  buyer_username?: string;
  total_amount?: number;
  order_status?: string;
  createdAt?: string;
  quantity: number;
}

interface ImageSearchMatch {
  score: number;
  matchedImage: string;
  product: ShopeeProduct;
  orderCount: number;
  orders: ImageSearchOrder[];
}

interface ImageSearchResult {
  matches: ImageSearchMatch[];
  threshold: number;
  indexing: { totalImages: number; pending: number };
}

interface ImageSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (product: ShopeeProduct) => void;
}

const MAX_SIDE = 1024;

/** Thu nhỏ ảnh ở trình duyệt để upload nhanh và không vượt giới hạn dung lượng. */
async function downscaleImage(file: File): Promise<Blob> {
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

function scoreLabel(score: number) {
  if (score >= 0.9) return { text: "Trùng khớp", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" };
  if (score >= 0.78) return { text: "Rất giống", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" };
  return { text: "Gần giống", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" };
}

function formatDate(iso?: string) {
  if (!iso) return "--";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "--" : d.toLocaleDateString("vi-VN");
}

export function ImageSearchModal({ isOpen, onClose, onSelectProduct }: ImageSearchModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageSearchResult | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const pickFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Vui lòng chọn tệp hình ảnh (JPG, PNG, WEBP...)");
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  // Dán ảnh từ clipboard (Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
      if (item) pickFile(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [isOpen, pickFile]);

  const handleSearch = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await downscaleImage(file);
      const form = new FormData();
      form.append("image", blob, "search.jpg");
      const res = await fetch("/api/inventory/image-search", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || "Tìm kiếm bằng hình ảnh thất bại");
      }
      setResult(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Tìm kiếm bằng hình ảnh thất bại");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center text-lg">
              🖼️
            </div>
            <div>
              <h2 className="font-bold text-zinc-900 dark:text-white text-base">Tìm kiếm bằng hình ảnh</h2>
              <p className="text-[11px] text-zinc-500">Tải ảnh lên để tìm sản phẩm và đơn hàng có ảnh trùng khớp</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-lg text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Upload area */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
            className={`rounded-2xl border-2 border-dashed p-4 cursor-pointer transition flex items-center gap-4 ${
              dragging
                ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            }`}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Ảnh tìm kiếm" className="w-24 h-24 rounded-xl object-cover border border-zinc-200 dark:border-zinc-700" />
            ) : (
              <div className="w-24 h-24 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-3xl text-zinc-400">
                📷
              </div>
            )}
            <div className="text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
              <div className="font-semibold text-sm text-zinc-900 dark:text-white">
                {file ? file.name : "Chọn ảnh từ máy, kéo thả hoặc dán (Ctrl+V)"}
              </div>
              <div>Hỗ trợ JPG, PNG, WEBP. Ảnh rõ sản phẩm, ít nền thừa sẽ cho kết quả tốt hơn.</div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSearch}
              disabled={!file || loading}
              className="py-2 px-4 text-xs font-semibold rounded-xl bg-violet-600 hover:bg-violet-700 text-white transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <span className={loading ? "animate-spin" : ""}>{loading ? "⏳" : "🔍"}</span>
              <span>{loading ? "Đang tìm kiếm..." : "Tìm kiếm"}</span>
            </button>
            {file && !loading && (
              <button
                type="button"
                onClick={reset}
                className="py-2 px-3 text-xs font-semibold rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Xóa ảnh
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
              ⚠️ {error}
            </div>
          )}

          {/* Chỉ mục ảnh chưa xong */}
          {result && result.indexing.pending > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-3">
              <span>
                Hệ thống đang lập chỉ mục ảnh sản phẩm lần đầu, còn {result.indexing.pending}/{result.indexing.totalImages} ảnh
                chưa được đối chiếu. Bấm tìm kiếm lại để kết quả đầy đủ hơn.
              </span>
              <button
                type="button"
                onClick={handleSearch}
                disabled={loading}
                className="shrink-0 underline font-semibold cursor-pointer"
              >
                Tìm lại
              </button>
            </div>
          )}

          {/* Kết quả */}
          {result && result.matches.length === 0 && (
            <div className="p-8 text-center text-zinc-500 space-y-2">
              <div className="text-3xl">🔎</div>
              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Không tìm thấy sản phẩm nào có ảnh trùng khớp</div>
              <div className="text-xs">Thử ảnh khác rõ hơn hoặc chụp sát sản phẩm.</div>
            </div>
          )}

          {result && result.matches.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs text-zinc-500">
                Tìm thấy <b className="text-zinc-900 dark:text-white">{result.matches.length}</b> sản phẩm có ảnh giống
              </div>
              {result.matches.map((m) => {
                const label = scoreLabel(m.score);
                const sku = m.product.parent_sku || `SKU-${m.product.item_id}`;
                return (
                  <div
                    key={m.product.item_id}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectProduct(m.product);
                        handleClose();
                      }}
                      className="w-full text-left p-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition cursor-pointer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.matchedImage}
                        alt=""
                        className="w-16 h-16 rounded-xl object-cover border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-zinc-900 dark:text-white line-clamp-2">{m.product.name}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-zinc-500">
                          <span className="font-mono">{sku}</span>
                          <span>Tồn: {Number(m.product.stock) || 0}</span>
                          <span>{m.orderCount} đơn hàng</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-sm text-zinc-900 dark:text-white">{Math.round(m.score * 100)}%</div>
                        <span className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${label.cls}`}>
                          {label.text}
                        </span>
                      </div>
                    </button>

                    {m.orders.length > 0 && (
                      <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30 px-3 py-2 space-y-1">
                        <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Đơn hàng gần đây chứa sản phẩm này
                          {m.orderCount > m.orders.length ? ` (${m.orders.length}/${m.orderCount})` : ""}
                        </div>
                        {m.orders.map((o) => (
                          <div key={o.order_sn} className="flex items-center justify-between gap-2 text-[11px]">
                            <div className="min-w-0 truncate">
                              <span className="font-mono font-semibold text-zinc-900 dark:text-white">#{o.order_sn}</span>
                              <span className="text-zinc-500"> · {o.customer_name || o.buyer_username || "Khách"}</span>
                              <span className="text-zinc-400"> · SL {o.quantity}</span>
                            </div>
                            <div className="shrink-0 text-zinc-500">
                              {o.order_status ? `${o.order_status} · ` : ""}
                              {formatDate(o.createdAt)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
