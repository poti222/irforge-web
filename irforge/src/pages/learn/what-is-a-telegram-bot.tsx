import { ArticleLayout } from "./ArticleLayout";

/** `/learn/what-is-a-telegram-bot` — rendering lives once in ArticleLayout; see telegram-bot-cost.tsx. */
export default function Article() {
  return <ArticleLayout slug="what-is-a-telegram-bot" />;
}
