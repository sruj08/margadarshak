"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { Card } from "@margdarshak/ui/components/card";
import { Chip } from "@margdarshak/ui/components/chip";
import { DateField } from "@margdarshak/ui/components/date-field";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { LanguagePicker } from "@margdarshak/ui/components/language-picker";
import { PictureCardGroup } from "@margdarshak/ui/components/picture-card";
import { ProgressBar, Stepper } from "@margdarshak/ui/components/progress";
import { QuestionScreen } from "@margdarshak/ui/components/question-screen";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { SimulatedChip } from "@margdarshak/ui/components/simulated-chip";
import { Skeleton, SkeletonText } from "@margdarshak/ui/components/skeleton";
import { SourceChip } from "@margdarshak/ui/components/source-chip";
import { StatusGlyph, type StatusKind } from "@margdarshak/ui/components/status-glyph";
import { notify } from "@margdarshak/ui/components/toast";
import { VerbTile } from "@margdarshak/ui/components/verb-tile";
import { Bike, Car, GraduationCap, Scooter } from "lucide-react";
import { useState } from "react";

interface Copy {
  simulatedChip: string;
  simulatedSarathi: string;
  simulatedDigilocker: string;
  sourceHeading: string;
  sourceConfidence: string;
  sourceOpen: string;
  newTab: string;
  offline: string;
  emptyTitle: string;
  emptyLine: string;
  emptyCta: string;
  statusDone: string;
  statusNow: string;
  statusLater: string;
  close: string;
  settingsTitle: string;
  clearHint: string;
}

const SWATCHES = [
  "bg",
  "surface",
  "surface-2",
  "ink",
  "ink-2",
  "ink-3",
  "primary-fill",
  "primary-soft",
  "amber",
  "ember",
  "success",
  "warning-ink",
  "danger",
  "info",
  "border-strong",
  "road",
] as const;

const GLYPHS: StatusKind[] = ["done", "now", "later", "caution", "danger", "info", "simulated"];

