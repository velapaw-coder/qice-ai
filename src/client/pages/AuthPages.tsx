import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deriveClientKey, passwordError, phoneError } from "@shared/password";
import { api } from "../lib/api";
import { Banner, BrandMark, Button, Card, Input, Label } from "../components/ui";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-gradient-to-r from-[#0c1936] to-[#16356f] text-white">
        <div className="mx-auto flex h-16 w-full max-w-lg items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight"><BrandMark light />企策AI</Link>
          <Link to="/login" className="text-sm font-semibold text-[#d5e2f7]">登录</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <p className="text-[13px] font-extrabold tracking-[0.18em] text-[#1e4fc8]">企策AI</p>
        <h1 className="mb-4 text-2xl font-extrabold tracking-tight text-navy">{title}</h1>
        <Card>{children}</Card>
      </main>
    </div>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const company = String(form.get("company_name") || "").trim();
    const contact = String(form.get("contact_name") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const password = String(form.get("password") || "");
    const again = String(form.get("password2") || "");
    if (company.length < 2 || company.length > 60) return setError("企业名称需要 2–60 个字");
    if (contact.length < 2 || contact.length > 20) return setError("联系人需要 2–20 个字");
    if (phoneError(phone)) return setError(phoneError(phone)!);
    if (passwordError(password)) return setError(passwordError(password)!);
    if (password !== again) return setError("两次密码不一致");
    setBusy(true);
    setError("");
    try {
      const client_key = await deriveClientKey(phone, password);
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          company_name: company,
          contact_name: contact,
          phone,
          client_key,
          company_website: String(form.get("company_website") || ""),
        }),
      });
      navigate("/app/upload");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="注册企业账号">
      <p className="mb-4 text-sm text-muted">只需要企业名称、联系人、手机号和密码。信用代码和地区会从您上传的资料里识别。</p>
      <form onSubmit={onSubmit} className="space-y-3" data-testid="register-form">
        <div className="hidden" aria-hidden="true">
          <input name="company_website" tabIndex={-1} autoComplete="off" />
        </div>
        <Label>企业名称</Label>
        <Input name="company_name" required minLength={2} maxLength={60} placeholder="与申报表上的纳税人名称一致" data-testid="company" />
        <Label>联系人</Label>
        <Input name="contact_name" required minLength={2} maxLength={20} data-testid="contact" />
        <Label>手机号</Label>
        <Input name="phone" required inputMode="numeric" pattern="1[0-9]{10}" placeholder="用于登录和顾问联系" data-testid="phone" />
        <Label>密码</Label>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" data-testid="password" />
        <Label hint="至少 8 位，包含字母和数字">再输入一次</Label>
        <Input name="password2" type="password" required data-testid="password2" />
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Button type="submit" className="w-full" disabled={busy} data-testid="register-submit">{busy ? "正在创建账号…" : "注册并上传资料"}</Button>
      </form>
      <p className="mt-4 text-sm text-muted">已有账号？<Link className="text-[#1e4fc8]" to="/login">去登录</Link></p>
    </Shell>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState({ phone: "", wechat: "" });
  useEffect(() => {
    api<{ phone: string; wechat: string }>("/api/auth/contact").then(setContact).catch(() => undefined);
  }, []);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phone = String(form.get("phone") || "").trim();
    const password = String(form.get("password") || "");
    setBusy(true);
    setError("");
    try {
      const client_key = await deriveClientKey(phone, password);
      const res = await api<{ role: string; must_change_password: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone, client_key, company_website: String(form.get("company_website") || "") }),
      });
      if (res.must_change_password) navigate(res.role === "enterprise" ? "/app/change-password" : "/admin/change-password");
      else navigate(res.role === "enterprise" ? "/app" : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="登录">
      <form onSubmit={onSubmit} className="space-y-3" data-testid="login-form">
        <div className="hidden" aria-hidden="true"><input name="company_website" tabIndex={-1} autoComplete="off" /></div>
        <Label>手机号</Label>
        <Input name="phone" required inputMode="numeric" data-testid="login-phone" />
        <Label>密码</Label>
        <Input name="password" type="password" required data-testid="login-password" />
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Button type="submit" className="w-full" disabled={busy} data-testid="login-submit">{busy ? "正在校验…" : "登录"}</Button>
      </form>
      <p className="mt-4 text-sm text-muted">
        忘记密码请联系您的顾问
        {contact.phone ? `，电话 ${contact.phone}` : ""}
        {contact.wechat ? `，微信 ${contact.wechat}` : "。顾问联系方式可由管理员在后台配置。"}
      </p>
      <p className="mt-2 text-sm"><Link className="text-[#1e4fc8]" to="/register">注册企业账号</Link></p>
    </Shell>
  );
}

export function ChangePasswordPage({ next }: { next: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phone = String(form.get("phone") || "").trim();
    const oldPassword = String(form.get("old") || "");
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (phoneError(phone) || passwordError(password)) return setError(phoneError(phone) || passwordError(password) || "请检查密码");
    if (password !== confirm) return setError("两次输入的密码不一致");
    setBusy(true);
    try {
      const old_client_key = await deriveClientKey(phone, oldPassword);
      const new_client_key = await deriveClientKey(phone, password);
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ old_client_key, new_client_key }) });
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
      setBusy(false);
    }
  }
  const form = (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="change-password">
      <Label>手机号</Label>
      <Input name="phone" required data-testid="change-phone" />
      <Label>当前密码或临时密码</Label>
      <Input name="old" type="password" required data-testid="change-old" />
      <Label>新密码</Label>
      <Input name="password" type="password" required data-testid="change-new" />
      <Label>确认新密码</Label>
      <Input name="confirm" type="password" required data-testid="change-confirm" />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button type="submit" className="w-full" disabled={busy}>保存新密码</Button>
    </form>
  );
  if (next.startsWith("/admin") || next.startsWith("/app")) return <Card><h1 className="mb-3 text-xl font-extrabold text-navy">修改密码</h1>{form}</Card>;
  return <Shell title="修改密码">{form}</Shell>;
}

export function SelfPasswordForm({ next }: { next: string }) {
  const [phone, setPhone] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ user: { phone: string } }>("/api/me").then((res) => setPhone(res.user.phone || "")).catch(() => setError("没有读到当前账号"));
  }, []);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!phone) return setError("正在读取账号，请稍后再保存");
    const problem = passwordError(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("两次输入的密码不一致");
    setBusy(true);
    setError("");
    try {
      const old_client_key = await deriveClientKey(phone, oldPassword);
      const new_client_key = await deriveClientKey(phone, password);
      await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ old_client_key, new_client_key }) });
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "修改失败");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="self-password">
      <p className="text-sm text-muted">当前账号 {phone || "读取中"}。密码在浏览器里加密后再提交。</p>
      <Label>当前密码</Label>
      <Input type="password" required value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" data-testid="self-old" />
      <Label>新密码</Label>
      <div className="flex gap-2">
        <Input key={showNew ? "self-new-shown" : "self-new-hidden"} className="min-w-0 flex-1" type={showNew ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" data-testid="self-new" />
        <Button type="button" variant="outline" data-testid="self-new-toggle" onClick={() => setShowNew((value) => !value)}>{showNew ? "隐藏" : "显示"}</Button>
      </div>
      <Label>确认新密码</Label>
      <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" data-testid="self-confirm" />
      {error ? <Banner tone="error"><span data-testid="password-error">{error}</span></Banner> : null}
      <Button type="submit" disabled={busy} data-testid="self-save">{busy ? "正在保存…" : "保存新密码"}</Button>
    </form>
  );
}
