import { redirect } from "@/i18n/navigation";
import { enterLocale } from "@/i18n/page-locale";

/** `/admin` → the clip board (the only admin area in the citizen app, plan D4). */
export default async function AdminIndex({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await enterLocale(params);
  redirect({ href: "/admin/clips", locale });
}
