/**
 * Data for the lab replica (MD-139): the observed Sarathi LL sequence, unbranded
 * (research/ps1-current-state/01-sarathi-screens.md §A.1, observed 22 Oct 2026). Synthetic only.
 */

export const LAB_STATES = [
  "Andaman & Nicobar Island",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttarakhand",
  "Uttar Pradesh",
  "West Bengal",
];

/** A3 "Select Category if required" as observed. */
export const LAB_CATEGORIES = [
  "Diplomats (Foreigner)",
  "Foreigners (But not Diplomats)",
  "General",
  "OCI",
  "Divyang (Differently Abled)",
  "Repatriate",
  "Refugees",
  "Ex-Servicemen",
];

/** A3 country list (abridged from ~240; the odd entries the real list carries are kept). */
export const LAB_COUNTRIES = [
  "AFGHANISTAN",
  "AUSTRALIA",
  "BANGLADESH",
  "BHUTAN",
  "CANADA",
  "CHINA",
  "FRANCE",
  "GERMANY",
  "INDIA",
  "INDONESIA",
  "IRAN",
  "JAPAN",
  "KENYA",
  "MALAYSIA",
  "MALDIVES",
  "MAURITIUS",
  "MRP TEST COUNTRY",
  "MYANMAR",
  "NEPAL",
  "NEW ZEALAND",
  "OMAN",
  "PAKISTAN",
  "QATAR",
  "SAUDI ARABIA",
  "SINGAPORE",
  "SOUTH AFRICA",
  "SRI LANKA",
  "THAILAND",
  "UNITED ARAB EMIRATES",
  "UNITED KINGDOM",
  "UNITED STATES",
  "YUGOSLAVIA",
];

/** J&K offices for "Please Select Rto Office to display camps/Sewa kendras" (20 as observed). */
export const LAB_RTOS = [
  "RTO JAMMU",
  "RTO KASHMIR",
  "ARTO ANANTNAG",
  "ARTO BANDIPORA",
  "ARTO BARAMULLA",
  "ARTO BUDGAM",
  "ARTO DODA",
  "ARTO GANDERBAL",
  "ARTO KATHUA",
  "ARTO KISHTWAR",
  "ARTO KULGAM",
  "ARTO KUPWARA",
  "ARTO POONCH",
  "ARTO PULWAMA",
  "ARTO RAJOURI",
  "ARTO RAMBAN",
  "ARTO REASI",
  "ARTO SAMBA",
  "ARTO SHOPIAN",
  "ARTO UDHAMPUR",
];

/** A6 Class of Vehicle: Sarathi codes only, no plain names (as observed). */
export const LAB_COVS = [
  "MC 50CC",
  "MCWOG",
  "MCWG",
  "LMV",
  "LMV-TR",
  "E-RICKSHAW",
  "E-CART",
  "MGV",
  "HGMV",
  "HPMV",
];

/** State home left menu (~70 links in reality; the groups and a sample of links). */
export const LAB_MENU: Array<{ group: string; links: string[] }> = [
  {
    group: "Learner Licence",
    links: [
      "Apply for Learner Licence",
      "Online LL Test (STALL)",
      "Print Learner Licence",
      "Fee Payment",
      "LL Slot Booking",
      "Appointment Reschedule",
    ],
  },
  {
    group: "Driving Licence",
    links: [
      "Apply for Driving Licence",
      "Services on DL (Renewal/Duplicate/AEDL/IDP/Others)",
      "Apply for IDP",
      "Print Driving Licence",
      "DL Extract",
    ],
  },
  { group: "Conductor Licence", links: ["New Conductor Licence", "Services on Conductor Licence"] },
  {
    group: "Driving School Licence",
    links: ["Apply for Driving School Licence", "Services on Driving School Licence"],
  },
  {
    group: "Appointments",
    links: ["LL Test Slot Booking", "DL Test Slot Booking", "Reschedule Appointment"],
  },
  { group: "Upload Document", links: ["Upload Document", "Upload Photo and Signature"] },
  { group: "Fee Payments", links: ["Fee Payments", "Verify Payment", "Print Receipt"] },
  {
    group: "Others",
    links: [
      "Application Status",
      "Find Application Number",
      "Know Your Licence Details",
      "Feedback",
    ],
  },
];

/** J&K stage list on "New LL Stage Details" (A.3). */
export const LAB_STAGES_JK = [
  "Fill Application Details",
  "Upload Photo and Signature",
  "Upload Documents",
  "Fee Payment",
  "Verify Payment Status",
  "Print Receipt",
];

/** Role cards (FIELD_STUDY §3.2). Fake identifiers: only the replica accepts them. */
export const ROLE_CARDS = {
  X: {
    name: "TANVI (SYNTHETIC)",
    dob: "07-07-2007",
    relation: "",
    address: "Ward 4, Kathua, Jammu and Kashmir 184101",
    aadhaar: "000000000001",
    mobile: "9000000001",
    expectedCov: ["MCWOG"],
  },
  Y: {
    name: "RAJINDER (SYNTHETIC)",
    dob: "11-02-1984",
    relation: "S/o MOHAN (SYNTHETIC)",
    address: "Gandhi Nagar, Jammu, Jammu and Kashmir 180004",
    aadhaar: "000000000002",
    mobile: "9000000002",
    expectedCov: ["LMV"],
  },
} as const;

export function captcha(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function applicationNumber(): string {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < 10) s += String(Math.floor(Math.random() * 10));
  return s;
}
