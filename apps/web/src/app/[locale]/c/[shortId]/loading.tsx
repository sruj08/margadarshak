import { StateLoading } from "@/features/games/states";

export default function ShareCardLoading() {
  return (
    <main id="main" tabIndex={-1} className="md-main">
      <div className="md-page">
        <StateLoading />
      </div>
    </main>
  );
}
