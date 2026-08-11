-- Site updates become title + an ordered sequence of blocks.
--
-- The old shape was fixed: one body string, then all images after it. The new
-- shape is an ordered array so an update can be text, image, image, text.
--
-- `body` and `site_update_images` are deliberately NOT dropped here. Keeping
-- them for one release means this migration can be rolled back by pointing the
-- code at the old columns again; dropping them in the same step would make the
-- previous release unable to start. Cleanup is a follow-up migration.

ALTER TABLE site_updates ADD COLUMN IF NOT EXISTS blocks JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: the old body becomes one text block, then each image becomes an
-- image block after it, preserving sort_order — which is exactly how the old
-- fixed layout rendered, so nothing moves on screen.
--
-- alt is required on image blocks going forward, but these rows never captured
-- one. Rather than invent a description of an image we cannot see, it is
-- seeded from the update's title, which is at least true and relevant, and is
-- better than an empty string that a screen reader announces as nothing.
-- Only rows that have not already been converted are touched, so re-running
-- this is a no-op.
UPDATE site_updates u
   SET blocks = (
     SELECT COALESCE(jsonb_agg(b ORDER BY ord), '[]'::jsonb)
       FROM (
         SELECT 0 AS ord,
                jsonb_build_object(
                  'type',    'text',
                  'id',      md5(u.id || ':body'),
                  'content', u.body
                ) AS b
          WHERE COALESCE(btrim(u.body), '') <> ''

         UNION ALL

         SELECT i.sort_order + 1 AS ord,
                jsonb_build_object(
                  'type', 'image',
                  'id',   i.id,
                  'url',  i.data_url,
                  'alt',  u.title
                ) AS b
           FROM site_update_images i
          WHERE i.update_id = u.id
       ) parts
   )
 WHERE u.blocks = '[]'::jsonb;
