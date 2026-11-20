import React from "react";

export type LabelSizeKey = "40x30" | "50x30" | "60x40" | "75x50" | "100x50";

/** Kích thước tem (mm) và cỡ mã QR để nội dung vừa khít tem. */
export const LABEL_SIZES: Record<
  LabelSizeKey,
  { w: number; h: number; qr: number; qrVar: number; title: string }
> = {
  "40x30": { w: 40, h: 30, qr: 13, qrVar: 11, title: "40 x 30 mm (Nhỏ gọn)" },
  "50x30": { w: 50, h: 30, qr: 15, qrVar: 12, title: "50 x 30 mm (Khổ chuẩn)" },
  "60x40": { w: 60, h: 40, qr: 20, qrVar: 17, title: "60 x 40 mm (Vừa)" },
  "75x50": { w: 75, h: 50, qr: 26, qrVar: 24, title: "75 x 50 mm (Thùng carton)" },
  "100x50": { w: 100, h: 50, qr: 28, qrVar: 26, title: "100 x 50 mm (Lớn)" },
};

/** Một tem QR cần in: mỗi phân loại một mã riêng. */
export interface QrLabelSpec {
  key: string;
  code: string; // nội dung mã QR
  productName: string;
  variantName?: string;
  priceText: string;
  idText: string;
  stock: number;
}

interface QrLabelProps {
  spec: QrLabelSpec;
  size: LabelSizeKey;
  qrUrl?: string;
  showPrice: boolean;
  showBranch: boolean;
  className?: string;
}

function QrLabelBase({ spec, size, qrUrl, showPrice, showBranch, className }: QrLabelProps) {
  const dim = LABEL_SIZES[size];
  const qr = spec.variantName ? dim.qrVar : dim.qr;

  return (
    <div
      className={`bg-white text-black border border-black/30 flex flex-col justify-between items-center overflow-hidden box-border ${className || ""}`}
      style={{ width: `${dim.w}mm`, height: `${dim.h}mm`, padding: "1mm" }}
    >
      <div
        className="w-full flex items-center justify-between font-extrabold uppercase border-b border-black leading-none"
        style={{ fontSize: "5.5pt", paddingBottom: "0.3mm" }}
      >
        <span>BAO BÌ YẾN SEN</span>
        {showBranch && <span>Kho Tổng</span>}
      </div>

      <div className="w-full text-center leading-tight" style={{ fontSize: "6.5pt" }}>
        <div className="font-bold line-clamp-2">{spec.productName}</div>
        {spec.variantName && <div className="font-semibold line-clamp-1" style={{ fontSize: "5.5pt" }}>{spec.variantName}</div>}
      </div>

      <div className="flex flex-col items-center justify-center">
        {qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrUrl} alt="" style={{ width: `${qr}mm`, height: `${qr}mm` }} />
        ) : (
          <div className="bg-zinc-100 animate-pulse" style={{ width: `${qr}mm`, height: `${qr}mm` }} />
        )}
        <span className="font-mono font-bold leading-none" style={{ fontSize: "5pt", marginTop: "0.3mm" }}>
          {spec.code}
        </span>
      </div>

      <div
        className="w-full flex items-center justify-between border-t border-black leading-none"
        style={{ fontSize: "5pt", paddingTop: "0.3mm" }}
      >
        <span className="font-mono">{spec.idText}</span>
        {showPrice && <span className="font-bold">{spec.priceText}</span>}
      </div>
    </div>
  );
}

/** Dùng memo để các tem không bị vẽ lại khi các cài đặt không liên quan thay đổi. */
export const QrLabel = React.memo(QrLabelBase);
