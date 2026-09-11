import { CalendarDaysIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ERROR_MESSAGES: Record<string, string> = {
  NoRefreshToken: "Google did not grant offline access. Please sign in again and accept all requested permissions.",
  NoCalendarScope: "Calendar access was not granted. Please sign in again and allow access to your Google Calendar.",
  AccessDenied: "Sign-in was cancelled.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/requests");

  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <CalendarDaysIcon className="size-6" />
          </div>
          <CardTitle className="text-2xl">Time Off</CardTitle>
          <CardDescription>
            Sign in with your Google account to request time off. Approved requests are added to your Google Calendar automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </p>
          )}
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/requests" });
            }}
          >
            <Button type="submit" className="w-full" size="lg">
              Continue with Google
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            You&apos;ll be asked to allow calendar access so approved time off can be placed on your calendar.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
