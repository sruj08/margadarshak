#!/usr/bin/env node
// One-off generator for the state overlays researched on 2026-10-25. Re-running overwrites only the
// codes listed below; hand-curated packs (DL, JK, KL, MH, PB, TN) are never touched.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "rulepacks", "states");
const CHECKED = "2026-10-25";
const HT_SUSPEND =
  "https://www.hindustantimes.com/cities/pune-news/maha-seeks-temporary-suspension-of-faceless-learners-licence-service-101758395336105.html";
const MARUTI_2026 =
  "https://www.marutisuzuki.com/corporate/media/press-releases/2026/february/maruti-suzuki-signs-memorandum-of-agreement-with-transport-department";

// ll: yes | no | unknown. dl: automated | manual | mixed | unknown.
const S = [
  [
    "AP",
    "Andhra Pradesh",
    "yes",
    "https://assets.thehansindia.com/news/cities/visakhapatnam/ap-introduces-sarathi-online-learners-licence-registration-test-1135244",
    "high",
    "automated",
    "9 automated driving test tracks (Anantapur, Chittoor, Gannavaram, Tirupati, Kurnool, Guntur, Nellore, Proddatur, Gambheeram)",
    MARUTI_2026,
    "high",
    "Home LL test uses a secure exam browser with live face match; village and ward secretariats help people without a PC.",
    "https://www.aptransport.org",
  ],
  [
    "AR",
    "Arunachal Pradesh",
    "unknown",
    "https://thehillstimes.in/arunachal-pradesh/arunachal-pradesh-to-implement-faceless-services-and-e-challan-system",
    "low",
    "unknown",
    "",
    "",
    "",
    "Faceless transport services were announced in Oct 2025; the home LL test is not confirmed yet.",
    "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do",
  ],
  [
    "AS",
    "Assam",
    "yes",
    "https://government.economictimes.indiatimes.com/news/governance/assam-transport-dept-to-enable-aadhar-based-contactless-services-through-csc-network-now/89718094",
    "high",
    "manual",
    "inspector test at the DTO; automated tracks being built at training centres",
    "https://www.indiatodayne.in/assam/story/driving-license-process-in-assam-to-go-fully-automated-with-new-testing-tracks-1181633-2025-03-09",
    "medium",
    "You can also apply through Sewa Setu or a Common Service Centre.",
    "https://comtransport.assam.gov.in",
  ],
  [
    "BR",
    "Bihar",
    "yes",
    "https://www.prabhatkhabar.com/state/bihar/muzaffarpur/transport-department-changes-driving-license-rules-applicants-can-take-test-for-learning-license-from-anywhere",
    "medium",
    "mixed",
    "7 automated tracks and the IDTR at Aurangabad; manual elsewhere",
    MARUTI_2026,
    "high",
    "If you fail the LL test, you can reapply after a week.",
    "https://transport.bihar.gov.in",
  ],
  [
    "CG",
    "Chhattisgarh",
    "unknown",
    "https://cgtransport.gov.in/WelcomeMassage.aspx",
    "low",
    "mixed",
    "1 automated track and the IDTR at Naya Raipur; manual elsewhere",
    MARUTI_2026,
    "medium",
    "The LL test is 10 questions; 6 correct to pass.",
    "https://cgtransport.gov.in",
  ],
  [
    "GA",
    "Goa",
    "yes",
    "https://timesofindia.indiatimes.com/city/goa/learners-licence-test-only-after-clearing-facial-check/articleshow/99567251.cms",
    "high",
    "manual",
    "inspector test; a camera-based track at Verna is planned",
    "https://timesofindia.indiatimes.com/city/goa/by-next-year-automated-driving-tests-at-verna-to-eliminate-human-bias/articleshow/99422900.cms",
    "medium",
    "The home LL test starts only after an Aadhaar face match.",
    "https://www.goatransport.gov.in",
  ],
  [
    "GJ",
    "Gujarat",
    "yes",
    "https://deshgujarat.com/2025/07/07/how-to-get-learning-licence-without-visiting-rto-in-gujarat/",
    "high",
    "mixed",
    "automated tracks at 23 RTOs (some sensors faulty, so a few RTOs test manually)",
    "https://timesofindia.indiatimes.com/city/ahmedabad/gujarat-sensors-at-driving-test-tracks-in-7-rtos-damaged-or-faulty-cag/articleshow/129987257.cms",
    "high",
    "The LL test is 15 questions; 9 correct to pass.",
    "https://cot.gujarat.gov.in",
  ],
  [
    "HR",
    "Haryana",
    "unknown",
    "https://haryanatransport.gov.in/en/content/learner-driving-licence",
    "low",
    "mixed",
    "2 automated tracks and IDTRs at Bahadurgarh and Rohtak; manual elsewhere",
    "https://www.marutisuzuki.com/engage/safety/behavioural-safety/institute-of-driving-traffic-research.html",
    "medium",
    "The state page describes an LL test at the centre with biometrics; check Sarathi for the home option.",
    "https://haryanatransport.gov.in",
  ],
  [
    "HP",
    "Himachal Pradesh",
    "yes",
    "https://www.tribuneindia.com/news/himachal/now-get-learners-licence-online-521716/",
    "high",
    "mixed",
    "first automated track at Haroli (Una); manual elsewhere",
    "https://www.tribuneindia.com/news/himachal/himachal-gets-first-automated-driving-test-facility-at-haroli/",
    "high",
    "Watch the road-safety tutorial within 7 days of applying.",
    "https://himachal.nic.in/index1.php?dpt_id=3",
  ],
  [
    "JH",
    "Jharkhand",
    "no",
    HT_SUSPEND,
    "medium",
    "manual",
    "inspector test; no automated tracks reported",
    "https://newswavejharkhand.com/cag-report-minors-in-transport-department-issue-driving-licences-reveals-poor-testing-pattern/",
    "medium",
    "",
    "https://transport.jharkhand.gov.in",
  ],
  [
    "KA",
    "Karnataka",
    "yes",
    "https://www.thehindu.com/news/national/karnataka/karnataka-introduces-ai-powered-smart-lock-to-curb-llr-fraud-tighten-online-testing-norms/article70335429.ece",
    "high",
    "mixed",
    "about 20 automated tracks live, more under construction",
    "https://kannada.asianetnews.com/karnataka-districts/dandeli-automated-driving-test-track-inauguration-ramalinga-reddy-gvd/articleshow-rme90gs",
    "medium",
    "The LL test is offered in Kannada, Hindi and English.",
    "https://transport.karnataka.gov.in",
  ],
  [
    "MP",
    "Madhya Pradesh",
    "yes",
    "https://timesofindia.indiatimes.com/city/bhopal/now-get-learners-licence-test-done-at-home-in-madhya-pradesh/articleshow/85000335.cms",
    "high",
    "manual",
    "mostly inspector tests",
    "https://www.bhaskar.com/local/mp/indore/news/one-license-is-being-made-in-30-seconds-at-indore-rto-132898142.html",
    "low",
    "",
    "https://transport.mp.gov.in",
  ],
  [
    "MN",
    "Manipur",
    "yes",
    "https://www.nic.gov.in/newsletter-content/launch-inauguration-2/",
    "medium",
    "unknown",
    "",
    "",
    "",
    "",
    "https://manipurtransport.gov.in",
  ],
  [
    "ML",
    "Meghalaya",
    "no",
    HT_SUSPEND,
    "medium",
    "unknown",
    "",
    "",
    "",
    "Apply online; the LL test is at the office.",
    "https://megtransport.gov.in",
  ],
  [
    "MZ",
    "Mizoram",
    "yes",
    "https://transport.mizoram.gov.in/post/14online-faceless-learners-licence-hman-theih-turin-tlangzarh-a-ni-ta",
    "medium",
    "unknown",
    "",
    "",
    "",
    "Without Aadhaar, take the LL test at the office.",
    "https://transport.mizoram.gov.in",
  ],
  [
    "NL",
    "Nagaland",
    "no",
    HT_SUSPEND,
    "medium",
    "unknown",
    "",
    "",
    "",
    "",
    "https://mvdnagaland.in",
  ],
  [
    "OD",
    "Odisha",
    "yes",
    "https://informatics.nic.in/news/1606",
    "high",
    "automated",
    "automated tracks at 18 RTOs, 19 more under construction",
    "https://odishatransport.gov.in/content/Modernization/1",
    "high",
    "Odisha built the AI-proctored home LL test that other states now use.",
    "https://odishatransport.gov.in",
  ],
  [
    "RJ",
    "Rajasthan",
    "yes",
    "https://transport.rajasthan.gov.in/content/transportportal/en/transport/eservices/facelessservices.html",
    "medium",
    "mixed",
    "14 automated tracks live; all tracks to be automated",
    "https://timesofindia.indiatimes.com/city/jaipur/rajasthan-to-automate-all-driving-test-tracks/articleshow/131267034.cms",
    "high",
    "The LL test is 20 questions; 12 correct to pass.",
    "https://transport.rajasthan.gov.in",
  ],
  [
    "SK",
    "Sikkim",
    "unknown",
    "https://www.bankbazaar.com/driving-licence/how-to-apply-learning-licence-in-sikkim.html",
    "low",
    "unknown",
    "",
    "",
    "",
    "",
    "https://www.sikkim.gov.in/departments/transport-department",
  ],
  [
    "TS",
    "Telangana",
    "no",
    "https://transport.telangana.gov.in/html/faq-llr.html",
    "high",
    "manual",
    "inspector test; AI cameras planned on Hyderabad tracks",
    "https://telanganatoday.com/telangana-transport-department-plans-ai-powered-cameras-for-driving-tests",
    "medium",
    "The LL test is in Telugu, Hindi or English: 20 questions, 12 correct to pass, in 10 minutes.",
    "https://transport.telangana.gov.in",
  ],
  [
    "TR",
    "Tripura",
    "no",
    "https://transport.tripura.gov.in/activity_schedule.html",
    "medium",
    "manual",
    "inspector test at the DTO on fixed weekdays",
    "https://transport.tripura.gov.in/activity_schedule.html",
    "medium",
    "LL tests run daily from 11:00 to 14:00 at the DTO.",
    "https://transport.tripura.gov.in",
  ],
  [
    "UP",
    "Uttar Pradesh",
    "yes",
    "https://government.economictimes.indiatimes.com/news/digital-india/faceless-rto-service-in-uttar-pradesh-citizens-can-now-get-learners-driving-license-sitting-home/88756600",
    "high",
    "mixed",
    "17 automated tracks; manual elsewhere",
    MARUTI_2026,
    "high",
    "If face authentication fails, take the LL test at the RTO.",
    "https://uptransport.upsdc.gov.in",
  ],
  [
    "UK",
    "Uttarakhand",
    "no",
    "https://transport.uk.gov.in/license/",
    "medium",
    "mixed",
    "4 automated tracks (Dehradun, Rishikesh, Haridwar, Kotdwar); manual elsewhere",
    "https://transport.uk.gov.in/project/establishment-of-automated-driving-test-tracks-in-each-district-of-uttarakhand/",
    "high",
    "",
    "https://transport.uk.gov.in",
  ],
  [
    "WB",
    "West Bengal",
    "yes",
    "https://government.economictimes.indiatimes.com/news/digital-india/written-test-for-learners-licence-goes-online-in-west-bengal/92349239",
    "medium",
    "mixed",
    "sensor track centre at Behala; manual elsewhere",
    "https://www.telegraphindia.com/west-bengal/kolkata/computerised-centre-with-special-tracks-to-test-the-driving-skills-near-behala-flying-club/cid/2034691",
    "medium",
    "A 12-minute road-safety video must be watched before the home LL test.",
    "https://transport.wb.gov.in",
  ],
  [
    "AN",
    "Andaman and Nicobar Islands",
    "unknown",
    "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do",
    "low",
    "unknown",
    "",
    "",
    "",
    "",
    "https://transport.and.nic.in",
  ],
  [
    "CH",
    "Chandigarh",
    "yes",
    "https://timesofindia.indiatimes.com/city/chandigarh/getting-learners-licence-is-just-click-away-in-city/articleshow/102783688.cms",
    "high",
    "automated",
    "automated track at the Sector 23 Traffic Park (sensors and RFID)",
    "https://indianexpress.com/article/cities/chandigarh/driving-tests-chandigarh-applications-failed-passed-8965270/",
    "high",
    "About one in three applicants pass the automated track on the first try. Practise the layout.",
    "https://chdtransport.gov.in",
  ],
  [
    "DH",
    "Dadra and Nagar Haveli and Daman and Diu",
    "unknown",
    "https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do",
    "low",
    "unknown",
    "",
    "",
    "",
    "",
    "https://ddd.gov.in",
  ],
  [
    "LA",
    "Ladakh",
    "no",
    HT_SUSPEND,
    "medium",
    "unknown",
    "",
    "",
    "",
    "Ladakh has a single RTO for the UT.",
    "https://ladakh.gov.in",
  ],
  [
    "LD",
    "Lakshadweep",
    "no",
    HT_SUSPEND,
    "medium",
    "unknown",
    "",
    "",
    "",
    "",
    "https://lakshadweep.gov.in",
  ],
  [
    "PY",
    "Puducherry",
    "no",
    "https://transport.py.gov.in/Learner%27s%20Licence",
    "medium",
    "unknown",
    "",
    "",
    "",
    "The LL test is in the LLR room at the transport office: 10 questions, 6 correct to pass.",
    "https://transport.py.gov.in",
  ],
];

