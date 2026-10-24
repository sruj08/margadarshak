import { existsSync } from "node:fs";
import { join } from "node:path";
import { gameSlug } from "./curriculum";

/**
 * Whether a game's own route exists in this build (server-only; evaluated when the page is
 * prerendered). Each game's route is owned by its own workstream, so the games grid and the skill
 * pages link to a game only when its page is really there, and say "Coming soon" otherwise (MD-021:
 * no dead buttons).
 */
const APP = join(process.cwd(), "src", "app", "[locale]");

export function gameHref(gameId: string): string | null {
  const slug = gameSlug(gameId);
  const citizen = join(APP, "(citizen)", "learn", "practise", slug, "page.tsx");
  const play = join(APP, "(play)", "learn", "practise", slug);
  return existsSync(citizen) || existsSync(play) ? `/learn/practise/${slug}` : null;
}

export function routeExists(...segments: string[]): boolean {
  return existsSync(join(APP, ...segments, "page.tsx"));
}
