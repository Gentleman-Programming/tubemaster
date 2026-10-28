import assert from "node:assert/strict";
import test from "node:test";
import { buildTranscriptIndex } from "./transcript-index";

test("builds an empty index for empty input", () => {
  assert.deepEqual(buildTranscriptIndex("video-1", []), []);
});

test("preserves chunk data and input order", () => {
  assert.deepEqual(
    buildTranscriptIndex("video-1", [
      { index: 3, text: "third" },
      { index: 1, text: "first" },
    ]),
    [
      {
        videoId: "video-1",
        chunkIndex: 3,
        text: "third",
        identity: '["transcript-chunk","video-1",3]',
        order: 0,
      },
      {
        videoId: "video-1",
        chunkIndex: 1,
        text: "first",
        identity: '["transcript-chunk","video-1",1]',
        order: 1,
      },
    ]
  );
});

test("uses a collision-resistant identity across video IDs", () => {
  const entries = buildTranscriptIndex("video:1", [{ index: 2, text: "text" }]);
  const otherEntries = buildTranscriptIndex("video", [{ index: 2, text: "text" }]);

  assert.notEqual(entries[0]?.identity, otherEntries[0]?.identity);
});

test("preserves duplicate chunk input in its original order", () => {
  const chunks = [
    { index: 0, text: "same" },
    { index: 0, text: "same" },
  ];

  assert.deepEqual(buildTranscriptIndex("video-1", chunks), [
    {
      videoId: "video-1",
      chunkIndex: 0,
      text: "same",
      identity: '["transcript-chunk","video-1",0]',
      order: 0,
    },
    {
      videoId: "video-1",
      chunkIndex: 0,
      text: "same",
      identity: '["transcript-chunk","video-1",0]',
      order: 1,
    },
  ]);
});
