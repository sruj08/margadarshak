import { RegisterForm } from "@/features/curator/RegisterForm";
import { enterLocale } from "@/i18n/page-locale";

/** `/admin/clips/new`: register a raw upload (API-55 registerClip, starts clip_ingest). */
export default async function RegisterClipPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await enterLocale(params);
  return <RegisterForm />;
}
