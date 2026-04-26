import type { Metadata } from "next";
import { AiVideoDemoClient } from "./demo-client";

export const metadata: Metadata = {
  title: "Aivora AI Video Demo",
  description:
    "Aivora demo: turn real footage, advisor voice, and a digital human avatar into client-ready videos.",
};

export default function AiVideoDemoPage() {
  return <AiVideoDemoClient />;
}
