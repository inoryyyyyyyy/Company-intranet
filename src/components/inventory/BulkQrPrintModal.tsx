"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { ShopeeProduct } from "@/types";
import { LABEL_SIZES, LabelSizeKey, QrLabel, QrLabelSpec } from "@/components/inventory/QrLabel";

interface BulkQrPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PaperKey = "A3" | "A4" | "A5" | "A6" | "Letter" | "custom" | "roll";
type Orientation = "portrait" | "landscape";
/**
 * flow : xếp liên tục, tem nối tiếp nhau lấp kín tờ
 * rows : mỗi mã bắt đầu một hàng mới (các tem cùng mã nằm cùng hàng)
 * grid : lưới cố định cột × hàng, tem căn giữa / co giãn vừa ô
 */
type Arrange = "flow" | "rows" | "grid";

const PAPERS: Record<Exclude<PaperKey, "custom" | "roll">, { w: number; h: number; title: string }> = {
  A3: { w: 297, h: 420, title: "A3 (297 × 420 mm)" },
  A4: { w: 210, h: 297, title: "A4 (210 × 297 mm)" },
  A5: { w: 148, h: 210, title: "A5 (148 × 210 mm)" },
  A6: { w: 105, h: 148, title: "A6 (105 × 148 mm)" },
  Letter: { w: 216, h: 279, title: "Letter (216 × 279 mm)" },
};

const MM_TO_PX = 3.7795;
const MAX_TOTAL_LABELS = 3000;

interface ProductEntry {
  product: ShopeeProduct;
  labels: QrLabelSpec[];
  searchText: string;
}

function formatPrice(display: string | undefined, price: number | undefined, fallback: string) {
  if (display && display !== "₫0" && display !== "₫") return display;
  if (price) return `₫${price.toLocaleString("vi-VN")}`;
  return fallback;
}

/** Mỗi phân loại một tem QR riêng; sản phẩm không có phân loại thì một tem theo SKU. */
function buildEntry(p: ShopeeProduct): ProductEntry {
  const skuCode = p.parent_sku || `SKU-${p.item_id}`;
  const productPrice = formatPrice(p.price_display, p.price_min, "--");
  const vs = p.variations || [];

  const labels: QrLabelSpec[] =
    vs.length === 0
      ? [
          {
            key: `${p.item_id}|_`,
            code: skuCode,
            productName: p.name,
            priceText: productPrice,
            idText: `ID: #${p.item_id}`,
            stock: Number(p.stock) || 0,
          },
        ]
      : vs.map((v, idx) => {
          const modelId = v.model_id || String(idx);
          return {
            key: `${p.item_id}|${modelId}`,
            code: v.sku || `${skuCode}#${modelId}`,
            productName: p.name,
            variantName: v.name || `Phân loại #${idx + 1}`,
            priceText: formatPrice(v.price_display, v.price, productPrice),
            idText: `ID: #${modelId}`,
            stock: Number(v.stock) || 0,
          };
        });

  const searchText = [p.name, skuCode, ...labels.map((l) => `${l.variantName || ""} ${l.code}`)]
    .join(" ")
    .toLowerCase();

  return { product: p, labels, searchText };
}

async function fetchAllProducts(): Promise<ShopeeProduct[]> {
  const all: ShopeeProduct[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(`/api/shopee/products?page=${page}&limit=100`);
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || json.error || "Không tải được danh sách sản phẩm");
    all.push(...(json.data.products || []));
    totalPages = json.data.pagination?.totalPages || 1;
    page++;
  } while (page <= totalPages);
  return all;
}

async function makeQrDataUrl(code: string): Promise<string> {
  const svg = await QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Ô tick hỗ trợ trạng thái "một phần". */
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className={`rounded border-zinc-300 text-amber-600 focus:ring-amber-500 cursor-pointer ${className || ""}`}
    />
  );
}

/** Thông số lưới cố định cho một trang. */
interface GridSpec {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  scale: number;
  gap: number;
  usableW: number;
  usableH: number;
}

