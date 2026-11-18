import type * as React from "react";
import { cn } from "../lib/utils";

/** The surface: white, a hairline, a 1px contact shadow. Content pads with --card-p. */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col rounded-xl border bg-card text-card-foreground shadow-(--card-shadow) [--card-p:--spacing(4)] sm:[--card-p:--spacing(6)]",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-(--card-p)", className)} {...props} />;
}

export { Card, CardContent };
