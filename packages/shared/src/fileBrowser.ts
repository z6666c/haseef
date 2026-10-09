/** تجهيز مرفق الإجازة في المتصفح: تصغير صور الجوال قبل الرفع (التقرير الطبي يُقرأ بوضوح عند 1600 بكسل)، وPDF كما هو. */
import type { LeaveAttachment } from "./api";

export const ATTACH_ACCEPT = "image/jpeg,image/png,image/heic,image/heif,application/pdf";
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_SIDE = 1600;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function prepareAttachment(file: File): Promise<LeaveAttachment> {
  const name = file.name || "تقرير";
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    if (file.size > MAX_BYTES) throw new Error("ملف PDF أكبر من 6 ميجابايت. صوّر التقرير بالجوال بدلاً منه.");
    return { file_name: name, file_base64: toBase64(await file.arrayBuffer()) };
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("تعذّرت قراءة الصورة. أرفق صورة JPG أو PNG أو ملف PDF.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر تجهيز الصورة");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
  if (!blob) throw new Error("تعذّر تجهيز الصورة");
  if (blob.size > MAX_BYTES) throw new Error("الصورة كبيرة جداً");
  return { file_name: name.replace(/\.(heic|heif|png|jpe?g)$/i, "") + ".jpg", file_base64: toBase64(await blob.arrayBuffer()) };
}

export const fmtSize = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} ك.ب` : `${(b / 1024 / 1024).toFixed(1)} م.ب`);
