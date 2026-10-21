import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardNav } from "../dashboard-sidebar";

function linksOf(markup: string): { href: string; current: boolean; label: string }[] {
  return [...markup.matchAll(/<a([^>]*)>(.*?)<\/a>/g)].map(([, attributes, inner]) => ({
    href: /href="([^"]*)"/.exec(attributes)?.[1] ?? "",
    current: attributes.includes('aria-current="page"'),
    label: inner.replace(/<[^>]*>/g, ""),
  }));
}

test("DashboardNav keeps the navigation landmark and the links in order", () => {
  const markup = renderToStaticMarkup(<DashboardNav pathname="/dashboard" />);

  assert.match(markup, /<nav[^>]*aria-label="Dashboard navigation"/);
  assert.deepEqual(
    linksOf(markup).map(({ href, label }) => [href, label]),
    [
      ["/dashboard", "Dashboard"],
      ["/dashboard/upload", "Private upload"],
      ["/dashboard/quota", "Quota usage"],
      ["/dashboard/social", "Social publishing"],
    ],
  );
});

test("DashboardNav marks only the link for the current path with aria-current", () => {
  const markup = renderToStaticMarkup(<DashboardNav pathname="/dashboard/quota" />);

  assert.deepEqual(
    linksOf(markup).filter(({ current }) => current).map(({ href }) => href),
    ["/dashboard/quota"],
  );
});

test("DashboardNav marks no link when the path is not a navigation target", () => {
  const markup = renderToStaticMarkup(<DashboardNav pathname="/dashboard/unknown" />);

  assert.equal(linksOf(markup).filter(({ current }) => current).length, 0);
  assert.doesNotMatch(markup, /aria-current/);
});
