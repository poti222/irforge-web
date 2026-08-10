import { ArticleLayout } from "./ArticleLayout";

/**
 * `/learn/telegram-bot-google-sheets`.
 *
 * One module per route so each article keeps its own file and its own entry in
 * App.tsx, while the rendering lives once in ArticleLayout — nine copies of the
 * same JSX would be nine places for the heading order or the FAQ markup to
 * drift out of sync.
 */
export default function Article() {
  return <ArticleLayout slug="telegram-bot-google-sheets" />;
}