// LL test formats reported for the state: [questions, correct to pass, source, confidence].
const FORMAT = {
  GJ: [
    15,
    9,
    "https://deshgujarat.com/2025/07/07/how-to-get-learning-licence-without-visiting-rto-in-gujarat/",
    "medium",
  ],
  RJ: [
    20,
    12,
    "https://transport.rajasthan.gov.in/content/transportportal/en/transport/eservices/facelessservices.html",
    "medium",
  ],
  TS: [20, 12, "https://transport.telangana.gov.in/html/faq-llr.html", "high"],
  CG: [10, 6, "https://cgtransport.gov.in/WelcomeMassage.aspx", "low"],
  PY: [10, 6, "https://transport.py.gov.in/Learner%27s%20Licence", "medium"],
};

// Days before a failed LL test can be retaken, where the state reports it: [days, source, confidence].
const LL_RETEST = {
  GJ: [
    1,
    "https://deshgujarat.com/2025/07/07/how-to-get-learning-licence-without-visiting-rto-in-gujarat/",
    "medium",
  ],
  BR: [
    7,
    "https://www.prabhatkhabar.com/state/bihar/muzaffarpur/transport-department-changes-driving-license-rules-applicants-can-take-test-for-learning-license-from-anywhere",
    "medium",
  ],
  CH: [
    15,
    "https://timesofindia.indiatimes.com/city/chandigarh/getting-learners-licence-is-just-click-away-in-city/articleshow/102783688.cms",
    "medium",
  ],
};

