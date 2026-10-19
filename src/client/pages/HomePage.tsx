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
  return (
    <>
      <style>{homeCss}</style>
      <div dangerouslySetInnerHTML={{ __html: homeHtml }} />
    </>
  );
}
