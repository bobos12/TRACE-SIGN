import { type LucideIcon, AtSign, CalendarDays, CaseSensitive, Signature, SquareCheck, TextCursorInput, User } from "lucide-react";
import type { FieldType } from "@/lib/geometry";

export const FIELD_ICON: Record<FieldType, LucideIcon> = {
  signature: Signature,
  initials: CaseSensitive,
  name: User,
  date: CalendarDays,
  text: TextCursorInput,
  email: AtSign,
  checkbox: SquareCheck,
};

export const FIELD_HINT: Record<FieldType, string> = {
  signature: "Signer draws, types or uploads their signature",
  initials: "Signer adds their initials",
  name: "Filled with the signer's full name (editable)",
  date: "Set automatically to the date they sign",
  text: "Free text the signer types",
  email: "Signer's email address",
  checkbox: "A box the signer ticks",
};

/** Font size for a field's label/value given its on-screen height. */
export function fieldFontPx(hPx: number, base?: number) {
  return Math.max(8, Math.min(base ?? 13, hPx * 0.44));
}
