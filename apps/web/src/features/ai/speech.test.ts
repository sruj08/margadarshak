import { describe, expect, it } from "vitest";
import { adaptScriptForVoice, selectIndianVoice, toSpeechLang } from "./speech";

function mockVoice(name: string, lang: string): SpeechSynthesisVoice {
  return {
    name,
    lang,
    default: false,
    localService: true,
    voiceURI: name,
  };
}

describe("speech — Indian voice selection & 7-language mapping", () => {
  it("normalizes all 7 supported app locales via toSpeechLang", () => {
    expect(toSpeechLang("en")).toBe("en");
    expect(toSpeechLang("en-IN")).toBe("en");
    expect(toSpeechLang("hi")).toBe("hi");
    expect(toSpeechLang("hi-IN")).toBe("hi");
    expect(toSpeechLang("doi")).toBe("doi");
    expect(toSpeechLang("doi-IN")).toBe("doi");
    expect(toSpeechLang("pa")).toBe("pa");
    expect(toSpeechLang("pa-IN")).toBe("pa");
    expect(toSpeechLang("mr")).toBe("mr");
    expect(toSpeechLang("mr-IN")).toBe("mr");
    expect(toSpeechLang("gu")).toBe("gu");
    expect(toSpeechLang("gu-IN")).toBe("gu");
    expect(toSpeechLang("ta")).toBe("ta");
    expect(toSpeechLang("ta-IN")).toBe("ta");
    expect(toSpeechLang("unknown")).toBe("en");
  });

  it("prioritizes natural Indian English voices over generic US/UK voices", () => {
    const voices = [
      mockVoice("Microsoft David - English (United States)", "en-US"),
      mockVoice("Google UK English Male", "en-GB"),
      mockVoice("Microsoft Neerja Online (Natural) - English (India)", "en-IN"),
    ];
    const selected = selectIndianVoice("en", voices);
    expect(selected?.name).toContain("Neerja");
    expect(selected?.lang).toBe("en-IN");
  });

  it("selects natural Hindi Indian voice (Swara) for Hindi and Dogri", () => {
    const voices = [
      mockVoice("Microsoft Neerja Online (Natural) - English (India)", "en-IN"),
      mockVoice("Microsoft Swara Online (Natural) - Hindi (India)", "hi-IN"),
    ];
    expect(selectIndianVoice("hi", voices)?.name).toContain("Swara");
    expect(selectIndianVoice("doi", voices)?.name).toContain("Swara");
  });

  it("selects regional Indian voice when available and falls back to hi-IN when missing", () => {
    const withRegional = [
      mockVoice("Microsoft Swara Online (Natural) - Hindi (India)", "hi-IN"),
      mockVoice("Microsoft Aarohi Online (Natural) - Marathi (India)", "mr-IN"),
      mockVoice("Microsoft Dhwani Online (Natural) - Gujarati (India)", "gu-IN"),
      mockVoice("Microsoft Pallavi Online (Natural) - Tamil (India)", "ta-IN"),
    ];
    expect(selectIndianVoice("mr", withRegional)?.name).toContain("Aarohi");
    expect(selectIndianVoice("gu", withRegional)?.name).toContain("Dhwani");
    expect(selectIndianVoice("ta", withRegional)?.name).toContain("Pallavi");

    // Punjabi fallback to Hindi-IN voice when pa-IN voice is absent on OS
    expect(selectIndianVoice("pa", withRegional)?.name).toContain("Swara");
  });

  it("transliterates Gurmukhi, Gujarati, and Tamil scripts into Devanagari when using hi-IN fallback voice", () => {
    // Native voice keeps original script intact
    expect(adaptScriptForVoice("ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", "pa", "pa-IN")).toBe("ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ");
    expect(adaptScriptForVoice("નમસ્તે", "gu", "gu-IN")).toBe("નમસ્તે");
    expect(adaptScriptForVoice("வணக்கம்", "ta", "ta-IN")).toBe("வணக்கம்");

    // Fallback to hi-IN transliterates into Devanagari so TTS speaks phonetically instead of silence
    const paAdapted = adaptScriptForVoice("ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", "pa", "hi-IN");
    expect(paAdapted).toBe("सति स्री अकाल");

    const guAdapted = adaptScriptForVoice("નમસ્તે માર્ગદર્શક", "gu", "hi-IN");
    expect(guAdapted).toBe("नमस्ते मार्गदर्शक");

    const taAdapted = adaptScriptForVoice("வணக்கம்", "ta", "hi-IN");
    expect(taAdapted).toBe("वणक्कम्");
  });
});
