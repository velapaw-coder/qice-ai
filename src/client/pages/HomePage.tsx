import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { APK_DOWNLOAD_URL } from "@shared/apkLink";
import {
  APK_HINT,
  APK_TITLE,
  BRAND_EN,
  BRAND_MISSION,
  BRAND_NAME,
  BRAND_POSITIONING,
  BRAND_PROPOSITION,
  BRAND_SIGNATURE,
  BRAND_TAGLINE,
  BRAND_VISION,
  ENABLEMENT_NOTE,
  HERO_LEAD,
  METHOD_NOTE,
  NARRATIVE,
  PUBLIC_SITE,
  VISION_NOTE,
  CLOSING_TEXT,
  CLOSING_TITLE,
  COMPANY_NAME,
  CONSENT_TEXT,
  CONTACT_LINE,
  FEE_PARAS,
  FIT_PARAS,
  FREE_NOTE,
  PILOT_CLOSE,
  PILOT_INTRO,
  PILOT_STATUS,
  PILOT_TITLE,
  POLICY_LINK_LABEL,
  POLICY_LINK_NOTE,
  POLICY_PARAS,
  VALUE_PROPOSITION,
  faqs,
  methods,
  pilotRows,
  steps,
} from "@shared/growthHome";
import { GROWTH_INTENTS, GROWTH_PAINS, parseGrowthLead, type GrowthIntent } from "@shared/growthLead";
import { ApiError, api } from "../lib/api";
import { cn } from "../lib/cn";
import { Banner, BrandMark, Button } from "../components/ui";

const fieldClass =
  "w-full rounded-[11px] border border-[#d8e1ef] bg-white px-3 py-3 text-base text-[#182642] outline-none placeholder:text-[#526987] focus:border-[#1e4fc8] focus:ring-2 focus:ring-[#a8c1ff] disabled:bg-[#f3f6fb] disabled:text-[#3e4e68]";

const nav = [
  { href: "#value", label: "品牌叙事" },
  { href: "#services", label: "核心方法" },
  { href: "#pilot", label: "适用场景" },
  { href: "#process", label: "合作步骤" },
  { href: "#policy", label: "政策辅助" },
  { href: "#faq", label: "常见问题" },
];

