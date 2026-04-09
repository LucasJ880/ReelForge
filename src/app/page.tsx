import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { LandingContent } from "@/components/landing/landing-content";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  return <LandingContent />;
}
