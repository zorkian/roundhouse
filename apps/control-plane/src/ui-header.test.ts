// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { renderSiteHeader, sharedHeaderStyles } from "./ui-header.js";

describe("site header", () => {
  it("links the brand home and keeps navigation and account details separate", () => {
    const html = renderSiteHeader({
      githubUserId: 7,
      githubLogin: "octo<script>",
    });

    expect(html).toContain('<a class="site-brand" href="/">Roundhouse</a>');
    expect(html).toContain('<a href="/">Runs</a>');
    expect(html).toContain('<a href="/conversations">Conversations</a>');
    expect(html).toContain('<a href="/usage">Model usage</a>');
    expect(html).toContain('src="https://avatars.githubusercontent.com/u/7"');
    expect(html).toContain(`alt="octo&lt;script&gt;'s GitHub avatar"`);
    expect(html).toContain(
      '<span class="site-login">octo&lt;script&gt;</span>',
    );
    expect(html).toContain('class="site-account"');
    expect(html.match(/class="env-badge"/g)).toHaveLength(1);
    expect(html).toContain(">Development</span>");
    expect(html).toContain('</div><span class="env-badge">Development</span>');
    expect(sharedHeaderStyles).toContain(
      ".site-header>.env-badge{position:absolute",
    );
    expect(sharedHeaderStyles).toContain("left:50%");
    expect(sharedHeaderStyles).toContain("transform:translateX(-50%)");
  });
});
