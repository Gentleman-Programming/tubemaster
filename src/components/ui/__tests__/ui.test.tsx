import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FieldError,
  FieldHint,
  Input,
  Label,
  SectionHeader,
  Select,
  Textarea,
} from "..";

function classOf(markup: string): string {
  return /class="([^"]*)"/.exec(markup)?.[1] ?? "";
}

test("Button renders a button with children, native attributes and className", () => {
  const markup = renderToStaticMarkup(
    <Button type="submit" disabled aria-label="Save rule" className="w-full">
      Save
    </Button>,
  );
  assert.match(markup, /^<button /);
  assert.match(markup, />Save<\/button>$/);
  assert.match(markup, /type="submit"/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-label="Save rule"/);
  assert.ok(classOf(markup).split(" ").includes("w-full"));
});

test("Button defaults to type button and variants differ", () => {
  const primary = renderToStaticMarkup(<Button>Go</Button>);
  const danger = renderToStaticMarkup(<Button variant="danger">Go</Button>);
  const small = renderToStaticMarkup(<Button size="sm">Go</Button>);
  assert.match(primary, /type="button"/);
  assert.notEqual(classOf(primary), classOf(danger));
  assert.notEqual(classOf(primary), classOf(small));
});

test("Card and its header parts render children and forward props", () => {
  const markup = renderToStaticMarkup(
    <Card className="extra-card" aria-labelledby="card-title" data-testid="card">
      <CardHeader className="extra-header">
        <CardTitle id="card-title">Analytics</CardTitle>
        <CardDescription>Last 28 days</CardDescription>
      </CardHeader>
      Body
    </Card>,
  );
  assert.match(markup, /^<section /);
  assert.match(markup, /aria-labelledby="card-title"/);
  assert.match(markup, /data-testid="card"/);
  assert.ok(classOf(markup).split(" ").includes("extra-card"));
  assert.match(markup, /class="[^"]*extra-header[^"]*"/);
  assert.match(markup, /<h2 [^>]*id="card-title"[^>]*>Analytics<\/h2>/);
  assert.match(markup, /<p [^>]*>Last 28 days<\/p>/);
  assert.match(markup, /Body<\/section>$/);
});

test("Card can render a different element", () => {
  const markup = renderToStaticMarkup(<Card as="div">Plain</Card>);
  assert.match(markup, /^<div /);
});

test("Badge renders children, forwards attributes and tones differ", () => {
  const neutral = renderToStaticMarkup(<Badge title="state">Draft</Badge>);
  const tones = (["neutral", "rose", "sky", "mint", "peach", "danger", "warn"] as const).map((tone) =>
    classOf(renderToStaticMarkup(<Badge tone={tone}>x</Badge>)),
  );
  assert.match(neutral, /^<span /);
  assert.match(neutral, /title="state"/);
  assert.match(neutral, />Draft<\/span>$/);
  assert.equal(new Set(tones).size, tones.length);
  assert.ok(classOf(renderToStaticMarkup(<Badge className="ml-2">x</Badge>)).split(" ").includes("ml-2"));
});

test("Field primitives render native controls with forwarded attributes", () => {
  const label = renderToStaticMarkup(<Label htmlFor="caption" className="lbl">Caption</Label>);
  const input = renderToStaticMarkup(<Input id="caption" type="email" required aria-invalid="true" className="inp" />);
  const select = renderToStaticMarkup(
    <Select aria-label="Timezone" defaultValue="UTC" className="sel">
      <option value="UTC">UTC</option>
    </Select>,
  );
  const textarea = renderToStaticMarkup(<Textarea rows={4} placeholder="Write" className="txt" />);
  const hint = renderToStaticMarkup(<FieldHint id="hint">Optional</FieldHint>);
  const error = renderToStaticMarkup(<FieldError>Required</FieldError>);

  assert.match(label, /^<label [^>]*for="caption"[^>]*>Caption<\/label>$/);
  assert.ok(classOf(label).split(" ").includes("lbl"));
  assert.match(input, /^<input /);
  assert.match(input, /type="email"/);
  assert.match(input, /required=""/);
  assert.match(input, /aria-invalid="true"/);
  assert.ok(classOf(input).split(" ").includes("inp"));
  assert.match(select, /^<select [^>]*aria-label="Timezone"/);
  assert.match(select, /<option value="UTC" selected="">UTC<\/option>/);
  assert.ok(classOf(select).split(" ").includes("sel"));
  assert.match(textarea, /^<textarea [^>]*rows="4"[^>]*placeholder="Write"/);
  assert.ok(classOf(textarea).split(" ").includes("txt"));
  assert.match(hint, /^<p [^>]*id="hint"[^>]*>Optional<\/p>$/);
  assert.match(error, /role="alert"/);
  assert.match(error, />Required<\/p>$/);
  assert.notEqual(classOf(hint), classOf(error));
});

test("Field controls share a visible rose focus style", () => {
  for (const markup of [
    renderToStaticMarkup(<Input />),
    renderToStaticMarkup(<Select />),
    renderToStaticMarkup(<Textarea />),
  ]) {
    assert.ok(classOf(markup).split(" ").includes("focus-visible:border-rose"));
  }
});

test("SectionHeader renders title, optional eyebrow, description and actions", () => {
  const full = renderToStaticMarkup(
    <SectionHeader
      eyebrow="Schedule"
      title="Social queue"
      description="Upcoming posts"
      actions={<button type="button">Refresh</button>}
      className="mb-4"
      id="queue-header"
    />,
  );
  const minimal = renderToStaticMarkup(<SectionHeader title="Rules" />);
  assert.match(full, /id="queue-header"/);
  assert.ok(classOf(full).split(" ").includes("mb-4"));
  assert.match(full, />Schedule</);
  assert.match(full, /<h2[^>]*>Social queue<\/h2>/);
  assert.match(full, />Upcoming posts</);
  assert.match(full, /<button type="button">Refresh<\/button>/);
  assert.match(minimal, /<h2[^>]*>Rules<\/h2>/);
  assert.doesNotMatch(minimal, /<p/);
});

test("SectionHeader supports a custom heading level", () => {
  const markup = renderToStaticMarkup(<SectionHeader title="Details" headingLevel={3} />);
  assert.match(markup, /<h3[^>]*>Details<\/h3>/);
});

test("EmptyState renders title, description and optional action", () => {
  const full = renderToStaticMarkup(
    <EmptyState
      title="No posts yet"
      description="Schedule your first post."
      action={<a href="/dashboard/social">Compose</a>}
      className="mt-6"
      role="status"
    />,
  );
  const minimal = renderToStaticMarkup(<EmptyState title="Nothing here" />);
  assert.match(full, /role="status"/);
  assert.ok(classOf(full).split(" ").includes("mt-6"));
  assert.match(full, />No posts yet</);
  assert.match(full, />Schedule your first post\.</);
  assert.match(full, /<a href="\/dashboard\/social">Compose<\/a>/);
  assert.match(minimal, />Nothing here</);
  assert.doesNotMatch(minimal, /<a /);
});
