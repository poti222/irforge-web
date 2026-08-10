import { useEffect, useRef } from "react";

/**
 * QR کد، رسم‌شده به‌صورت محلی روی canvas.
 *
 * چرا نه یک سرویس تصویر QR؟ چون رشته‌ای که کد می‌کنیم یک **لینک عمیق حاوی
 * توکن یک‌بارمصرف** است. فرستادنش به یک شخص ثالث یعنی دادن توکن اتصال حساب
 * به کسی که هیچ دلیلی برای دیدنش ندارد.
 *
 * پیاده‌سازی: QR نسخه‌ی ۶ (41×41)، سطح تصحیح خطای L، حالت بایت. برای لینکی
 * به طول ~۶۰ کاراکتر کافی است و کد را کوچک و قابل اسکن نگه می‌دارد.
 */

// ─── ریاضیات میدان گالوا GF(256) برای کدهای Reed–Solomon ────────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

// ─── پارامترهای نسخه ۶-L ────────────────────────────────────────────────────
const VERSION = 6;
const SIZE = 17 + VERSION * 4; // 41
const TOTAL_CODEWORDS = 172;
const EC_CODEWORDS = 36;
const DATA_CODEWORDS = TOTAL_CODEWORDS - EC_CODEWORDS; // 136
const ALIGNMENT_CENTERS = [6, 34];

function buildMatrix(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  // 4 bit mode + 8 bit length + payload + 4 bit terminator
  if (bytes.length > DATA_CODEWORDS - 2) return null;

  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // version 1-9 byte mode → 8-bit count
  for (const b of bytes) push(b, 8);
  push(0, 4); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (data.length < DATA_CODEWORDS) data.push(PAD[padIndex++ % 2]);

  const ec = rsEncode(data, EC_CODEWORDS);
  const codewords = [...data, ...ec];

  const modules: (boolean | null)[][] = Array.from({ length: SIZE }, () =>
    new Array(SIZE).fill(null),
  );
  const reserved: boolean[][] = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));

  const setFn = (r: number, c: number, v: boolean) => {
    modules[r][c] = v;
    reserved[r][c] = true;
  };

  // finder patterns + separators
  const finder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        const inner =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setFn(rr, cc, inner);
      }
    }
  };
  finder(0, 0);
  finder(0, SIZE - 7);
  finder(SIZE - 7, 0);

  // timing patterns
  for (let i = 8; i < SIZE - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // alignment pattern
  for (const ar of ALIGNMENT_CENTERS) {
    for (const ac of ALIGNMENT_CENTERS) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === SIZE - 7) || (ar === SIZE - 7 && ac === 6)) {
        continue;
      }
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          setFn(ar + r, ac + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  // dark module + reserved format areas
  setFn(SIZE - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][SIZE - 1 - i] = true;
    reserved[SIZE - 1 - i][8] = true;
  }

  // place data, zig-zag from bottom-right, mask 0 ((r+c) % 2 === 0)
  let bitIndex = 0;
  const allBits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) allBits.push((cw >> i) & 1);

  let upward = true;
  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let i = 0; i < SIZE; i++) {
      const row = upward ? SIZE - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        const bit = bitIndex < allBits.length ? allBits[bitIndex++] : 0;
        const masked = (row + cc) % 2 === 0 ? bit ^ 1 : bit;
        modules[row][cc] = masked === 1;
      }
    }
    upward = !upward;
  }

  // format information for EC level L (01) with mask 0 → 0b111011111000100
  const FORMAT = 0b111011111000100;
  for (let i = 0; i < 15; i++) {
    const bit = ((FORMAT >> i) & 1) === 1;
    if (i < 6) modules[8][i] = bit;
    else if (i < 8) modules[8][i + 1] = bit;
    else if (i === 8) modules[7][8] = bit;
    else modules[14 - i][8] = bit;

    if (i < 8) modules[SIZE - 1 - i][8] = bit;
    else modules[8][SIZE - 15 + i] = bit;
  }
  modules[SIZE - 8][8] = true;

  return modules.map((row) => row.map((v) => v === true));
}

export function QrCanvas({ value, size = 168 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const matrix = buildMatrix(value);
    if (!matrix) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const quiet = 4;
    const modules = matrix.length + quiet * 2;
    const scale = Math.floor(size / modules) || 1;
    const px = modules * scale;
    canvas.width = px;
    canvas.height = px;

    // سفید ثابت با حاشیه‌ی آرام — QR روی پس‌زمینه‌ی تیره‌ی تم اسکن نمی‌شود.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000000";
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix.length; c++) {
        if (matrix[r][c]) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
  }, [value, size]);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className="rounded-lg border bg-white"
      role="img"
      aria-label={value}
    />
  );
}