/** Một trang theo lưới cố định: mỗi tem nằm giữa ô và co giãn vừa ô (nếu bật). */
function GridPage({
  labels,
  grid,
  size,
  qrMap,
  showPrice,
  showBranch,
  className,
}: {
  labels: QrLabelSpec[];
  grid: GridSpec;
  size: LabelSizeKey;
  qrMap: Record<string, string>;
  showPrice: boolean;
  showBranch: boolean;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        width: `${grid.usableW}mm`,
        height: `${Math.max(grid.usableH - 0.5, 1)}mm`,
        display: "grid",
        gridTemplateColumns: `repeat(${grid.cols}, ${grid.cellW}mm)`,
        gridTemplateRows: `repeat(${grid.rows}, ${grid.cellH}mm)`,
        gap: `${grid.gap}mm`,
        overflow: "hidden",
      }}
    >
      {labels.map((spec, idx) => (
        <div
          key={idx}
          style={{
            width: `${grid.cellW}mm`,
            height: `${grid.cellH}mm`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: "0 0 auto", transform: `scale(${grid.scale})`, transformOrigin: "center" }}>
            <QrLabel spec={spec} size={size} qrUrl={qrMap[spec.code]} showPrice={showPrice} showBranch={showBranch} />
          </div>
        </div>
      ))}
    </div>
  );
}

const inputCls =
  "w-full px-2 py-1.5 text-center bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl font-bold focus:ring-2 focus:ring-amber-500 focus:outline-hidden";
const selectCls =
  "w-full px-2.5 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl font-medium focus:ring-2 focus:ring-amber-500 focus:outline-hidden";
const labelCls = "block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1";