// Second research pass (2026-10-25): fields replaced per state. Index matches the S row layout:
// 2 ll, 3 llUrl, 4 llConf, 5 dl, 6 dlDetail, 7 dlUrl, 8 dlConf, 9 note.
const UPDATES = {
  LA: {
    5: "automated",
    6: "automated driving test centres at Phyang (Leh) and Kargil",
    7: "https://www.reachladakh.com/news/social-news/automated-driving-test-centre-automated-testing-station-opened-at-phyang",
    8: "high",
    9: "Automated test centres opened at Phyang (Mar 2026) and Kargil (Jul 2026).",
  },
  PY: {
    5: "manual",
    6: "inspector test, result given on the spot",
    7: "https://transport.py.gov.in/d.l",
    8: "medium",
  },
  AN: {
    2: "no",
    3: "https://transport.and.nic.in/egov.html",
    4: "low",
    5: "manual",
    6: "inspector test on the department's test ground",
    7: "https://transport.and.nic.in/mvd_func1.html",
    8: "low",
    9: "The LL test runs on office computers; a failed LL or driving test can be retaken after 7 days.",
  },
  DH: {
    2: "yes",
    3: "https://sarathi.parivahan.gov.in/sarathiservice/sarathiHomePublic.do?stCd=DD",
    4: "medium",
    9: "Faceless transport services launched on 26 January 2024; Sarathi lists the online LL test.",
  },
  AP: {
    9: "Home LL test with a secure exam browser and live face match (from late Sept 2026); without Aadhaar, or after 5 failed face matches, the test is at the RTO. A failed LL test can be retaken after 7 days.",
  },
  TS: {
    9: "The LL test is in Telugu, Hindi or English: 20 questions, 12 correct to pass. A failed LL test can be retaken after 7 days.",
  },
};
for (const row of S) {
  const u = UPDATES[row[0]];
  if (u) for (const [i, v] of Object.entries(u)) row[Number(i)] = v;
}
LL_RETEST.AP = [7, "https://aptransport.org/html/faqs-licence.html", "high"];
LL_RETEST.TS = [7, "https://transport.telangana.gov.in/html/faq-license.html", "high"];
LL_RETEST.AN = [7, "https://transport.and.nic.in/faq.html", "high"];

