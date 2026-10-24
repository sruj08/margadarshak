// A comment saying "Hurry, only 2 slots left" and <Countdown endsAt={x} /> must be ignored.
export function Seeded({ endsAt }: { endsAt: string }) {
  return (
    <form>
      <Countdown endsAt={endsAt} />
      <ShareGate requiresShare onDone={() => undefined} />
      <Checkbox name="consent-ai" defaultSelected>
        Use AI for my debrief
      </Checkbox>
      <input type="checkbox" name="consent-sms" defaultChecked />
      <a href="https://example.org/margdarshak.apk">Get the app</a>
    </form>
  );
}
