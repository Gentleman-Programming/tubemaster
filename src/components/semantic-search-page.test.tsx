import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SemanticSearchPage } from "./semantic-search-page";

test("semantic search page exposes separate index and search actions", () => {
  const markup = renderToStaticMarkup(<SemanticSearchPage />);
  assert.match(markup, />Semantic search</);
  assert.match(markup, /Index a video/);
  assert.match(markup, /Search indexed transcripts/);
  assert.match(markup, /semantic-video/);
  assert.match(markup, /semantic-query/);
  assert.match(markup, /Index video/);
  assert.match(markup, /Search transcripts/);
});