function Section({
  id,
  soft,
  kicker,
  title,
  intro,
  children,
}: {
  id: string;
  soft?: boolean;
  kicker: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={soft ? "bg-[#f5f8fe]" : "bg-white"}>
      <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <div className="max-w-3xl">
          <p className="text-[13px] font-extrabold tracking-[0.16em] text-[#1e4fc8]">{kicker}</p>
          <h2 className="mt-3 text-[1.7rem] font-extrabold leading-tight tracking-tight text-[#0c1832] md:text-4xl">{title}</h2>
          {intro ? <p className="mt-4 text-base leading-7 text-[#526987]">{intro}</p> : null}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

export function HomePage() {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<GrowthIntent>("growth_talk");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; duplicate: boolean } | null>(null);
  const [workspace, setWorkspace] = useState("");
  const lock = useRef(false);

  useEffect(() => {
    api<{ user: { role: string } }>("/api/me")
      .then((me) => setWorkspace(me.user.role === "enterprise" ? "/app" : "/admin"))
      .catch(() => setWorkspace(""));
  }, []);

  function choose(next: GrowthIntent) {
    setIntent(next);
    setOpen(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = new FormData(event.currentTarget);
    const parsed = parseGrowthLead({
      company_name: String(form.get("company_name") || ""),
      contact_name: String(form.get("contact_name") || ""),
      phone: String(form.get("phone") || ""),
      industry: String(form.get("industry") || ""),
      pain: String(form.get("pain") || ""),
      intent,
      consent: agreed,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      setResult(null);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await api<{ id?: string; duplicate?: boolean }>("/api/growth-leads", {
        method: "POST",
        body: JSON.stringify({ ...parsed.value, consent: true, company_website: String(form.get("company_website") || "") }),
      });
      if (saved.duplicate) {
        setResult({ id: "", duplicate: true });
      } else if (!saved.id) {
        throw new Error("提交没有保存，请稍后再试");
      } else {
        setResult({ id: saved.id, duplicate: false });
      }
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "提交没有保存，请检查网络后再试");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="bg-white text-[#182642]">
      <header className="sticky top-0 z-30 border-b border-[#e4eaf4] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
          <a href="/" className="flex min-w-0 items-center gap-2 text-lg font-extrabold tracking-tight text-[#0c1832]">
            <BrandMark size={36} />
            <span className="truncate">{BRAND_NAME}</span>
          </a>
          <nav aria-label="页面导航" className="ml-6 hidden items-center gap-5 text-sm font-semibold text-[#526987] lg:flex">
            {nav.map((item) => (
              <a key={item.href} href={item.href} className="hover:text-[#1e4fc8]">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {workspace ? (
              <Link to={workspace} className="hidden text-sm font-bold text-[#1e4fc8] sm:inline" data-testid="home-workspace">
                进入工作台
              </Link>
            ) : null}
            <Link to="/login" className="hidden text-sm font-bold text-[#465675] hover:text-[#1e4fc8] sm:inline" data-testid="home-login">
              客户登录
            </Link>
            <a href="#contact" onClick={() => choose("growth_talk")} className="hidden rounded-[11px] bg-[#1e4fc8] px-3 py-2 text-sm font-bold text-white sm:inline-flex">
              预约增长交流
            </a>
            <button type="button" className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf3ff] text-xl text-[#1e4fc8] lg:hidden" data-testid="home-menu" aria-label="打开菜单" onClick={() => setOpen(true)}>
              ☰
            </button>
          </div>
        </div>
      </header>
      {open ? <button type="button" className="fixed inset-0 z-40 bg-[#071126b8]" aria-label="关闭菜单遮罩" onClick={() => setOpen(false)} /> : null}
      <nav
        aria-label="移动端菜单"
        data-testid="home-drawer"
        className={cn("fixed bottom-0 left-0 top-0 z-50 w-[min(20rem,86vw)] flex-col gap-4 overflow-y-auto bg-[#0c1832] px-6 py-6 text-white", open ? "flex" : "hidden")}
      >
        <button type="button" className="self-end text-3xl leading-none text-white" data-testid="home-menu-close" aria-label="关闭菜单" onClick={() => setOpen(false)}>
          ×
        </button>
        {nav.map((item) => (
          <a key={item.href} href={item.href} className="text-base font-bold text-white" onClick={() => setOpen(false)}>
            {item.label}
          </a>
        ))}
        <Link to="/login" className="text-base font-bold text-white" data-testid="home-login-drawer" onClick={() => setOpen(false)}>
          客户登录
        </Link>
        {workspace ? (
          <Link to={workspace} className="text-base font-bold text-white" onClick={() => setOpen(false)}>
            进入工作台
          </Link>
        ) : null}
        <a href="#contact" className="mt-2 inline-flex justify-center rounded-[11px] bg-white px-4 py-3 font-bold text-[#0c1832]" onClick={() => choose("growth_talk")}>
          预约增长交流
        </a>
      </nav>

      <main>
        <div className="bg-[#0c1936] text-white">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-10 md:gap-10 md:px-6 md:py-20 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="text-sm font-semibold tracking-[0.14em] text-[#b9d5ff]">{BRAND_EN}</p>
              <h1 className="mt-3 text-[2rem] font-extrabold leading-[1.15] tracking-tight md:text-6xl">{BRAND_NAME}</h1>
              <p className="mt-3 max-w-xl text-base font-semibold leading-7 text-white md:text-2xl" data-testid="brand-positioning">{BRAND_POSITIONING}</p>
              <p className="mt-3 max-w-xl text-xl font-extrabold leading-snug tracking-tight text-[#d5e2f7] md:text-3xl" data-testid="brand-line">{BRAND_PROPOSITION}</p>
              <p className="mt-4 max-w-xl text-base leading-7 text-[#d5e2f7]" data-testid="hero-lead">{HERO_LEAD}</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="w-full bg-[#1e4fc8] px-5 py-3 hover:bg-[#1e4fc8] sm:w-auto">
                  <a href="#contact" data-testid="home-primary" onClick={() => choose("growth_talk")}>预约增长交流</a>
                </Button>
                <a href="#contact" data-testid="home-secondary" onClick={() => choose("scene_trial")} className="inline-flex w-full items-center justify-center rounded-[11px] border border-[#c3d0e7] px-5 py-3 text-sm font-bold text-white hover:bg-white/10 sm:w-auto">
                  申请AI场景体验
                </a>
              </div>
              <p className="mt-4 text-sm leading-6 text-[#c3d0e7]">不创建账号，不收取税表或社保资料。已有账号可直接 <Link className="font-bold text-white underline" to="/login">客户登录</Link>。</p>
              <a data-testid="android-download" href={APK_DOWNLOAD_URL} className="mt-6 flex max-w-xl items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left text-[#0c1832]">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#edf3ff] text-xs font-extrabold text-[#1e4fc8]">安卓</span>
                <span>
                  <span className="block font-bold">{APK_TITLE}</span>
                  <span className="mt-1 block text-xs leading-5 text-[#526987]">{APK_HINT}</span>
                </span>
              </a>
            </div>
            <aside className="rounded-3xl border border-white/15 bg-white p-6 text-[#182642] md:p-8" aria-label="品牌使命、愿景与主张">
              <div className="space-y-6">
                <div>
                  <h2 className="text-sm font-extrabold text-[#1e4fc8]">品牌使命</h2>
                  <p className="mt-2 text-base leading-7">{BRAND_MISSION}</p>
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-[#1e4fc8]">品牌愿景</h2>
                  <p className="mt-2 text-base leading-7">{BRAND_VISION}</p>
                  <p className="mt-2 text-sm leading-6 text-[#526987]">{VISION_NOTE}</p>
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-[#1e4fc8]">特色赋能</h2>
                  <p className="mt-2 text-base leading-7">AI能力支持 + 政策红利挖掘</p>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <Section id="value" soft kicker="品牌叙事" title="发现下一门生意" intro={NARRATIVE[1]}>
          <div className="max-w-3xl space-y-4">
            {NARRATIVE.slice(2).map((item) => (
              <p key={item} className="text-base leading-7 text-[#526987]">{item}</p>
            ))}
            <p className="text-base font-semibold leading-7 text-[#0c1832]">{BRAND_SIGNATURE}</p>
          </div>
        </Section>

        <Section id="services" kicker="核心方法" title="六个环节，用来一起规划和陪跑" intro={METHOD_NOTE}>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {methods.map((item, index) => (
              <article key={item.title} className="rounded-2xl border border-[#e4eaf4] bg-white p-6">
                <p className="text-sm font-extrabold text-[#1e4fc8]">0{index + 1}</p>
                <h3 className="mt-2 text-lg font-extrabold text-[#0c1832]">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#526987]">{item.text}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="pilot" soft kicker="适用场景" title={PILOT_TITLE} intro={PILOT_INTRO}>
          <p className="mb-4 inline-flex rounded-full bg-[#edf3ff] px-3 py-1 text-sm font-bold text-[#1e4fc8]">{PILOT_STATUS}</p>
          <div className="overflow-hidden rounded-2xl border border-[#e4eaf4] bg-white">
            {pilotRows.map((row) => (
              <div key={row.label} className="grid gap-1 border-b border-[#e4eaf4] px-5 py-5 last:border-b-0 md:grid-cols-[7.5rem_1fr] md:gap-6">
                <h3 className="text-sm font-extrabold text-[#0c1832]">{row.label}</h3>
                <p className="text-sm leading-6 text-[#526987]">{row.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-sm leading-6 text-[#526987]">{PILOT_CLOSE}</p>
        </Section>

        <Section id="process" kicker="合作步骤" title="从一次交流到是否继续" intro="每一步都先确认范围。体验结束之后，由企业自己决定要不要付费实施。">
          <ol className="max-w-3xl divide-y divide-[#e4eaf4] rounded-2xl border border-[#e4eaf4] bg-white">
            {steps.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[auto_1fr] gap-4 px-5 py-5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#edf3ff] text-sm font-extrabold text-[#1e4fc8]">{index + 1}</span>
                <div>
                  <h3 className="font-extrabold text-[#0c1832]">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#526987]">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-3xl text-sm leading-6 text-[#526987]">{FREE_NOTE}</p>
        </Section>

        <Section id="policy" soft kicker="特色赋能" title="AI能力支持，政策红利挖掘" intro={ENABLEMENT_NOTE}>
          <div className="max-w-3xl space-y-4">
            {POLICY_PARAS.map((item) => (
              <p key={item} className="text-base leading-7 text-[#526987]">{item}</p>
            ))}
          </div>
          <div className="mt-8 max-w-3xl rounded-2xl border border-[#e4eaf4] bg-white p-6">
            <h3 className="font-extrabold text-[#0c1832]">已有政策服务需求</h3>
            <p className="mt-2 text-sm leading-6 text-[#526987]">{POLICY_LINK_NOTE}</p>
            <Link to="/register" data-testid="policy-entry" className="mt-4 inline-flex font-bold text-[#1e4fc8]">
              {POLICY_LINK_LABEL}
            </Link>
          </div>
        </Section>

        <Section id="fees" kicker="合作收费" title="实施费和持续服务费写在合同里">
          <div className="max-w-3xl space-y-4">
            {FEE_PARAS.map((item) => (
              <p key={item} className="text-base leading-7 text-[#526987]">{item}</p>
            ))}
          </div>
        </Section>

        <Section id="fit" soft kicker="适合对象" title="有具体问题、资料和对接人的企业">
          <div className="max-w-3xl space-y-4">
            {FIT_PARAS.map((item) => (
              <p key={item} className="text-base leading-7 text-[#526987]">{item}</p>
            ))}
          </div>
        </Section>

        <Section id="faq" kicker="常见问题" title="先把范围说清楚">
          <div className="max-w-3xl divide-y divide-[#e4eaf4] border-y border-[#e4eaf4]">
            {faqs.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="cursor-pointer list-none font-bold text-[#0c1832] [&::-webkit-details-marker]:hidden">{item.q}</summary>
                <p className="mt-2 text-sm leading-6 text-[#526987]">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section id="contact" className="bg-white">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-[13px] font-extrabold tracking-[0.16em] text-[#1e4fc8]">开始沟通</p>
              <h2 className="mt-3 text-[1.7rem] font-extrabold leading-tight tracking-tight text-[#0c1832] md:text-4xl">{CLOSING_TITLE}</h2>
              <p className="mt-4 text-base leading-7 text-[#526987]">{CLOSING_TEXT}</p>
              <p className="mt-4 text-sm leading-6 text-[#526987]">{VALUE_PROPOSITION}</p>
            </div>
            <form noValidate onSubmit={onSubmit} data-testid="growth-form" className="rounded-3xl border border-[#e4eaf4] bg-[#f5f8fe] p-5 md:p-7">
              <div className="hidden" aria-hidden="true">
                <input name="company_website" tabIndex={-1} autoComplete="off" />
              </div>
              <div className="grid gap-4">
                <label className="block text-sm font-bold text-[#0c1832]">
                  意向类型
                  <select className={cn(fieldClass, "mt-2")} value={intent} data-testid="growth-intent" onChange={(event) => setIntent(event.target.value as GrowthIntent)}>
                    {GROWTH_INTENTS.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-bold text-[#0c1832]">
                  企业名称
                  <input name="company_name" className={cn(fieldClass, "mt-2")} autoComplete="organization" data-testid="growth-company" />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-bold text-[#0c1832]">
                    联系人
                    <input name="contact_name" className={cn(fieldClass, "mt-2")} autoComplete="name" data-testid="growth-contact" />
                  </label>
                  <label className="block text-sm font-bold text-[#0c1832]">
                    手机号
                    <input name="phone" className={cn(fieldClass, "mt-2")} inputMode="numeric" autoComplete="tel" data-testid="growth-phone" />
                  </label>
                </div>
                <label className="block text-sm font-bold text-[#0c1832]">
                  行业
                  <input name="industry" className={cn(fieldClass, "mt-2")} placeholder="例如工业贸易、机械制造" data-testid="growth-industry" />
                </label>
                <label className="block text-sm font-bold text-[#0c1832]">
                  主要痛点
                  <select name="pain" className={cn(fieldClass, "mt-2")} defaultValue="" data-testid="growth-pain">
                    <option value="">请选择</option>
                    {GROWTH_PAINS.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-start gap-3 text-sm leading-6 text-[#526987]">
                  <input type="checkbox" className="mt-1" checked={agreed} data-testid="growth-consent" onChange={(event) => setAgreed(event.target.checked)} />
                  <span>
                    {CONSENT_TEXT}
                    <Link className="ml-1 font-bold text-[#1e4fc8]" to="/legal/privacy">阅读隐私政策</Link>
                  </span>
                </label>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#526987]">请不要在上面填写税号、身份证、客户名单或价格明细。</p>
              {error ? <div className="mt-4" data-testid="growth-error"><Banner tone="error">{error}</Banner></div> : null}
              {result?.duplicate ? (
                <p className="mt-4 rounded-xl bg-[#edf3ff] px-3 py-3 text-sm leading-6 text-[#1e4fc8]" data-testid="growth-duplicate">
                  这个手机号今天已经提交过同类意向。我们按原记录联系，没有重复建档。
                </p>
              ) : null}
              {result && !result.duplicate ? (
                <p className="mt-4 rounded-xl bg-[#e5f8f5] px-3 py-3 text-sm leading-6 text-[#0d6a56]" data-testid="growth-success" data-lead-id={result.id}>
                  已保存。编号 {result.id}。我们会按您留的手机号联系。这一步没有创建账号，也没有开通服务。
                </p>
              ) : null}
              <Button type="submit" data-testid="growth-submit" disabled={busy} className="mt-5 w-full bg-[#1e4fc8] py-3 hover:bg-[#1e4fc8]">
                {busy ? "正在保存…" : intent === "scene_trial" ? "提交场景体验意向" : "提交增长交流意向"}
              </Button>
            </form>
          </div>
        </section>

        <section className="px-4 pb-16 md:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 rounded-3xl bg-[#0c1936] px-6 py-10 text-white md:flex-row md:items-center md:px-10">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">{CLOSING_TITLE}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#d5e2f7]">{BRAND_NAME} · {BRAND_EN}</p>
            </div>
            <Button asChild variant="light">
              <a href="#contact" onClick={() => choose("growth_talk")}>预约增长交流</a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="bg-[#0d1931] text-[#d5e2f7]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-10 md:px-6">
          <div className="flex items-center gap-2 text-lg font-extrabold text-white">
            <BrandMark size={32} />
            {BRAND_NAME}
          </div>
          <p className="text-sm">{BRAND_TAGLINE}</p>
          <p className="text-sm">{PUBLIC_SITE}</p>
          <p className="text-sm">
            <Link className="text-white" to="/legal/privacy">隐私政策</Link>
            <span> · </span>
            <Link className="text-white" to="/legal/consent">数据授权书</Link>
            <span> · </span>
            <Link className="text-white" to="/legal/terms">用户协议</Link>
          </p>
          <p className="text-sm">{COMPANY_NAME} · {CONTACT_LINE}</p>
        </div>
      </footer>
    </div>
  );
}
