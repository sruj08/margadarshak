import { notFound } from "next/navigation";

/** Any unknown path inside a locale renders the localised 404 (with footer) instead of the root one. */
export default function CatchAll() {
  notFound();
}
