import { useEffect } from "react";
import { homeCss, homeHtml } from "../home/markup";
import { api } from "../lib/api";

export function HomePage() {
  useEffect(() => {
    let gone = false;
    api<{ user: { role: string } }>("/api/me")
      .then((me) => {
        if (gone) return;
        const href = me.user.role === "enterprise" ? "/app" : "/admin";
        document.querySelectorAll<HTMLAnchorElement>("[data-cta]").forEach((node) => node.setAttribute("href", href));
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, []);
  useEffect(() => {
    const drawer = document.querySelector<HTMLElement>("[data-testid='home-drawer']");
    const open = document.querySelector("[data-testid='home-menu']");
    const close = document.querySelector("[data-testid='home-menu-close']");
    const onOpen = () => drawer?.classList.add("open");
    const onClose = () => drawer?.classList.remove("open");
    open?.addEventListener("click", onOpen);
    close?.addEventListener("click", onClose);
    const links = [...(drawer?.querySelectorAll("a") || [])];
    for (const link of links) link.addEventListener("click", onClose);
    return () => {
      open?.removeEventListener("click", onOpen);
      close?.removeEventListener("click", onClose);
      for (const link of links) link.removeEventListener("click", onClose);
    };
  }, []);
  return (
    <>
      <style>{homeCss}</style>
      <div dangerouslySetInnerHTML={{ __html: homeHtml }} />
    </>
  );
}
