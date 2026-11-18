import { AuthLayout } from "@pas/ui/components/auth-layout";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarClock, Calculator, Layers, ListChecks } from "lucide-react";
import { AuthForm } from "@/components/auth-form";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const benefits = [
  {
    icon: <Layers />,
    title: "Products are configuration",
    body: "Data, questions, rules and documents change without a release.",
  },
  {
    icon: <Calculator />,
    title: "Rating your actuaries trust",
    body: "Rate tables or their own workbooks, versioned and tested.",
  },
  {
    icon: <ListChecks />,
    title: "Underwriting with reasons",
    body: "Every referral and decline shows exactly why.",
  },
  {
    icon: <CalendarClock />,
    title: "Compliance on schedule",
    body: "Filings and notices tracked to the day they're due.",
  },
];

function LoginPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout
      headline="Launch insurance products in days."
      subline="Configure, rate, underwrite and service your book in one place."
      benefits={benefits}
    >
      <AuthForm
        titles={{
          "sign-in": { title: "Sign in", description: "Welcome back." },
          "sign-up": {
            title: "Create your account",
            description: "You'll set up your organization next.",
          },
        }}
        onSuccess={() => navigate({ to: "/" })}
      />
    </AuthLayout>
  );
}
