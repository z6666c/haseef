import type { Metadata } from "next";
import { PLATFORM_LEGAL } from "@haseef/shared";
import { LegalDoc } from "@/components/LegalDoc";

export const metadata: Metadata = { title: PLATFORM_LEGAL.terms.title };

export default function Page() {
  return <LegalDoc id="terms" />;
}
