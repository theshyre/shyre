import { redirect } from "next/navigation";

export default function TimerPage(): never {
  redirect("/time-entries");
}
