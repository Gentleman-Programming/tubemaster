import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SemanticSearchPage } from "@/components/semantic-search-page";

export default async function SemanticSearchRoute() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  return <SemanticSearchPage />;
}
