import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white shadow-[0_8px_22px_#3169f533] hover:bg-[#2057df]",
        light: "bg-white text-[#1e4fc8]",
        ghost: "bg-transparent text-ink hover:bg-bg",
        danger: "bg-white text-red-600 border border-red-200",
        outline: "border border-line bg-white text-ink hover:bg-bg",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({ className, variant, asChild, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonStyles({ variant }), className)} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand", props.className)} />;
}

export function Label({ children, hint }: { children: string; hint?: string }) {
  return (
    <label className="block text-sm font-medium">
      {children}
      {hint ? <span className="ml-2 font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-line bg-white p-4 shadow-[0_10px_32px_#1d46800a] md:p-5", className)}>{children}</section>;
}

const tierStyle: Record<string, string> = {
  go: "bg-emerald-50 text-emerald-700",
  verify: "bg-amber-50 text-amber-800",
  reject: "bg-slate-100 text-slate-600",
};
const tierLabel: Record<string, string> = { go: "可推进", verify: "需核实", reject: "不建议" };

export function TierBadge({ tier }: { tier: string }) {
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", tierStyle[tier] || tierStyle.verify)}>{tierLabel[tier] || tier}</span>;
}

export function Banner({ tone = "info", children }: { tone?: "info" | "error" | "warn"; children: React.ReactNode }) {
  const map = { info: "bg-[#edf3ff] text-[#1e4fc8]", error: "bg-red-50 text-red-700", warn: "bg-amber-50 text-amber-800" };
  return <div className={cn("rounded-xl px-3 py-2 text-sm", map[tone])}>{children}</div>;
}