export function BulkQrPrintModal({ isOpen, onClose }: BulkQrPrintModalProps) {
  const [entries, setEntries] = useState<ProductEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  // Cài đặt in
  const [labelSize, setLabelSize] = useState<LabelSizeKey>("50x30");
  const [copies, setCopies] = useState(1);
  const [showPrice, setShowPrice] = useState(true);
  const [showBranch, setShowBranch] = useState(true);
  const [paper, setPaper] = useState<PaperKey>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [customW, setCustomW] = useState(100);
  const [customH, setCustomH] = useState(150);
  const [margin, setMargin] = useState(5);
  const [gap, setGap] = useState(2);
  const [arrange, setArrange] = useState<Arrange>("flow");
  const [centered, setCentered] = useState(true);
  const [gridCols, setGridCols] = useState(3);
  const [gridRows, setGridRows] = useState(8);
  const [fitCell, setFitCell] = useState(true);

  const [reloadKey, setReloadKey] = useState(0);

  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  };

  // Tải toàn bộ sản phẩm mỗi lần mở hộp thoại (hoặc khi bấm "Thử lại")
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchAllProducts()
      .then((products) => {
        if (cancelled) return;
        setEntries(products.map(buildEntry));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Không tải được danh sách sản phẩm");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, reloadKey]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => (q ? entries.filter((e) => e.searchText.includes(q)) : entries), [entries, q]);
  const filteredKeys = useMemo(() => filtered.flatMap((e) => e.labels.map((l) => l.key)), [filtered]);

  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selected.has(k));
  const someFilteredSelected = filteredKeys.some((k) => selected.has(k));

  const toggleAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredKeys.forEach((k) => next.delete(k));
      else filteredKeys.forEach((k) => next.add(k));
      return next;
    });
  };

  const toggleKeys = (keys: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = keys.every((k) => next.has(k));
      keys.forEach((k) => (all ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Danh sách tem đã chọn (giữ thứ tự sản phẩm)
  const selectedLabels = useMemo(
    () => entries.flatMap((e) => e.labels.filter((l) => selected.has(l.key))),
    [entries, selected]
  );
  const safeCopies = Math.max(1, Math.min(copies, 100));
  const totalLabels = selectedLabels.length * safeCopies;
  const overLimit = totalLabels > MAX_TOTAL_LABELS;

  const codesKey = useMemo(() => Array.from(new Set(selectedLabels.map((l) => l.code))).join("\n"), [selectedLabels]);

  // Tạo mã QR cho các tem đã chọn (SVG, nhanh và nét khi in)
  useEffect(() => {
    if (!isOpen || !codesKey) return;
    const missing = codesKey.split("\n").filter((c) => !qrMap[c]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const result: Record<string, string> = {};
      const CHUNK = 100;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const part = missing.slice(i, i + CHUNK);
        const urls = await Promise.all(part.map(makeQrDataUrl));
        part.forEach((c, idx) => (result[c] = urls[idx]));
        if (cancelled) return;
      }
      if (!cancelled) setQrMap((prev) => ({ ...prev, ...result }));
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, codesKey, qrMap]);

  const qrReady = selectedLabels.every((l) => !!qrMap[l.code]);

  // ---------- Bố cục trang in ----------
  const dim = LABEL_SIZES[labelSize];
  const isRoll = paper === "roll";
  const canRotate = paper !== "roll" && paper !== "custom";

  const pageMm = useMemo(() => {
    if (paper === "roll") return null;
    if (paper === "custom") return { w: Math.max(20, customW), h: Math.max(20, customH) };
    const base = PAPERS[paper];
    return orientation === "landscape" ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
  }, [paper, orientation, customW, customH]);

  const usableW = pagePxSafe(pageMm ? pageMm.w - 2 * margin : 0);
  const usableH = pagePxSafe(pageMm ? pageMm.h - 2 * margin : 0);

  // Số cột/hàng khi xếp liên tục
  const flowCols = Math.max(0, Math.floor((usableW + gap) / (dim.w + gap)));
  const flowRows = Math.max(0, Math.floor((usableH + gap) / (dim.h + gap)));

  const grid: GridSpec = useMemo(() => {
    const cols = Math.max(1, Math.min(gridCols, 30));
    const rows = Math.max(1, Math.min(gridRows, 60));
    const cellW = Math.max((usableW - gap * (cols - 1)) / cols, 1);
    const cellH = Math.max((usableH - gap * (rows - 1)) / rows, 1);
    const scale = fitCell ? Math.min(cellW / dim.w, cellH / dim.h, 4) : 1;
    return { cols, rows, cellW, cellH, scale, gap, usableW, usableH };
  }, [gridCols, gridRows, usableW, usableH, gap, fitCell, dim.w, dim.h]);

  // Thống kê số tờ cần in
  const stats = useMemo(() => {
    if (isRoll) return { perPage: 1, pages: totalLabels, rowsUsed: 0 };
    if (arrange === "grid") {
      const perPage = grid.cols * grid.rows;
      return { perPage, pages: perPage > 0 ? Math.ceil(totalLabels / perPage) : 0, rowsUsed: 0 };
    }
    if (flowCols === 0 || flowRows === 0) return { perPage: 0, pages: 0, rowsUsed: 0 };
    if (arrange === "rows") {
      // Mỗi mã bắt đầu hàng mới: số hàng = tổng ceil(số tem của mã / số cột)
      const rowsUsed = selectedLabels.length * Math.ceil(safeCopies / flowCols);
      return { perPage: flowCols * flowRows, pages: Math.ceil(rowsUsed / flowRows), rowsUsed };
    }
    const perPage = flowCols * flowRows;
    return { perPage, pages: Math.ceil(totalLabels / perPage), rowsUsed: 0 };
  }, [isRoll, arrange, grid, flowCols, flowRows, totalLabels, selectedLabels.length, safeCopies]);

  const tooBig = !isRoll && arrange !== "grid" && (flowCols === 0 || flowRows === 0);

  const printList = useMemo(
    () => selectedLabels.flatMap((l) => Array.from({ length: safeCopies }, () => l)),
    [selectedLabels, safeCopies]
  );

  const useGrid = !isRoll && arrange === "grid";
  const pageCss = isRoll ? `${dim.w}mm ${dim.h}mm` : `${pageMm?.w}mm ${pageMm?.h}mm`;
  const pageMargin = isRoll ? 0 : margin;
  const printGap = isRoll ? 0 : gap;

  // Chia thành các trang khi dùng lưới cố định
  const gridPages = useMemo(() => {
    if (!useGrid) return [] as QrLabelSpec[][];
    const per = grid.cols * grid.rows;
    const pages: QrLabelSpec[][] = [];
    for (let i = 0; i < printList.length; i += per) pages.push(printList.slice(i, i + per));
    return pages;
  }, [useGrid, grid.cols, grid.rows, printList]);

  const canPrint = totalLabels > 0 && !overLimit && qrReady && !tooBig;

  if (!isOpen) return null;

  const flowBlockWidth = flowCols > 0 ? flowCols * dim.w + (flowCols - 1) * gap : usableW;
  const labelProps = { size: labelSize, showPrice, showBranch };

  /** Các tem cho kiểu xếp liên tục / mỗi mã một hàng (có chèn ngắt hàng giữa các mã). */
  const renderFlowItems = (list: QrLabelSpec[], labelClass: string) => {
    const nodes: React.ReactNode[] = [];
    list.forEach((spec, idx) => {
      if (arrange === "rows" && idx > 0 && list[idx - 1].key !== spec.key) {
        nodes.push(<div key={`br-${idx}`} style={{ flexBasis: "100%", height: 0 }} />);
      }
      nodes.push(<QrLabel key={idx} spec={spec} qrUrl={qrMap[spec.code]} className={labelClass} {...labelProps} />);
    });
    return nodes;
  };

  const printCss = (() => {
    const base = `
      @page { size: ${pageCss}; margin: ${pageMargin}mm; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      body > *:not(#bulk-qr-print-root) { display: none !important; }
    `;
    if (isRoll) {
      return `@media print { ${base}
        #bulk-qr-print-root { display: block !important; }
        .bulk-qr-label { break-after: page; page-break-after: always; }
        .bulk-qr-label:last-child { break-after: auto; page-break-after: auto; }
      }`;
    }
    if (useGrid) {
      return `@media print { ${base}
        #bulk-qr-print-root { display: block !important; }
        .bulk-qr-page { break-after: page; page-break-after: always; }
        .bulk-qr-page:last-child { break-after: auto; page-break-after: auto; }
      }`;
    }
    return `@media print { ${base}
      #bulk-qr-print-root {
        display: flex !important;
        flex-wrap: wrap;
        align-content: flex-start;
        gap: ${printGap}mm;
        ${centered ? `width: ${flowBlockWidth}mm; margin: 0 auto;` : ""}
      }
      .bulk-qr-label { flex: 0 0 auto; break-inside: avoid; page-break-inside: avoid; }
    }`;
  })();

  const printArea = (
    <div id="bulk-qr-print-root" className="hidden">
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
      {isRoll
        ? printList.map((spec, idx) => (
            <QrLabel key={idx} spec={spec} qrUrl={qrMap[spec.code]} className="bulk-qr-label" {...labelProps} />
          ))
        : useGrid
          ? gridPages.map((labels, idx) => (
              <GridPage
                key={idx}
                labels={labels}
                grid={grid}
                qrMap={qrMap}
                className="bulk-qr-page"
                {...labelProps}
              />
            ))
          : renderFlowItems(printList, "bulk-qr-label")}
    </div>
  );

  // ---------- Xem trước tờ đầu tiên ----------
  const previewScale = pageMm ? Math.min(0.5, 300 / (pageMm.w * MM_TO_PX)) : 1;
  const previewList = printList.slice(0, isRoll ? 1 : useGrid ? grid.cols * grid.rows : Math.max(stats.perPage, 1));

  const arrangeHint: Record<Arrange, string> = {
    flow: "Tem nối tiếp nhau theo thứ tự, lấp kín tờ giấy — tiết kiệm giấy nhất.",
    rows: "Mỗi mã bắt đầu ở một hàng mới, các tem cùng mã nằm cùng hàng — dễ dán, dễ phân loại.",
    grid: "Chia tờ thành lưới cột × hàng cố định, tem căn giữa và (tùy chọn) co giãn vừa ô.",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
      <div
        className="w-full max-w-5xl bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[94vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg shrink-0">
              🖨️
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-zinc-900 dark:text-white text-base truncate">In mã QR hàng loạt</h2>
              <p className="text-[11px] text-zinc-500">
                Tick chọn mã QR của các sản phẩm / phân loại, xếp kín tờ giấy để tiết kiệm
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] text-xs">
          {/* CỘT TRÁI: chọn mã QR */}
          <div className="flex flex-col min-h-[320px] lg:min-h-0 lg:overflow-hidden border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800">
            <div className="p-3 sm:p-4 space-y-2.5 border-b border-zinc-100 dark:border-zinc-800">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Lọc theo tên, SKU, phân loại..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 font-semibold text-zinc-700 dark:text-zinc-200 cursor-pointer select-none">
                  <TriCheckbox
                    checked={allFilteredSelected}
                    indeterminate={someFilteredSelected}
                    onChange={toggleAllFiltered}
                  />
                  <span>
                    Chọn tất cả{q ? " (đang lọc)" : ""} — {filteredKeys.length} mã
                  </span>
                </label>
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 underline cursor-pointer"
                  >
                    Bỏ chọn ({selected.size})
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[46vh] lg:max-h-none">
              {loading ? (
                <div className="p-8 text-center text-zinc-500">⏳ Đang tải danh sách sản phẩm...</div>
              ) : error ? (
                <div className="p-4 m-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                  ⚠️ {error}{" "}
                  <button type="button" onClick={retry} className="underline font-semibold cursor-pointer">
                    Thử lại
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">Không có sản phẩm phù hợp</div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filtered.map((e) => {
                    const id = String(e.product.item_id);
                    const keys = e.labels.map((l) => l.key);
                    const selCount = keys.filter((k) => selected.has(k)).length;
                    const hasVariants = (e.product.variations || []).length > 0;
                    const isOpenRow = expanded.has(id) || (!!q && hasVariants && e.labels.length <= 12);
                    return (
                      <li key={id}>
                        <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                          <TriCheckbox
                            checked={selCount === keys.length}
                            indeterminate={selCount > 0}
                            onChange={() => toggleKeys(keys)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{e.product.name}</div>
                            <div className="text-[10px] text-zinc-500 font-mono truncate">
                              {e.product.parent_sku || `SKU-${e.product.item_id}`} · {e.labels.length} mã
                              {selCount > 0 ? ` · đã chọn ${selCount}` : ""}
                            </div>
                          </div>
                          {hasVariants && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(id)}
                              className="px-2 py-1 rounded-lg text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
                            >
                              {isOpenRow ? "Thu gọn ▲" : "Phân loại ▼"}
                            </button>
                          )}
                        </div>
                        {hasVariants && isOpenRow && (
                          <ul className="bg-zinc-50/70 dark:bg-zinc-800/30 pl-9 sm:pl-10 pr-3 py-1">
                            {e.labels.map((l) => (
                              <li key={l.key}>
                                <label className="flex items-center gap-2.5 py-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selected.has(l.key)}
                                    onChange={() => toggleKeys([l.key])}
                                    className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-zinc-800 dark:text-zinc-200 truncate">{l.variantName}</span>
                                    <span className="block text-[10px] text-zinc-400 font-mono truncate">{l.code}</span>
                                  </span>
                                  <span className="text-[10px] text-zinc-500 shrink-0">Tồn {l.stock}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* CỘT PHẢI: cài đặt in + xem trước */}
          <div className="lg:overflow-y-auto p-3 sm:p-4 space-y-3.5">
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800">
              <div className="col-span-2">
                <label className={labelCls}>Khổ tem</label>
                <select value={labelSize} onChange={(e) => setLabelSize(e.target.value as LabelSizeKey)} className={selectCls}>
                  {(Object.keys(LABEL_SIZES) as LabelSizeKey[]).map((k) => (
                    <option key={k} value={k}>
                      {LABEL_SIZES[k].title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Khổ giấy in</label>
                <select value={paper} onChange={(e) => setPaper(e.target.value as PaperKey)} className={selectCls}>
                  <optgroup label="Giấy rời (nhiều tem trên một tờ)">
                    {(Object.keys(PAPERS) as Array<keyof typeof PAPERS>).map((k) => (
                      <option key={k} value={k}>
                        {PAPERS[k].title}
                      </option>
                    ))}
                    <option value="custom">Tùy chỉnh kích thước giấy…</option>
                  </optgroup>
                  <optgroup label="Máy in tem">
                    <option value="roll">Giấy tem cuộn (mỗi tem một trang)</option>
                  </optgroup>
                </select>
              </div>

              {paper === "custom" && (
                <>
                  <div>
                    <label className={labelCls}>Rộng giấy (mm)</label>
                    <input type="number" min={20} max={600} value={customW} onChange={(e) => setCustomW(Number(e.target.value) || 20)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Cao giấy (mm)</label>
                    <input type="number" min={20} max={900} value={customH} onChange={(e) => setCustomH(Number(e.target.value) || 20)} className={inputCls} />
                  </div>
                </>
              )}

              {!isRoll && (
                <>
                  <div className="col-span-2">
                    <label className={labelCls}>Kiểu xếp tem lên giấy</label>
                    <select value={arrange} onChange={(e) => setArrange(e.target.value as Arrange)} className={selectCls}>
                      <option value="flow">Xếp liên tục — lấp kín tờ</option>
                      <option value="rows">Mỗi mã một hàng riêng</option>
                      <option value="grid">Lưới cố định (cột × hàng)</option>
                    </select>
                    <p className="mt-1 text-[10px] text-zinc-500">{arrangeHint[arrange]}</p>
                  </div>

                  {canRotate && (
                    <div>
                      <label className={labelCls}>Hướng giấy</label>
                      <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)} className={selectCls}>
                        <option value="portrait">Dọc</option>
                        <option value="landscape">Ngang</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={labelCls}>Số tem mỗi mã</label>
                    <input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Lề giấy (mm)</label>
                    <input type="number" min={0} max={30} value={margin} onChange={(e) => setMargin(Math.max(0, Math.min(30, Number(e.target.value) || 0)))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Khoảng cách tem (mm)</label>
                    <input type="number" min={0} max={20} value={gap} onChange={(e) => setGap(Math.max(0, Math.min(20, Number(e.target.value) || 0)))} className={inputCls} />
                  </div>

                  {arrange === "grid" && (
                    <>
                      <div>
                        <label className={labelCls}>Số cột</label>
                        <input type="number" min={1} max={30} value={gridCols} onChange={(e) => setGridCols(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Số hàng</label>
                        <input type="number" min={1} max={60} value={gridRows} onChange={(e) => setGridRows(Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))} className={inputCls} />
                      </div>
                      <div className="col-span-2 flex items-center justify-between gap-2 flex-wrap">
                        <label className="flex items-center gap-1.5 cursor-pointer text-zinc-600 dark:text-zinc-300">
                          <input type="checkbox" checked={fitCell} onChange={(e) => setFitCell(e.target.checked)} className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500" />
                          <span>Co giãn tem vừa ô</span>
                        </label>
                        <button
                          type="button"
                          disabled={flowCols === 0 || flowRows === 0}
                          onClick={() => {
                            setGridCols(Math.max(1, flowCols));
                            setGridRows(Math.max(1, flowRows));
                          }}
                          className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-zinc-200/70 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 disabled:opacity-50 cursor-pointer"
                        >
                          Tự điền theo khổ tem ({flowCols}×{flowRows})
                        </button>
                      </div>
                    </>
                  )}

                  {arrange !== "grid" && (
                    <div className="col-span-2">
                      <label className="flex items-center gap-1.5 cursor-pointer text-zinc-600 dark:text-zinc-300">
                        <input type="checkbox" checked={centered} onChange={(e) => setCentered(e.target.checked)} className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500" />
                        <span>Căn giữa khối tem trên tờ giấy</span>
                      </label>
                    </div>
                  )}
                </>
              )}

              {isRoll && (
                <div className="col-span-2">
                  <label className={labelCls}>Số tem mỗi mã</label>
                  <input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))} className={`${inputCls} w-24`} />
                </div>
              )}

              <div className="col-span-2 flex items-center gap-4 flex-wrap text-zinc-600 dark:text-zinc-300">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500" />
                  <span>Hiển thị giá bán</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showBranch} onChange={(e) => setShowBranch(e.target.checked)} className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500" />
                  <span>Hiển thị Kho Tổng</span>
                </label>
              </div>
            </div>

            {/* Thống kê bố cục */}
            <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 space-y-0.5">
              {tooBig ? (
                <div className="font-semibold text-rose-600 dark:text-rose-400">
                  ⚠️ Tem lớn hơn khổ giấy đã chọn, hãy giảm lề / đổi khổ giấy hoặc khổ tem.
                </div>
              ) : isRoll ? (
                <div>
                  Mỗi tem in trên một trang {dim.w}×{dim.h} mm (máy in tem cuộn).
                </div>
              ) : arrange === "grid" ? (
                <div>
                  Lưới <b>{grid.cols} × {grid.rows} = {stats.perPage}</b> ô / tờ, mỗi ô {grid.cellW.toFixed(1)}×{grid.cellH.toFixed(1)} mm
                  {fitCell ? ` (tem ${grid.scale >= 1 ? "phóng" : "thu"} ×${grid.scale.toFixed(2)})` : ""}.
                  {!fitCell && (grid.cellW < dim.w || grid.cellH < dim.h) ? (
                    <span className="font-semibold text-rose-600 dark:text-rose-400"> Ô nhỏ hơn tem, tem sẽ bị cắt — hãy bật co giãn.</span>
                  ) : null}
                </div>
              ) : (
                <div>
                  Mỗi tờ xếp được <b>{flowCols} × {flowRows} = {flowCols * flowRows}</b> tem.
                </div>
              )}
              <div>
                Tổng <b>{totalLabels}</b> tem
                {!isRoll && stats.perPage > 0 && totalLabels > 0 ? (
                  <>
                    {" "}
                    → <b>{stats.pages}</b> tờ {paper === "custom" ? `${pageMm?.w}×${pageMm?.h} mm` : paper}
                  </>
                ) : null}
                {selectedLabels.length > 0 ? ` (${selectedLabels.length} mã × ${safeCopies})` : ""}
              </div>
              {arrange === "rows" && !isRoll && stats.rowsUsed > 0 && (
                <div>Dùng {stats.rowsUsed} hàng tem.</div>
              )}
              {overLimit && (
                <div className="font-semibold text-rose-600 dark:text-rose-400">
                  ⚠️ Tối đa {MAX_TOTAL_LABELS} tem mỗi lần in, hãy bỏ bớt mã hoặc giảm số tem mỗi mã.
                </div>
              )}
            </div>

            {/* Xem trước */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Xem trước {isRoll ? "tem đầu tiên" : "tờ giấy đầu tiên"}
              </div>
              <div className="flex justify-center p-3 bg-zinc-100 dark:bg-zinc-950/60 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-auto max-h-[380px]">
                {previewList.length === 0 ? (
                  <div className="py-10 text-zinc-400 text-center">Chưa chọn mã QR nào để in</div>
                ) : isRoll || !pageMm ? (
                  <QrLabel spec={previewList[0]} qrUrl={qrMap[previewList[0].code]} className="shadow-md" {...labelProps} />
                ) : (
                  <div
                    className="relative shrink-0 bg-white shadow-md"
                    style={{
                      width: `${pageMm.w * MM_TO_PX * previewScale}px`,
                      height: `${pageMm.h * MM_TO_PX * previewScale}px`,
                    }}
                  >
                    <div
                      className="absolute left-0 top-0 overflow-hidden"
                      style={{
                        width: `${pageMm.w}mm`,
                        height: `${pageMm.h}mm`,
                        padding: `${margin}mm`,
                        boxSizing: "border-box",
                        transform: `scale(${previewScale})`,
                        transformOrigin: "top left",
                      }}
                    >
                      {useGrid ? (
                        <GridPage labels={previewList} grid={grid} qrMap={qrMap} {...labelProps} />
                      ) : (
                        <div
                          className="flex flex-wrap content-start"
                          style={{
                            gap: `${gap}mm`,
                            ...(centered ? { width: `${flowBlockWidth}mm`, margin: "0 auto" } : {}),
                          }}
                        >
                          {renderFlowItems(previewList, "shrink-0")}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3.5 sm:p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 gap-3">
          <div className="text-[11px] text-zinc-500 text-center sm:text-left">
            Đã chọn <strong>{selectedLabels.length}</strong> mã QR
            {selectedLabels.length > 0 && !qrReady ? " · đang tạo mã QR..." : ""}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial py-2 px-4 text-xs font-semibold rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!canPrint}
              className="flex-1 sm:flex-initial py-2 px-5 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>🖨️</span>
              <span>In {totalLabels} tem</span>
            </button>
          </div>
        </div>
      </div>

      {/* Vùng in: đặt trực tiếp trong <body> để in nhiều trang đúng */}
      {typeof document !== "undefined" && createPortal(printArea, document.body)}
    </div>
  );
}

function pagePxSafe(v: number) {
  return Math.max(v, 0);
}
