/** ارقامِ فارسی/عربی → لاتین (ورودیِ فرم‌هایِ مدرسه: ساعت، شماره‌تلفن). */
export function toLatinDigits(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
