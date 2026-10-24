// Compliant counterparts: a sourced countdown, an unticked consent box, neutral decline copy.
export function Clean({ llExpiry, agreed }: { llExpiry: string; agreed: boolean }) {
  const items: Array<string> = [];
  return (
    <form>
      <Countdown endsAt={llExpiry} sourceRuleId="JK-LL-VALIDITY" />
      <Checkbox name="consent-ai" isSelected={agreed}>
        Use AI for my debrief
      </Checkbox>
      <Switch name="reduced-motion" defaultSelected={false} />
      <input type="checkbox" name="consent-sms" />
      <button type="button">Not now</button>
      <a href="https://margdarshak.example/share/abc">Open the share card</a>
      {items.length}
    </form>
  );
}