/** Developer-facing page: section headings are English on purpose; user copy comes from messages. */
export function Workshop({ locale, copy }: { locale: string; copy: Copy }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lang, setLang] = useState<string>(locale);
  const [skin, setSkin] = useState<"default" | "ux4g">("default");

  return (
    <div className="md-workshop">
      <header className="md-stack">
        <h1 className="md-h1">Component workshop</h1>
        <p className="md-lead">
          @margdarshak/ui on HeroUI v3 and the Margdarshak tokens. Switch theme, contrast and motion
          in Settings, and the language in the top bar. axe runs on this page in CI.
        </p>
        <div className="md-workshop__row">
          <Button
            variant="secondary"
            onPress={() => {
              const next = skin === "default" ? "ux4g" : "default";
              setSkin(next);
              if (next === "ux4g") document.documentElement.setAttribute("data-skin", "ux4g");
              else document.documentElement.removeAttribute("data-skin");
            }}
          >
            {skin === "default" ? "Preview UX4G skin" : "Back to default skin"}
          </Button>
        </div>
      </header>

      <section className="md-workshop__section" aria-labelledby="ws-tokens">
        <h2 id="ws-tokens" className="md-h2">
          Colour tokens
        </h2>
        <div className="md-swatches">
          {SWATCHES.map((s) => (
            <div key={s} className="md-swatch">
              <span className="md-swatch__chip" style={{ background: `var(--md-${s})` }} />
              <code>--md-{s}</code>
            </div>
          ))}
        </div>
        <div className="md-workshop__row">
          {GLYPHS.map((g) => (
            <span key={g} className="md-workshop__row">
              <StatusGlyph kind={g} size={24} />
              <span>{g}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-type">
        <h2 id="ws-type" className="md-h2">
          Typography and scripts
        </h2>
        <p className="md-display">Get your driving licence, step by step.</p>
        <p lang="hi" className="md-h2">
          ड्राइविंग लाइसेंस, एक-एक कदम करके।
        </p>
        <p lang="en">
          Your learner's licence expires on 14 March 2027. Book your driving test by 10 February.
        </p>
        <p lang="hi">आपका लर्नर लाइसेंस 14 मार्च 2027 को समाप्त होगा। ड्राइविंग टेस्ट 10 फ़रवरी तक बुक करें।</p>
        <p lang="hi">क्षेत्रीय परिवहन कार्यालय · द्वितीय · श्रृंखला · ज़िम्मेदारी</p>
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-buttons">
        <h2 id="ws-buttons" className="md-h2">
          Buttons
        </h2>
        <div className="md-workshop__row">
          <Button variant="primary" size="lg" onPress={() => notify("Saved on this phone")}>
            Show a toast
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="danger">Delete account</Button>
          <Button variant="secondary" isPending>
            Checking
          </Button>
        </div>
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-chips">
        <h2 id="ws-chips" className="md-h2">
          Chips, source chips and simulated chips
        </h2>
        <div className="md-workshop__row">
          <Chip>Neutral</Chip>
          <Chip tone="primary">Selected</Chip>
          <Chip tone="success">{copy.statusDone}</Chip>
          <Chip tone="caution">Check</Chip>
          <Chip tone="danger">Fix this</Chip>
          <Chip tone="info">Why we ask</Chip>
          <Chip tone="simulated">{copy.simulatedChip}</Chip>
        </div>
        <div className="md-workshop__row">
          <SourceChip
            source="CMVR r.32"
            checked="checked 22 Oct 2026"
            sourceTitle="CMVR 1989 r.32 (revised fee table)"
            sourceUrl="https://himachal.gov.in/WriteReadData/l892s/3_l892s/rule32_cmvr-40224160.pdf"
            confidence="Likely"
            labels={{
              heading: copy.sourceHeading,
              confidenceLabel: copy.sourceConfidence,
              openSource: copy.sourceOpen,
              newTab: copy.newTab,
            }}
          />
          <SimulatedChip
            adapterMode="mock"
            label={copy.simulatedChip}
            detail={copy.simulatedSarathi}
          />
          <SimulatedChip
            adapterMode="mock"
            label={copy.simulatedChip}
            detail={copy.simulatedDigilocker}
          />
          <SimulatedChip
            adapterMode="nic"
            label={copy.simulatedChip}
            detail={copy.simulatedSarathi}
          />
        </div>
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-banners">
        <h2 id="ws-banners" className="md-h2">
          Banners
        </h2>
        <div className="md-workshop__grid">
          <Banner tone="info" title="Why we ask for your date of birth">
            It decides which licence classes you can apply for.
          </Banner>
          <Banner tone="caution" title="Your LL expires in 28 days">
            Book your driving test before it expires to keep this application.
          </Banner>
          <Banner tone="success" title="Plan saved">
            You can come back to it from My Licence.
          </Banner>
          <Banner tone="danger" title="There's a problem" role="note">
            Enter a date of birth in the past.
          </Banner>
          <Banner tone="offline" title={copy.offline} />
          <Banner tone="simulated" title={copy.simulatedChip} role="note">
            {copy.simulatedSarathi}
          </Banner>
        </div>
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-cards">
        <h2 id="ws-cards" className="md-h2">
          Cards and verb tiles
        </h2>
        <div className="md-tiles">
          <VerbTile
            href="#ws-cards"
            icon={<Scooter />}
            title="Get my first licence"
            line="LL to DL"
          />
          <VerbTile
            href="#ws-cards"
            icon={<GraduationCap />}
            title="Practise for the test"
            line="Free mock tests"
            highlight
          />
        </div>
        <Card>
          <Card.Header>
            <Card.Title>Learner's licence</Card.Title>
            <Card.Description>Two-wheeler with gear (MCWG)</Card.Description>
          </Card.Header>
          <Card.Content>
            <p>Card body uses the hairline elevation, radius 16.</p>
          </Card.Content>
        </Card>
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-steps">
        <h2 id="ws-steps" className="md-h2">
          Stepper and progress
        </h2>
        <Stepper
          label="Your licence journey"
          statusLabels={{ done: copy.statusDone, now: copy.statusNow, later: copy.statusLater }}
          steps={[
            { id: "ll", label: "Learner's licence", status: "done", meta: "14 Sep 2026" },
            { id: "hazard", label: "Hazard practice (Nazar)", status: "now" },
            { id: "track", label: "Track test", status: "later" },
            { id: "dl", label: "Driving licence", status: "later" },
          ]}
        />
        <ProgressBar label="Question 2 of 6" value={2} max={6} />
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-question">
        <h2 id="ws-question" className="md-h2">
          Question screen, date field and picture cards
        </h2>
        <QuestionScreen
          screenId="SCR-031"
          question="What is your date of birth?"
          hint="As it appears on your age proof."
          progress={<ProgressBar label="Question 1 of 3" value={1} max={3} />}
          whyWeAsk={{
            label: "Why we ask",
            body: "Your age decides which licence classes you can apply for today.",
          }}
          primaryAction={
            <Button variant="primary" size="lg" type="submit">
              Continue
            </Button>
          }
          autosaveNote="Saved on this phone as you type."
        >
          <DateField label="Date of birth" description="For example, 14 08 2007" />
          <PictureCardGroup
            label="What will you drive?"
            description="Choose all that apply."
            selectionMode="multiple"
            options={[
              {
                id: "MCWOG",
                label: "Scooter",
                caption: "Gearless (MCWOG)",
                picture: <Scooter size={40} />,
              },
              {
                id: "MCWG",
                label: "Motorcycle",
                caption: "With gear (MCWG)",
                picture: <Bike size={40} />,
              },
              { id: "LMV", label: "Car", caption: "LMV", picture: <Car size={40} /> },
            ]}
          />
        </QuestionScreen>
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-lang">
        <h2 id="ws-lang" className="md-h2">
          Language picker
        </h2>
        <LanguagePicker
          labelledBy="ws-lang"
          value={lang}
          onChange={setLang}
          variant="settings"
          options={[
            { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", lang: "hi" },
            { code: "en", nativeName: "English", lang: "en" },
          ]}
        />
      </section>

      <section className="md-workshop__section" aria-labelledby="ws-states">
        <h2 id="ws-states" className="md-h2">
          Empty, loading and sheet
        </h2>
        <EmptyState
          as="h3"
          title={copy.emptyTitle}
          line={copy.emptyLine}
          action={<Button variant="primary">{copy.emptyCta}</Button>}
        />
        <div aria-busy="true" className="md-workshop__grid">
          <Skeleton className="h-28" />
          <SkeletonText lines={3} />
        </div>
        <div className="md-workshop__row">
          <Button variant="secondary" onPress={() => setSheetOpen(true)}>
            Open a sheet
          </Button>
        </div>
        <Sheet
          isOpen={sheetOpen}
          onOpenChange={setSheetOpen}
          title={copy.settingsTitle}
          description={copy.clearHint}
          closeLabel={copy.close}
          footer={
            <Button variant="primary" size="lg" slot="close">
              OK
            </Button>
          }
        >
          <p>Sheets rise from the bottom, trap focus, and always have a Close button.</p>
        </Sheet>
      </section>
    </div>
  );
}
