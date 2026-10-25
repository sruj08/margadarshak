import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import hi from "../../../messages/hi.json";
import { INTENT_HREF, INTENTS, langOf, routeIntent } from "./intents";

describe("voice intents", () => {
  it.each([
    ["I want a licence", "plan"],
    ["mujhe licence banwana hai", "plan"],
    ["मॉक टेस्ट खोलो", "mock_test"],
    ["show road signs", "signs"],
    ["सड़क के संकेत दिखाओ", "signs"],
    ["upload my photo", "photo"],
    ["मेरी फ़ोटो अपलोड करो", "photo"],
    ["which documents do I need", "documents"],
    ["where is my application", "check"],
    ["renew my licence", "renew"],
    ["licence for my father", "family"],
    ["pay the fee", "handoff"],
    ["voice guide kya hai", "about_voice"],
    ["लर्नर लाइसेंस दी फ़ीस किन्नी ऐ?", "fees"],
    ["ਲਰਨਰ ਲਾਇਸੰਸ ਦੀ ਫੀਸ ਕਿੰਨੀ ਹੈ?", "fees"],
    ["लर्नर लायसन्सची फी किती आहे?", "fees"],
    ["લર્નર લાઇસન્સની ફી કેટલી છે?", "fees"],
    ["பழகும் உரிமம் கட்டணம் எவ்வளவு?", "fees"],
    ["blah blah", "help"],
  ])("%s -> %s", (text, intent) => {
    expect(routeIntent(text)).toBe(intent);
  });

  it("detects Hindi and regional Indian languages by script and vocabulary", () => {
    expect(langOf("मेरा प्लान बनाओ")).toBe("hi");
    expect(langOf("make my plan")).toBe("en");
    expect(langOf("तुस केह् सिक्खना ऐ")).toBe("doi");
    expect(langOf("ਲਰਨਰ ਲਾਇਸੰਸ")).toBe("pa");
    expect(langOf("तुमचे लायसन्स किती आहे")).toBe("mr");
    expect(langOf("મારું લાઇસન્સ")).toBe("gu");
    expect(langOf("என் உரிமம்")).toBe("ta");
  });

  it("maps every intent to a route or stays on the sheet, and has copy in both languages", () => {
    for (const id of INTENTS) {
      const href = INTENT_HREF[id];
      expect(href === null || href.startsWith("/")).toBe(true);
      for (const m of [en, hi]) {
        expect(m.voice.intent[id as keyof typeof m.voice.intent]).toBeTruthy();
        expect(m.voice[`go_${id}` as keyof typeof m.voice]).toBeTruthy();
      }
    }
  });
});
