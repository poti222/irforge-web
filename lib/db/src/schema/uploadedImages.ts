/**
 * schema/uploadedImages.ts — تصاویرِ آپلودشده‌یِ کاربر (عکسِ مدرسه، تصویرِ آیتمِ محتوا).
 * مخزنِ فایلِ خارجی (object storage) در این ریپو نیست؛ تصاویر کوچک‌اند (کلاینت تا ~۱۲۸۰px کوچک می‌کند،
 * سقفِ سخت ۲٫۵MB) پس در خودِ Postgres (bytea) نگه داشته می‌شوند. اگر روزی باکتِ Railway آمد، فقط
 * routes/uploads.ts عوض می‌شود: URLِ برگشتی (`/api/uploads/images/:id`) و ستون‌هایِ مصرف‌کننده همان می‌مانند.
 */
import { pgTable, text, integer, timestamp, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() { return "bytea"; },
});

export const uploadedImagesTable = pgTable("uploaded_images", {
  id: text("id").primaryKey(),
  uploadedByUserId: text("uploaded_by_user_id").notNull(),
  mime: text("mime").notNull(),
  byteSize: integer("byte_size").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
