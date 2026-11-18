import type * as React from "react";
import { Brand } from "./brand";

export interface AuthBenefit {
  icon: React.ReactNode;
  title: string;
  body: string;
}

/**
 * Split-screen auth: the tinted brand panel at 45% from lg, the form centred on the right.
 * Below lg the panel is hidden and the brand sits above the form.
 */
function AuthLayout({
  headline,
  subline,
  benefits,
  footnote,
  brandName,
  brandLogoUrl,
  children,
}: {
  headline: string;
  subline: string;
  benefits: AuthBenefit[];
  footnote?: React.ReactNode;
  brandName?: string;
  brandLogoUrl?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="relative hidden overflow-hidden border-r border-primary/10 bg-linear-to-br from-primary/10 via-primary/5 to-background lg:flex lg:w-[45%] lg:flex-col lg:justify-between lg:px-12 lg:py-10 xl:px-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -left-40 size-[480px] rounded-full bg-primary/10 blur-3xl"
        />
        <Brand name={brandName} logoUrl={brandLogoUrl} className="relative" />
        <div className="relative max-w-md py-12">
          <h2 className="m-0 text-4xl leading-tight font-semibold tracking-tight text-balance">
            {headline}
          </h2>
          <p className="m-0 mt-3 text-lg text-muted-foreground">{subline}</p>
          <ul className="m-0 mt-10 grid list-none gap-6 p-0">
            {benefits.map((benefit) => (
              <li key={benefit.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary shadow-xs ring-1 ring-primary/15 [&_svg]:size-4">
                  {benefit.icon}
                </span>
                <span>
                  <span className="block text-sm font-medium">{benefit.title}</span>
                  <span className="block text-sm text-muted-foreground">{benefit.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-sm text-muted-foreground">{footnote}</div>
      </aside>
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <Brand name={brandName} logoUrl={brandLogoUrl} className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}

/** Title + one muted line, left-aligned above the form. */
function AuthHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-8 grid gap-1.5">
      <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
      {description && <p className="m-0 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export { AuthHeader, AuthLayout };
