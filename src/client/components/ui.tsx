import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn";
import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const buttonStyles = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[11px] px-4 py-2.5 text-sm font-bold transition duration-200 hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:shadow-none",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white shadow-[0_8px_22px_#3169f533] hover:bg-[#2057df] hover:text-white disabled:bg-[#d9e4fb] disabled:text-[#1e3a6d] disabled:hover:bg-[#d9e4fb] disabled:hover:text-[#1e3a6d]",
        light: "bg-white text-navy shadow-none hover:bg-[#f3f7ff] hover:text-navy disabled:bg-[#f3f6fb] disabled:text-[#3e4e68] disabled:hover:bg-[#f3f6fb] disabled:hover:text-[#3e4e68]",
        ghost: "bg-transparent text-ink shadow-none hover:bg-[#edf3ff] hover:text-ink disabled:text-[#3e4e68] disabled:hover:bg-transparent disabled:hover:text-[#3e4e68]",
        danger: "border border-red-200 bg-white text-[#7f1d1d] shadow-none hover:bg-red-50 hover:text-[#7f1d1d] disabled:bg-white disabled:text-[#7f1d1d] disabled:hover:bg-white disabled:hover:text-[#7f1d1d]",
        outline: "border border-line bg-white text-ink shadow-none hover:border-[#1e4fc8] hover:text-[#1e4fc8] disabled:bg-white disabled:text-[#3e4e68] disabled:hover:bg-white disabled:hover:text-[#3e4e68]",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({ className, variant, asChild, type, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonStyles({ variant }), className)} type={asChild ? undefined : type ?? "button"} {...props} />;
}

export const fieldClass = "w-full rounded-[11px] border border-[#d8e1ef] bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-[#526987] focus:border-brand focus:ring-2 focus:ring-[#a8c1ff] disabled:bg-[#f3f6fb] disabled:text-[#3e4e68]";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClass, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldClass, "min-h-24", props.className)} />;
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
  return <section className={cn("rounded-[18px] border border-line bg-white p-4 shadow-[0_10px_32px_#1d46800a] md:p-5", className)}>{children}</section>;
}

export function PageHeader({ kicker, title, description }: { kicker?: string; title: string; description?: string }) {
  return (
    <header className="mb-4">
      {kicker ? <p className="text-[13px] font-extrabold tracking-[0.18em] text-[#1e4fc8]">{kicker}</p> : null}
      <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-navy">{title}</h1>
      {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
    </header>
  );
}

export function StatCard({ label, value, active, onClick, testId }: { label: string; value: number | string; active?: boolean; onClick?: () => void; testId?: string }) {
  const className = cn(
    "rounded-[18px] border bg-white p-4 text-left shadow-[0_10px_32px_#1d46800a] transition",
    active ? "border-brand ring-2 ring-[#3169f533]" : "border-line hover:border-[#b9ccf5]",
  );
  const body = (
    <>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 text-3xl font-extrabold tracking-tight text-[#255de4]">{value}</p>
    </>
  );
  if (onClick) return <button type="button" data-testid={testId} onClick={onClick} className={className}>{body}</button>;
  return <div className={className} data-testid={testId}>{body}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-dashed border-[#d0dcf6] bg-[#f7f9ff] px-4 py-10 text-center">
      <p className="font-semibold text-navy">{title}</p>
      {children ? <p className="mt-1 text-sm text-muted">{children}</p> : null}
    </div>
  );
}

const logoFile = {
  32: { webp: "/brand/logo-64.webp", png: "/brand/logo-64.png" },
  36: { webp: "/brand/logo-72.webp", png: "/brand/logo-72.png" },
  40: { webp: "/brand/logo-80.webp", png: "/brand/logo-80.png" },
} as const;

export function BrandMark({ size = 36 }: { size?: keyof typeof logoFile }) {
  const file = logoFile[size];
  const width = Math.round(size * 1.0685);
  return (
    <picture>
      <source srcSet={file.webp} type="image/webp" />
      <img src={file.png} alt="" width={width} height={size} decoding="async" className="block shrink-0" style={{ height: size, width: "auto" }} />
    </picture>
  );
}

const tierStyle: Record<string, string> = {
  go: "bg-[#e5f8f5] text-[#0d6a56]",
  verify: "bg-[#fff4df] text-[#6a3d00]",
  reject: "bg-[#f1f5fd] text-[#3e4e68]",
};
const tierLabel: Record<string, string> = { go: "可推进", verify: "需核实", reject: "不建议" };

export function TierBadge({ tier }: { tier: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold", tierStyle[tier] || tierStyle.verify)}>{tierLabel[tier] || tier}</span>;
}

export function Banner({ tone = "info", children }: { tone?: "info" | "error" | "warn"; children: React.ReactNode }) {
  const map = { info: "bg-[#edf3ff] text-[#1e4fc8]", error: "bg-red-50 text-red-700", warn: "bg-amber-50 text-amber-800" };
  return <div className={cn("rounded-xl px-3 py-2 text-sm", map[tone])}>{children}</div>;
}
