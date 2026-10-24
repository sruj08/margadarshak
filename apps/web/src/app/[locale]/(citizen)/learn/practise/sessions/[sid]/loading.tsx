import { StateLoading } from "@/features/games/states";

/** Loading state for the debrief and replay routes (server render in flight). */
export default function SessionLoading() {
  return (
    <div className="md-page">
      <StateLoading />
    </div>
  );
}
