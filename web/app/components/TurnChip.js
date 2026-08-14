import { describeTurn } from "@/lib/turn";

export default function TurnChip({ turn }) {
  const { label } = describeTurn(turn);
  return <div className="turn-chip">{label}</div>;
}
