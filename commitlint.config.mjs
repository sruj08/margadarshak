/** Conventional Commits that reference a ticket (MD-xxx) where possible (CLAUDE.md, MD-010). */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      1,
      "always",
      [
        "web",
        "console",
        "api",
        "ui",
        "rules",
        "api-client",
        "game-core",
        "e2e",
        "infra",
        "ci",
        "docs",
        "deps",
        "workflows",
        "n8n",
      ],
    ],
    "body-max-line-length": [1, "always", 120],
  },
};
