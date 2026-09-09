/**
 * types.ts — IRFORGE_POSTBOX_PROMPT Part B shared types.
 * Mirrors api-server/src/lib/postboxStore.ts's own interfaces field-for-field
 * (which themselves mirror plugins/autoposter/domain.py, irforge-app).
 */

export const POSTBOX_TRANSLATION_STATUSES = ["draft", "ready"] as const;
export const POSTBOX_BUTTON_STYLES = ["default", "primary", "success", "danger"] as const;
export const POSTBOX_BUTTON_KINDS = ["url", "panel", "miniapp", "translation"] as const;
export const POSTBOX_TARGET_STATUSES = ["queued", "sending", "sent", "failed"] as const;

export interface PostboxMessage {
  id: string;
  title: string;
  source_type: "composed" | "forwarded";
  src_chat_id: string;
  src_message_id: string;
  body_html: string;
  preview_text: string;
  preview_media: string;
  media_group_id: string;
  is_album: boolean;
  buttons_dirty: boolean;
  created_at: string;
  updated_at?: string;
}

export interface PostboxTranslation {
  id: string;
  message_id: string;
  lang_code: string;
  lang_label: string;
  body_html: string;
  status: (typeof POSTBOX_TRANSLATION_STATUSES)[number];
  created_at: string;
  updated_at?: string;
}

export interface PostboxButton {
  id: string;
  message_id: string;
  row: number;
  col: number;
  label: string;
  style: (typeof POSTBOX_BUTTON_STYLES)[number];
  kind: (typeof POSTBOX_BUTTON_KINDS)[number];
  target: string;
  created_at: string;
  updated_at?: string;
}

export interface PostboxTarget {
  id: string;
  message_id: string;
  channel_id: string;
  channel_title: string;
  status: (typeof POSTBOX_TARGET_STATUSES)[number];
  sent_message_id: string;
  button_message_id: string;
  error: string;
  queued_at: string;
  sent_at: string;
  slow_mode: boolean;
  created_at: string;
  updated_at?: string;
}

export interface PostboxMessageDetail {
  message: PostboxMessage;
  translations: PostboxTranslation[];
  buttons: PostboxButton[];
  targets: PostboxTarget[];
}

export interface PostboxChannel {
  channel_id: string;
  channel_title: string;
}

export interface PostboxPublishResult {
  targets: PostboxTarget[];
  eta_minutes: number;
}
