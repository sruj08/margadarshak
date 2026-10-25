import { defineRouting } from "next-intl/routing";

/**
 * 7 Indian languages supported across UI and Voice Agent:
 * - en: English (India)
 * - hi: Hindi (हिन्दी)
 * - doi: Dogri (डोगरी — J&K / GCET Jammu)
 * - pa: Punjabi (ਪੰਜਾਬੀ — Punjab / Patiala / Chandigarh / Mohali)
 * - mr: Marathi (मराठी — Maharashtra / Mumbai / Pune)
 * - gu: Gujarati (ગુજરાતી — Gujarat automated driving test tracks)
 * - ta: Tamil (தமிழ் — Tamil Nadu / South India)
 */
export const APP_LOCALES = ["en", "hi", "doi", "pa", "mr", "gu", "ta"] as const;

export const routing = defineRouting({
  locales: APP_LOCALES,
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: { name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" },
});

export type AppLocale = (typeof routing.locales)[number];

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return (
    value === "en" ||
    value === "hi" ||
    value === "doi" ||
    value === "pa" ||
    value === "mr" ||
    value === "gu" ||
    value === "ta"
  );
}

export interface LanguageMeta {
  code: AppLocale;
  nativeLabel: string;
  englishLabel: string;
  regionLabel: string;
  bcp47: string;
  sampleGreeting: string;
  voicePreviewLabel: string;
  scriptTag: string;
}

export const LANGUAGE_META: Record<AppLocale, LanguageMeta> = {
  hi: {
    code: "hi",
    nativeLabel: "हिन्दी",
    englishLabel: "Hindi",
    regionLabel: "देवनागरी · North & Central India",
    bcp47: "hi-IN",
    sampleGreeting: "नमस्ते, मैं मार्गदर्शक हूँ — सड़क सुरक्षा और लाइसेंस में आपकी मदद के लिए।",
    voicePreviewLabel: "आवाज़ सुनें",
    scriptTag: "अ",
  },
  en: {
    code: "en",
    nativeLabel: "English",
    englishLabel: "Indian English",
    regionLabel: "Latin · All-India",
    bcp47: "en-IN",
    sampleGreeting:
      "Namaste! I am Margdarshak — here to guide you through your licence and road safety.",
    voicePreviewLabel: "Voice Preview",
    scriptTag: "Aa",
  },
  doi: {
    code: "doi",
    nativeLabel: "डोगरी",
    englishLabel: "Dogri",
    regionLabel: "देवनागरी · जम्मू-कश्मीर (J&K)",
    bcp47: "hi-IN",
    sampleGreeting: "नमस्कार जी! में मार्गदर्शक आं — तुंदी लाइसेंस ते सड़क सुरक्षा च मदद आस्तै।",
    voicePreviewLabel: "अवाज़ सुनो",
    scriptTag: "डो",
  },
  pa: {
    code: "pa",
    nativeLabel: "ਪੰਜਾਬੀ",
    englishLabel: "Punjabi",
    regionLabel: "ਗੁਰਮੁਖੀ · ਪੰਜਾਬ & ਚੰਡੀਗੜ੍ਹ",
    bcp47: "pa-IN",
    sampleGreeting: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਜੀ! ਮੈਂ ਮਾਰਗਦਰਸ਼ਕ ਹਾਂ — ਤੁਹਾਡੇ ਲਾਇਸੰਸ ਅਤੇ ਸੜਕ ਸੁਰੱਖਿਆ ਦੀ ਮਦਦ ਲਈ।",
    voicePreviewLabel: "ਆਵਾਜ਼ ਸੁਣੋ",
    scriptTag: "ੳ",
  },
  mr: {
    code: "mr",
    nativeLabel: "मराठी",
    englishLabel: "Marathi",
    regionLabel: "देवनागरी · महाराष्ट्र (Mumbai & Pune)",
    bcp47: "mr-IN",
    sampleGreeting: "नमस्कार! मी मार्गदर्शक आहे — तुमच्या ड्रायव्हिंग लायसन्स आणि रस्ते सुरक्षेसाठी सोबती.",
    voicePreviewLabel: "आवाज ऐका",
    scriptTag: "म",
  },
  gu: {
    code: "gu",
    nativeLabel: "ગુજરાતી",
    englishLabel: "Gujarati",
    regionLabel: "ગુજરાતી · ગુજરાત (RTO Test Tracks)",
    bcp47: "gu-IN",
    sampleGreeting: "નમસ્તે! હું માર્ગદર્શક છું — તમારા ડ્રાઇવિંગ લાઇસન્સ અને માર્ગ સલામતીમાં મદદ માટે.",
    voicePreviewLabel: "અવાજ સાંભળો",
    scriptTag: "અ",
  },
  ta: {
    code: "ta",
    nativeLabel: "தமிழ்",
    englishLabel: "Tamil",
    regionLabel: "தமிழ் · தமிழ்நாடு (South India)",
    bcp47: "ta-IN",
    scriptTag: "அ",
    sampleGreeting: "வணக்கம்! நான் மார்கதர்ஷக் — உங்கள் ஓட்டுநர் உரிமம் மற்றும் சாலைப் பாதுகாப்பிற்கான வழிகாட்டி.",
    voicePreviewLabel: "குரல் முன்னோட்டம்",
  },
};
