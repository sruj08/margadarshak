/**
 * "All services, by who you are" (SCR-004, MD-120). Every item resolves to a live route: a built
 * screen, or an honest "coming" page under /services/{id} that says what works today. No dead links.
 */

export type GroupId = "learning" | "holder" | "family" | "helper" | "school" | "officer";

export interface ServiceItem {
  id: string;
  href: string;
  /** Live screen (true) or an honest "coming" page (false). */
  live: boolean;
  /** Extra search words (EN, HI, Hinglish). */
  synonyms: string;
  external?: string;
}

export const COMING = [
  "book-test",
  "test-day",
  "test-vehicle",
  "retest",
  "approval",
  "digilocker",
  "ll-expiry",
  "renew",
  "add-class",
  "address",
  "duplicate",
  "idp",
  "form-1a",
  "first-vehicle",
  "challan",
  "family",
  "minor-riding",
  "helper",
  "school",
  "console",
] as const;
export type ComingId = (typeof COMING)[number];

export const GROUPS: Record<GroupId, ServiceItem[]> = {
  learning: [
    {
      id: "plan",
      href: "/plan",
      live: true,
      synonyms: "plan first licence ll learner प्लान लाइसेंस लर्नर pehla",
    },
    {
      id: "apply",
      href: "/apply",
      live: true,
      synonyms: "apply application form एप्लीकेशन फ़ॉर्म bharna",
    },
    {
      id: "practise",
      href: "/learn",
      live: true,
      synonyms: "mock test practice questions signs अभ्यास टेस्ट सवाल",
    },
    {
      id: "book-test",
      href: "/dl/apply",
      live: true,
      synonyms: "slot book driving test स्लॉट बुक",
    },
    { id: "check", href: "/licence", live: true, synonyms: "status track where am i स्टेटस कहाँ" },
  ],
  holder: [
    {
      id: "renew",
      href: "/services/renew",
      live: false,
      synonyms: "renew renewal expired रिन्यू नवीनीकरण",
    },
    {
      id: "add-class",
      href: "/services/add-class",
      live: false,
      synonyms: "add class car bike नई श्रेणी",
    },
    { id: "address", href: "/services/address", live: false, synonyms: "address change पता बदलें" },
    {
      id: "duplicate",
      href: "/services/duplicate",
      live: false,
      synonyms: "duplicate lost damaged dupe डुप्लीकेट खोया",
    },
    {
      id: "idp",
      href: "/services/idp",
      live: false,
      synonyms: "idp international permit abroad विदेश",
    },
    {
      id: "challan",
      href: "/services/challan",
      live: false,
      synonyms: "challan fine echallan चालान जुर्माना",
      external: "echallan.parivahan.gov.in",
    },
  ],
  family: [
    {
      id: "family",
      href: "/services/family",
      live: false,
      synonyms: "parent father mother papa माता पिता पापा",
    },
    {
      id: "minor-riding",
      href: "/services/minor-riding",
      live: false,
      synonyms: "child minor 16 17 बच्चा 50cc",
    },
    {
      id: "privacy",
      href: "/privacy",
      live: true,
      synonyms: "privacy consent delete data प्राइवेसी डेटा",
    },
  ],
  helper: [
    {
      id: "helper",
      href: "/services/helper",
      live: false,
      synonyms: "helper cyber cafe csc हेल्पर साइबर कैफ़े",
    },
  ],
  school: [
    {
      id: "school",
      href: "/services/school",
      live: false,
      synonyms: "driving school instructor स्कूल",
    },
  ],
  officer: [
    {
      id: "console",
      href: "/services/console",
      live: false,
      synonyms: "rto officer state console अधिकारी",
    },
  ],
};
