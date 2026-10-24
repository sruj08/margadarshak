import { buttonClassName } from "@margdarshak/ui/components/button-class";
import type { BankItem, PracticeKey } from "@/features/learn/content/bank-types";
import { shuffledOptions } from "@/features/learn/variants";
import { submitLiteQuiz } from "./actions";

/**
 * Lite quiz (FRONTEND §9, EC-19): plain HTML radios in one form, server-rendered, no client
 * component. Online, the form posts to a Server Action and the server scores it. Offline, a tiny
 * inline script (below; no framework) scores the same practice set on the phone from the keys of
 * just these questions and shows the result in place, marked "counts for practice only". In review
 * mode each question also asks "How sure are you?" — answered before any feedback is shown.
 */

export interface LiteQuizText {
  submit: string;
  sure: string;
  conf50: string;
  conf75: string;
  conf100: string;
  sign: string;
  /** "{r} of {n} right." */
  score: string;
  passed: string;
  notYet: string;
  offlineNote: string;
}

export function LiteQuiz({
  items,
  answerKey,
  locale,
  kind,
  state,
  pass,
  text,
}: {
  items: BankItem[];
  answerKey: PracticeKey;
  locale: string;
  kind: "ll" | "review";
  state: string;
  pass: number | null;
  text: LiteQuizText;
}) {
  const keys: Record<string, string> = {};
  for (const it of items) {
    const k = answerKey[it.id];
    if (k) keys[it.id] = k.correct;
  }
  return (
    <>
      <form method="post" action={submitLiteQuiz} id="lite-quiz" className="md-stack">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="nonce" value="" />
        {items.map((it, i) => (
          <fieldset key={it.id} className="ml-card" style={{ border: 0 }}>
            <input type="hidden" name="q" value={it.id} />
            <legend className="font-semibold">
              {i + 1}. {it.stem}
            </legend>
            {it.visuals.map((v) => (
              <p key={v.id} className="ml-small">
                {text.sign}: {v.alt}
              </p>
            ))}
            {shuffledOptions(it, `${state}:${kind}`).map((o) => (
              <label key={o.id} className="ml-opt">
                <input type="radio" name={`a:${it.id}`} value={o.id} />
                <span>{o.text}</span>
              </label>
            ))}
            {kind === "review" ? (
              <fieldset className="ml-conf" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ml-small">{text.sure}</legend>
                {(["50", "75", "100"] as const).map((c) => (
                  <label key={c} className="ml-opt">
                    <input type="radio" name={`c:${it.id}`} value={c} />
                    <span>{text[`conf${c}`]}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </fieldset>
        ))}
        <button
          type="submit"
          className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
        >
          {text.submit}
        </button>
      </form>
      <output
        id="lite-out"
        aria-live="polite"
        className="ml-feedback"
        data-score={text.score}
        data-passed={text.passed}
        data-not={text.notYet}
        data-note={text.offlineNote}
        data-pass={pass ?? ""}
        style={{ display: "none" }}
        data-testid="lite-out"
      />
      <script
        type="application/json"
        id="lite-key"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON of option letters, escaped below
        dangerouslySetInnerHTML={{ __html: JSON.stringify(keys).replace(/</g, "\\u003c") }}
      />
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a static, framework-free offline scorer (FRONTEND §9)
        dangerouslySetInnerHTML={{ __html: LITE_SCRIPT }}
      />
    </>
  );
}

/** ~1 KB, no dependencies: nonce for idempotency, offline scoring, and the service worker. */
export const LITE_SCRIPT = `(function(){var f=document.getElementById("lite-quiz");if(!f)return;try{f.nonce.value=crypto.randomUUID()}catch(x){}
window.addEventListener("submit",function(e){if(e.target!==f||navigator.onLine!==false)return;e.preventDefault();e.stopPropagation();
var k=JSON.parse(document.getElementById("lite-key").textContent||"{}"),q=f.querySelectorAll('input[name="q"]'),r=0,n=q.length;
for(var i=0;i<n;i++){var id=q[i].value,c=f.querySelector('input[name="a:'+id+'"]:checked');if(c&&k[id]===c.value)r++}
var o=document.getElementById("lite-out"),d=o.dataset,p=d.pass?+d.pass:0,t=d.score.replace("{r}",r).replace("{n}",n);
if(p)t+=" "+(r>=p?d.passed:d.not).replace("{p}",p);o.textContent=t+" "+d.note;o.style.display="block";o.focus&&o.scrollIntoView();
try{localStorage.setItem("md.lite.last",JSON.stringify({at:Date.now(),right:r,total:n,kind:f.kind.value,practice:true}))}catch(x){}},true);
if("serviceWorker"in navigator&&location.protocol==="https:")navigator.serviceWorker.register("/serwist/sw.js",{scope:"/"}).catch(function(){});})();`;