const prov = (url, title, conf, grade) => ({
  source: { title, url },
  grade,
  checkedOn: CHECKED,
  confidence: conf,
  verified: false,
  approvers: [`maker:rules-agent@${CHECKED}`],
});

for (const [code, name, ll, llUrl, llConf, dl, dlDetail, dlUrl, dlConf, note, site] of S) {
  const lc = code.toLowerCase();
  const rules = [];
  const online = ll === "yes";
  const llText = {
    yes: {
      en: `In ${name} the LL test can be taken online at home with Aadhaar face authentication, or at the RTO.`,
      hi: `${name} में लर्नर लाइसेंस टेस्ट आधार फेस ऑथेंटिकेशन के साथ घर से ऑनलाइन, या RTO पर दिया जा सकता है।`,
    },
    no: {
      en: `In ${name} the LL test is taken at the RTO or transport office.`,
      hi: `${name} में लर्नर लाइसेंस टेस्ट RTO या परिवहन कार्यालय पर होता है।`,
    },
    unknown: {
      en: `We could not confirm a home LL test in ${name}, so plan for the test at the RTO. If Sarathi offers the online test for you, you can use it.`,
      hi: `${name} में घर से LL टेस्ट की पुष्टि नहीं हो पाई, इसलिए RTO पर टेस्ट की योजना बनाएँ। अगर सारथी पर ऑनलाइन टेस्ट दिखे, तो उसका उपयोग कर सकते हैं।`,
    },
  }[ll];
  rules.push({
    id: `${code}-PRM-LL-TEST-MODE`,
    kind: "param",
    overrides: "PRM-LL-TEST-MODE",
    textKey: `rule.${lc}.ll.test_mode`,
    condition: true,
    output: {
      value: { onlineAvailable: online, where: online ? ["home_online", "rto"] : ["rto"] },
    },
    text: llText,
    ...prov(
      llUrl,
      `${name}: learner's licence test mode`,
      llConf,
      ll === "unknown" ? "unknown" : "S",
    ),
  });
  const fmt = FORMAT[code];
  if (fmt) {
    const [q, p, url, conf] = fmt;
    rules.push({
      id: `${code}-PRM-LL-FORMAT`,
      kind: "param",
      overrides: "PRM-LL-FORMAT",
      textKey: `rule.${lc}.ll.format`,
      condition: true,
      output: {
        value: {
          known: true,
          questions: q,
          passCorrect: p,
          passPct: Math.round((p / q) * 100),
          timerSeconds: null,
        },
      },
      text: { en: `${name} LL test: {questions} questions, {passCorrect} correct to pass.` },
      ...prov(url, `${name}: learner's licence test format`, conf, "S"),
    });
  }
  const retest = LL_RETEST[code];
  if (retest) {
    const [days, url, conf] = retest;
    rules.push({
      id: `${code}-PRM-LL-RETEST-GAP-DAYS`,
      kind: "param",
      overrides: "PRM-LL-RETEST-GAP-DAYS",
      textKey: `rule.${lc}.ll.retest_gap_days`,
      condition: true,
      output: { value: days },
      text: {
        en: `In ${name}, a failed LL test can be retaken after {value} day(s), with the LL retest fee.`,
      },
      ...prov(url, `${name}: learner's licence retest gap`, conf, "S"),
    });
  }
  if (dl !== "unknown") {
    rules.push({
      id: `${code}-PRM-DL-TEST`,
      kind: "param",
      overrides: "PRM-DL-TEST",
      textKey: `rule.${lc}.dl.test_type`,
      condition: true,
      output: { value: { known: true, automated: dl === "automated", tracks: [dlDetail] } },
      text: {
        en:
          dl === "automated"
            ? `${name} driving tests run on automated tracks: ${dlDetail}.`
            : dl === "manual"
              ? `${name} driving tests are judged by an inspector: ${dlDetail}.`
              : `${name} uses both: ${dlDetail}.`,
      },
      ...prov(dlUrl, `${name}: driving test type`, dlConf, "S"),
    });
  }
  if (note) {
    rules.push({
      id: `${code}-NTC-STATE-NOTE`,
      kind: "notice",
      textKey: `notice.${lc}.state_note`,
      condition: true,
      output: {},
      text: { en: note },
      refs: ["F-12"],
      ...prov(site, `${name} transport department`, "medium", "S"),
    });
  }
  const pack = {
    $schema: "../schema/rulepack.schema.json",
    fileKind: "rulepack",
    packId: code,
    name: `${name} overlay (partial)`,
    version: "2026.10.0",
    extends: "IN-base@2026.10.0",
    effectiveFrom: "2026-10-23",
    status: "draft",
    partial: true,
    maker: "rules-agent",
    checker: null,
    approvedAt: null,
    notes: `Partial: central CMVR rules plus researched state overrides (checked ${CHECKED}). Verify at your RTO. Transport department: ${site}`,
    rules,
  };
  writeFileSync(join(root, `${code}.json`), `${JSON.stringify(pack, null, 2)}\n`);
}
process.stdout.write(`wrote ${S.length} state packs\n`);
