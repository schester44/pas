import { Button } from "@pas/ui/components/button";
import { IconTile } from "@pas/ui/components/icon-tile";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Rocket } from "lucide-react";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/")({
  component: OverviewPage,
});

const steps = [
  { title: "Create a product", detail: "Name it and choose its line of business." },
  {
    title: "Describe the risk",
    detail: "Define the data you collect and the forms agents fill in.",
  },
  {
    title: "Price and publish",
    detail: "Add rating and rules, test them, then publish a version.",
  },
];

function OverviewPage() {
  const trpc = useTRPC();
  const products = useQuery(trpc.catalog.products.list.queryOptions());
  const hasProduct = (products.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader title="Overview" />
      <PageBody className="max-w-4xl">
        <section
          aria-labelledby="setup-title"
          className="overflow-hidden rounded-xl border border-primary/15 bg-linear-to-br from-primary/[0.06] via-card to-card shadow-xs [--card-p:--spacing(4)] sm:[--card-p:--spacing(6)]"
        >
          <div className="grid gap-6 p-(--card-p)">
            <div className="flex items-start gap-3">
              <IconTile>
                <Rocket />
              </IconTile>
              <div className="grid gap-1">
                <h2 id="setup-title" className="m-0 text-base leading-6 font-semibold">
                  Launch your first product
                </h2>
                <p className="m-0 text-sm text-muted-foreground">
                  Three steps from idea to a quotable product.
                </p>
              </div>
            </div>
            <ol className="m-0 grid list-none gap-4 p-0">
              {steps.map((step, index) => {
                const done = index === 0 && hasProduct;
                return (
                  <li key={step.title} className="flex gap-3">
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums ring-1 ring-primary/15"
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <div className="grid min-w-0 gap-1 pt-0.5">
                      <p
                        className={`m-0 text-sm leading-5 font-medium ${done ? "text-muted-foreground line-through" : ""}`}
                      >
                        {step.title}
                      </p>
                      <p className="m-0 text-sm text-muted-foreground">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div>
              <Button asChild>
                <Link to="/products">
                  {hasProduct ? "View products" : "Create a product"}
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </PageBody>
    </>
  );
}
